import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { rateLimit } from "@/lib/security/guards"
import { hashDevice } from "@/lib/security/crypto"
import {
  tickAttempt,
  checkCooldown,
  setCooldown,
  keyIp,
  keyEmail,
  keyEmailIp,
} from "@/lib/security/authRateLimit"
import { logAuthSecurityEvent, extractIp } from "@/lib/audit/authSecurityLog"

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string
      password?: string
      device_id?: string
    }

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
    const password = typeof body.password === "string" ? body.password : ""
    const clientDeviceId =
      typeof body.device_id === "string" && body.device_id.length > 0 && body.device_id.length <= 200
        ? body.device_id
        : null

    if (!email || !password) {
      return NextResponse.json(
        { error: "MISSING_FIELDS", message: "이메일과 비밀번호를 입력해주세요." },
        { status: 400 }
      )
    }

    if (!clientDeviceId) {
      return NextResponse.json(
        { error: "DEVICE_ID_REQUIRED", message: "기기 식별자가 누락되었습니다. 다시 시도해 주세요." },
        { status: 400 }
      )
    }

    // Fast-path in-memory throttle — rejects bursts without a DB round-trip.
    const rl = rateLimit(`login:${email}`, { limit: 10, windowMs: 60_000 })
    if (!rl.ok) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many login attempts. Retry shortly." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfter / 1000)) } }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      console.error("[login] env missing", {
        hasSupabaseUrl: !!supabaseUrl,
        hasAnonKey: !!supabaseAnonKey,
        hasServiceKey: !!supabaseServiceKey,
      })
      return NextResponse.json(
        { error: "SERVER_CONFIG_ERROR", message: "서버 설정 오류." },
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey)

    // STEP-SEC-1: durable IP + email+IP rate limits. Fail-closed — any DB
    // error here aborts the request; we never fall back to permissive.
    const ip = extractIp(request)
    try {
      const ipTick = await tickAttempt(adminClient, {
        key: keyIp(ip),
        action: "login",
        windowSeconds: 60,
        maxAttempts: 10,
      })
      if (ipTick.blocked) {
        await logAuthSecurityEvent(adminClient, {
          event_type: "login_rate_limited",
          email, ip,
          metadata: { bucket: "ip", reason: ipTick.reason, attempt_count: ipTick.attemptCount },
        })
        return NextResponse.json(
          { error: "RATE_LIMITED", message: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
          { status: 429, headers: { "Retry-After": String(ipTick.retryAfterSeconds) } }
        )
      }
      const pairTick = await tickAttempt(adminClient, {
        key: keyEmailIp(email, ip),
        action: "login_email",
        windowSeconds: 60,
        maxAttempts: 5,
      })
      if (pairTick.blocked) {
        await logAuthSecurityEvent(adminClient, {
          event_type: "login_rate_limited",
          email, ip,
          metadata: { bucket: "email_ip", reason: pairTick.reason, attempt_count: pairTick.attemptCount },
        })
        return NextResponse.json(
          { error: "RATE_LIMITED", message: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." },
          { status: 429, headers: { "Retry-After": String(pairTick.retryAfterSeconds) } }
        )
      }
    } catch (rlErr) {
      console.error("[login] rate-limit DB failed — failing closed", rlErr)
      await logAuthSecurityEvent(adminClient, {
        event_type: "login_security_state_unavailable",
        email, ip, metadata: { stage: "login_tick" },
      }).catch(() => { /* best effort */ })
      return NextResponse.json(
        { error: "SECURITY_STATE_UNAVAILABLE", message: "일시적 오류로 로그인할 수 없습니다. 잠시 후 다시 시도해주세요." },
        { status: 503 }
      )
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.session) {
      // 2026-04-25: 로그인 실패를 system_errors 에 기록해서 감시 대시보드
      //   (/ops/watchdog) 가 무차별 대입 공격 스파이크를 감지할 수 있게 함.
      //   email 은 해시 prefix 만 저장해 개인정보 유출 최소화.
      const emailHash = email
        ? email.split("@")[0].slice(0, 3) + "***"
        : "unknown"
      try {
        await adminClient.from("system_errors").insert({
          tag: "login_failed",
          error_name: "AUTH_FAILED",
          error_message: `login failed for ${emailHash}`,
          extra: { code: error?.code ?? null },
        })
      } catch { /* 텔레메트리 실패가 로그인 응답을 막아선 안 됨 */ }
      console.error("[login] auth failed", { code: error?.code })
      return NextResponse.json(
        { error: "AUTH_FAILED", message: "이메일 또는 비밀번호가 올바르지 않습니다." },
        { status: 401 }
      )
    }

    // SECURITY (R-6 remediation): the session is scoped to the PRIMARY
    // membership only. A user with multiple memberships (e.g., owner at
    // store A + hostess at store B) must not be able to race the
    // non-deterministic "first row" back into a higher-privilege scope.
    // We query with `is_primary=true`, fetch up to 2 rows, and fail
    // closed when >1 matches — that would mean a data-integrity
    // violation (two primaries), not a business case.
    const { data: memberships, error: membershipError } = await adminClient
      .from("store_memberships")
      .select("id, store_uuid, role, status")
      .eq("profile_id", data.user.id)
      .eq("is_primary", true)
      .eq("status", "approved")
      .is("deleted_at", null)
      .limit(2)

    if (membershipError || !memberships || memberships.length === 0) {
      console.error("[login] membership failed", {
        membershipError,
        membershipCount: memberships?.length ?? 0,
      })
      try { await supabase.auth.signOut() } catch {}
      return NextResponse.json(
        { error: "MEMBERSHIP_NOT_APPROVED", message: "승인되지 않은 계정입니다." },
        { status: 401 }
      )
    }
    if (memberships.length > 1) {
      console.error("[login] multiple primary memberships — fail closed", {
        count: memberships.length,
      })
      try { await supabase.auth.signOut() } catch {}
      return NextResponse.json(
        { error: "MEMBERSHIP_AMBIGUOUS", message: "계정 설정 오류. 관리자에게 문의하세요." },
        { status: 500 }
      )
    }

    const membership = memberships[0]

    let deviceHash: string
    try {
      deviceHash = hashDevice(data.user.id, clientDeviceId)
    } catch {
      try { await supabase.auth.signOut() } catch {}
      return NextResponse.json(
        { error: "SERVER_CONFIG_ERROR", message: "서버 설정 오류. 관리자에게 문의하세요." },
        { status: 500 }
      )
    }

    const { data: trustedDev, error: trustedErr } = await adminClient
      .from("trusted_devices")
      .select("id")
      .eq("user_id", data.user.id)
      .eq("device_hash", deviceHash)
      .is("revoked_at", null)
      .maybeSingle()

    if (trustedErr) {
      console.error("[login] trusted lookup failed", trustedErr)
      try { await supabase.auth.signOut() } catch {}
      return NextResponse.json(
        { error: "TRUST_LOOKUP_FAILED", message: "신뢰 기기 조회 실패. 잠시 후 다시 시도해 주세요." },
        { status: 500 }
      )
    }

    if (trustedDev) {
      await adminClient
        .from("trusted_devices")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", (trustedDev as { id: string }).id)

      const res = NextResponse.json({
        access_token: data.session.access_token,
        user_id: data.user.id,
        membership_id: membership.id,
        role: membership.role,
        store_uuid: membership.store_uuid,
      })

      res.cookies.set({
        name: "nox_access_token",
        value: data.session.access_token,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        maxAge: typeof data.session.expires_in === "number" ? data.session.expires_in : 3600,
      })

      return res
    }

    // STEP-SEC-1: resend cooldown gate (60 s per email). Fail-closed on
    // DB error so an attacker can't bypass by triggering outages.
    try {
      const cd = await checkCooldown(adminClient, {
        key: keyEmail(email),
        action: "otp_resend",
      })
      if (cd.active) {
        await logAuthSecurityEvent(adminClient, {
          event_type: "login_email_otp_resend_rate_limited",
          email, ip,
          metadata: { retry_after_seconds: cd.retryAfterSeconds },
        })
        try { await supabase.auth.signOut() } catch {}
        return NextResponse.json(
          {
            error: "OTP_RESEND_COOLDOWN",
            message: `인증 코드 재전송은 ${cd.retryAfterSeconds}초 후에 가능합니다.`,
            retry_after_seconds: cd.retryAfterSeconds,
          },
          { status: 429, headers: { "Retry-After": String(cd.retryAfterSeconds) } }
        )
      }
    } catch (cdErr) {
      console.error("[login] cooldown check failed — failing closed", cdErr)
      await logAuthSecurityEvent(adminClient, {
        event_type: "login_security_state_unavailable",
        email, ip, metadata: { stage: "cooldown_check" },
      }).catch(() => { /* best effort */ })
      try { await supabase.auth.signOut() } catch {}
      return NextResponse.json(
        { error: "SECURITY_STATE_UNAVAILABLE", message: "일시적 오류로 로그인할 수 없습니다." },
        { status: 503 }
      )
    }

    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
      },
    })

    try { await supabase.auth.signOut() } catch {}

    if (otpErr) {
      console.error("[login] otp send failed", otpErr)
      return NextResponse.json(
        { error: "OTP_SEND_FAILED", message: "인증 코드 발송에 실패했습니다. 잠시 후 다시 시도해 주세요." },
        { status: 503 }
      )
    }

    // Start cooldown AFTER successful send (so failed sends don't block
    // legit retries). Cooldown failure is non-fatal — mail is already out.
    try {
      await setCooldown(adminClient, {
        key: keyEmail(email),
        action: "otp_resend",
        cooldownSeconds: 60,
      })
    } catch (setErr) {
      console.warn("[login] setCooldown failed (non-fatal)", setErr)
    }

    await logAuthSecurityEvent(adminClient, {
      event_type: "login_email_otp_sent",
      email, ip, user_id: data.user.id,
    })

    return NextResponse.json({
      verification_required: "email",
      email,
      user_id: data.user.id,
      message: "새 기기 로그인입니다. 이메일로 인증 코드를 보냈습니다.",
    }, { status: 200 })
  } catch (err) {
    console.error("[login] unhandled", err)
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "서버 오류." },
      { status: 500 }
    )
  }
}