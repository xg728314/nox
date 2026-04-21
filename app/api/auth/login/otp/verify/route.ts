import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { rateLimit } from "@/lib/security/guards"
import { hashDevice } from "@/lib/security/crypto"
import { logAuditEvent } from "@/lib/audit/logEvent"
import { EMAIL_OTP_LENGTH, EMAIL_OTP_REGEX } from "@/lib/security/otpLength"
import {
  checkLock,
  recordFailure,
  clearBucket,
  keyEmailIp,
} from "@/lib/security/authRateLimit"
import { logAuthSecurityEvent, extractIp } from "@/lib/audit/authSecurityLog"

/**
 * STEP-5: POST /api/auth/login/otp/verify
 *
 * Second leg of the new-device email-OTP flow. The client has already
 * passed step 1 (/api/auth/login) and received an email OTP via Supabase
 * `auth.signInWithOtp`. Length is governed by `EMAIL_OTP_LENGTH` in
 * `lib/security/otpLength.ts` (single source of truth shared with the
 * login client). This route:
 *
 *   1. re-validates the password (anti-bypass of /login)
 *   2. verifies the OTP via Supabase `auth.verifyOtp(type='email')`
 *   3. registers the device_id in trusted_devices (upsert unrevoked row)
 *   4. issues the session (Bearer access_token + HttpOnly cookie)
 *
 * Fail-closed on every step. No partial success — a failed OTP or
 * password never yields a session.
 *
 * Security model: identical to standard email-OTP-as-2FA. Anyone with
 * both the password AND email inbox access can log in. Anyone with
 * only one cannot. Email access is treated as account authority
 * (equivalent to the existing password-reset-via-email model). TOTP
 * remains an optional higher-security upgrade for later.
 */

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string
      password?: string
      code?: string
      device_id?: string
      device_name?: string
      remember_device?: boolean
    }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
    const password = typeof body.password === "string" ? body.password : ""
    const code = typeof body.code === "string" ? body.code.trim() : ""
    const clientDeviceId =
      typeof body.device_id === "string" && body.device_id.length > 0 && body.device_id.length <= 200
        ? body.device_id
        : null
    const deviceName =
      typeof body.device_name === "string" && body.device_name.length > 0 && body.device_name.length <= 120
        ? body.device_name.trim()
        : null
    const rememberDevice = body.remember_device !== false // default true

    if (!email || !password) {
      return NextResponse.json(
        { error: "MISSING_FIELDS", message: "이메일과 비밀번호를 입력해주세요." },
        { status: 400 }
      )
    }
    if (!EMAIL_OTP_REGEX.test(code)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: `${EMAIL_OTP_LENGTH}자리 인증 코드를 입력해주세요.` },
        { status: 400 }
      )
    }
    if (!clientDeviceId) {
      return NextResponse.json(
        { error: "DEVICE_ID_REQUIRED", message: "기기 식별자가 누락되었습니다. 다시 시도해 주세요." },
        { status: 400 }
      )
    }

    // Per-email rate limit mirrors the TOTP step: 8 attempts/minute.
    const rl = rateLimit(`login-otp-verify:${email}`, { limit: 8, windowMs: 60_000 })
    if (!rl.ok) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many verification attempts. Retry shortly." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfter / 1000)) } }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return NextResponse.json(
        { error: "SERVER_CONFIG_ERROR", message: "서버 설정 오류." },
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey)
    const admin = createClient(supabaseUrl, supabaseServiceKey)
    const ip = extractIp(request)
    const lockoutKey = keyEmailIp(email, ip)

    // STEP-SEC-1: durable brute-force lockout. Checked BEFORE the Supabase
    // verifyOtp call so locked attackers never burn Supabase quota or touch
    // the token-validation path. Fail-closed on DB read error.
    try {
      const lock = await checkLock(admin, { key: lockoutKey, action: "otp_verify" })
      if (lock.locked) {
        await logAuthSecurityEvent(admin, {
          event_type: "login_email_otp_locked",
          email, ip,
          metadata: { retry_after_seconds: lock.retryAfterSeconds, source: "pre_check" },
        })
        return NextResponse.json(
          {
            error: "OTP_LOCKED",
            message: `인증 시도 실패 횟수 초과로 잠시 차단되었습니다. ${lock.retryAfterSeconds}초 후 다시 시도해주세요.`,
            retry_after_seconds: lock.retryAfterSeconds,
          },
          { status: 429, headers: { "Retry-After": String(lock.retryAfterSeconds) } }
        )
      }
    } catch (lockErr) {
      console.error("[otp/verify] checkLock failed — failing closed", lockErr)
      await logAuthSecurityEvent(admin, {
        event_type: "login_security_state_unavailable",
        email, ip, metadata: { stage: "lock_check" },
      }).catch(() => { /* best effort */ })
      return NextResponse.json(
        { error: "SECURITY_STATE_UNAVAILABLE", message: "일시적 오류로 인증할 수 없습니다." },
        { status: 503 }
      )
    }

    // 1. Re-validate password. Prevents an attacker from calling this
    //    route with an OTP obtained through a side channel.
    const { data: pwData, error: pwErr } = await supabase.auth.signInWithPassword({ email, password })
    if (pwErr || !pwData.session) {
      return NextResponse.json(
        { error: "AUTH_FAILED", message: "이메일 또는 비밀번호가 올바르지 않습니다." },
        { status: 401 }
      )
    }

    // 2. Verify the email OTP. `type: 'email'` matches signInWithPassword's
    //    sibling OTP flow. On failure the session from step 1 is discarded.
    const { data: otpData, error: otpErr } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    })

    if (otpErr || !otpData.session || !otpData.user) {
      try { await supabase.auth.signOut() } catch { /* ignore */ }

      // STEP-SEC-1: record failure + lock at threshold. If this write fails
      // we still reject the request with 401 — the attacker does not get
      // through — but we log the degraded state for operators.
      let lockedNow = false
      let lockedUntilIso: string | null = null
      let failureCount = 0
      try {
        const f = await recordFailure(admin, {
          key: lockoutKey, action: "otp_verify",
          threshold: 5, lockoutSeconds: 10 * 60,
        })
        failureCount = f.failureCount
        lockedNow = f.locked
        lockedUntilIso = f.lockedUntil ? f.lockedUntil.toISOString() : null
      } catch (recErr) {
        console.error("[otp/verify] recordFailure failed", recErr)
        await logAuthSecurityEvent(admin, {
          event_type: "login_security_state_unavailable",
          email, ip, metadata: { stage: "record_failure" },
        }).catch(() => { /* best effort */ })
      }

      await logAuthSecurityEvent(admin, {
        event_type: "login_email_otp_verify_failed",
        email, ip,
        metadata: { failure_count: failureCount, locked: lockedNow, supabase_error: otpErr?.message ?? "no_session" },
      })
      if (lockedNow) {
        await logAuthSecurityEvent(admin, {
          event_type: "login_email_otp_locked",
          email, ip,
          metadata: { locked_until: lockedUntilIso, source: "post_failure" },
        })
        const until = lockedUntilIso ? new Date(lockedUntilIso) : null
        const retry = until ? Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000)) : 600
        return NextResponse.json(
          {
            error: "OTP_LOCKED",
            message: `인증 시도 실패 횟수 초과로 잠시 차단되었습니다. ${retry}초 후 다시 시도해주세요.`,
            retry_after_seconds: retry,
          },
          { status: 429, headers: { "Retry-After": String(retry) } }
        )
      }

      return NextResponse.json(
        { error: "INVALID_CODE", message: "인증 코드가 일치하지 않습니다." },
        { status: 401 }
      )
    }

    // Both checks passed — the user is the same identity in both paths
    // (Supabase keys both by email) but double-check defensively.
    if (otpData.user.id !== pwData.user.id) {
      try { await supabase.auth.signOut() } catch { /* ignore */ }
      return NextResponse.json(
        { error: "IDENTITY_MISMATCH", message: "인증 과정에서 오류가 발생했습니다." },
        { status: 401 }
      )
    }

    // 3. Membership check — SECURITY (R-6): PRIMARY only, fail closed
    // on ambiguous (>1 primary). Same policy as /api/auth/login.
    const { data: memberships, error: mErr } = await admin
      .from("store_memberships")
      .select("id, store_uuid, role, status")
      .eq("profile_id", otpData.user.id)
      .eq("is_primary", true)
      .eq("status", "approved")
      .is("deleted_at", null)
      .limit(2)

    if (mErr || !memberships || memberships.length === 0) {
      try { await supabase.auth.signOut() } catch { /* ignore */ }
      return NextResponse.json(
        { error: "MEMBERSHIP_NOT_APPROVED", message: "승인되지 않은 계정입니다." },
        { status: 401 }
      )
    }
    if (memberships.length > 1) {
      try { await supabase.auth.signOut() } catch { /* ignore */ }
      return NextResponse.json(
        { error: "MEMBERSHIP_AMBIGUOUS", message: "계정 설정 오류. 관리자에게 문의하세요." },
        { status: 500 }
      )
    }
    const membership = memberships[0] as { id: string; store_uuid: string; role: string; status: string }

    // 4. Register / refresh the trusted device. Hash failure is fail-closed.
    let deviceHash: string
    try {
      deviceHash = hashDevice(otpData.user.id, clientDeviceId)
    } catch {
      try { await supabase.auth.signOut() } catch { /* ignore */ }
      return NextResponse.json(
        { error: "SERVER_CONFIG_ERROR", message: "서버 설정 오류. 관리자에게 문의하세요." },
        { status: 500 }
      )
    }

    if (rememberDevice) {
      try {
        const nowIso = new Date().toISOString()
        const { data: existing } = await admin
          .from("trusted_devices")
          .select("id")
          .eq("user_id", otpData.user.id)
          .eq("device_hash", deviceHash)
          .is("revoked_at", null)
          .maybeSingle()

        if (existing) {
          await admin
            .from("trusted_devices")
            .update({ last_seen_at: nowIso })
            .eq("id", (existing as { id: string }).id)
        } else {
          await admin.from("trusted_devices").insert({
            user_id: otpData.user.id,
            device_hash: deviceHash,
            device_name: deviceName,
            user_agent_summary: request.headers.get("user-agent")?.slice(0, 200) ?? null,
            first_seen_at: nowIso,
            last_seen_at: nowIso,
            trusted_at: nowIso,
          })
          await logAuditEvent(admin, {
            auth: {
              user_id: otpData.user.id,
              membership_id: membership.id,
              store_uuid: membership.store_uuid,
              role: membership.role as "owner" | "manager" | "waiter" | "staff" | "hostess",
              membership_status: "approved",
              global_roles: [],
              is_super_admin: false,
            },
            action: "trusted_device_registered_email_otp",
            entity_table: "profiles",
            entity_id: otpData.user.id,
            status: "success",
            metadata: { device_name: deviceName },
          })
        }
      } catch {
        // Device registration is best-effort. The user can still log in
        // this time; they will simply be asked for OTP again next time.
        // Not fail-closed here because trust registration is a UX
        // optimization, not a security gate. Session issuance below
        // still requires both password AND OTP to have passed.
      }
    }

    // STEP-SEC-1: clear the brute-force counter + any stale lock on
    // successful verification. Non-fatal on failure — the session is
    // still issued below — but log the degraded state.
    try {
      await clearBucket(admin, { key: lockoutKey, action: "otp_verify" })
    } catch (clrErr) {
      console.warn("[otp/verify] clearBucket failed (non-fatal)", clrErr)
      await logAuthSecurityEvent(admin, {
        event_type: "login_security_state_unavailable",
        email, ip, metadata: { stage: "clear_bucket" },
      }).catch(() => { /* best effort */ })
    }

    await logAuthSecurityEvent(admin, {
      event_type: "login_email_otp_verify_success",
      email, ip, user_id: otpData.user.id,
    })

    await logAuditEvent(admin, {
      auth: {
        user_id: otpData.user.id,
        membership_id: membership.id,
        store_uuid: membership.store_uuid,
        role: membership.role as "owner" | "manager" | "waiter" | "staff" | "hostess",
        membership_status: "approved",
        global_roles: [],
        is_super_admin: false,
      },
      action: "login_email_otp_success",
      entity_table: "profiles",
      entity_id: otpData.user.id,
      status: "success",
    })

    // 5. Issue session. Use the OTP-verification session's access_token
    //    (functionally equivalent to the password session since both
    //    belong to the same Supabase user). Cookie set for middleware
    //    gating on page navigation.
    const accessToken = otpData.session.access_token
    const expiresIn = typeof otpData.session.expires_in === "number" ? otpData.session.expires_in : 3600

    const res = NextResponse.json({
      access_token: accessToken,
      user_id: otpData.user.id,
      membership_id: membership.id,
      role: membership.role,
      store_uuid: membership.store_uuid,
    })
    res.cookies.set({
      name: "nox_access_token",
      value: accessToken,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: expiresIn,
    })
    return res
  } catch {
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "서버 오류." },
      { status: 500 }
    )
  }
}
