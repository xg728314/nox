import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { verifyTotp } from "@/lib/security/totp"
import { decryptSecret, hashDevice } from "@/lib/security/crypto"
import { rateLimit } from "@/lib/security/guards"
import { rateLimitDurable } from "@/lib/security/rateLimitDurable"
import { getClientIp } from "@/lib/security/clientIp"
import { logAuditEvent } from "@/lib/audit/logEvent"
import { consumeBackupCode, looksLikeBackupCode } from "@/lib/security/backupCodes"

/**
 * STEP-013E: POST /api/auth/login/mfa
 *
 * Second leg of the MFA-required login flow. Verifies password +
 * TOTP code atomically and only returns an access_token when both
 * pass. On success, optionally registers the provided device_id as
 * trusted so subsequent logins from that browser can bypass the OTP
 * prompt (checked in /login). Brute-force protection is layered
 * per-email.
 */

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

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
    // R25: TOTP (6자리 숫자) 또는 백업 코드 (12자 영숫자, 대시 허용) 둘 다 허용.
    const isTotp = /^\d{6}$/.test(code)
    const isBackup = !isTotp && looksLikeBackupCode(code)
    if (!isTotp && !isBackup) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "6-digit code or 12-character backup code required." },
        { status: 400 }
      )
    }

    // Fast-path in-memory burst guard (best-effort within one process).
    const rlLocal = rateLimit(`login-mfa:${email}`, { limit: 16, windowMs: 60_000 })
    if (!rlLocal.ok) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many MFA attempts. Retry shortly." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rlLocal.retryAfter / 1000)) } }
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

    // SECURITY (R-7): durable rate-limit on MFA verify (distributed).
    // 8/min covers fat-finger + clock drift without permitting a
    // brute-force of the 10^6 TOTP space. Per-email bucket primary;
    // per-IP bucket blocks horizontal account-sweep attacks.
    const admin = createClient(supabaseUrl, supabaseServiceKey)
    const ip = getClientIp(request)
    for (const bucket of [
      { key: `login-mfa:email:${email}`, limit: 8 },
      { key: `login-mfa:ip:${ip}`,       limit: 30 },
    ]) {
      const rl = await rateLimitDurable(admin, {
        key: bucket.key,
        action: "login_mfa",
        limit: bucket.limit,
        windowSeconds: 60,
      })
      if (!rl.ok) {
        const status = rl.reason === "db_error" ? 503 : 429
        return NextResponse.json(
          { error: rl.reason === "db_error" ? "SECURITY_STATE_UNAVAILABLE" : "RATE_LIMITED",
            message: "Too many MFA attempts. Retry shortly." },
          { status, headers: { "Retry-After": String(Math.max(1, rl.retryAfter)) } }
        )
      }
    }

    const passClient = createClient(supabaseUrl, supabaseAnonKey)
    const { data: signIn, error: signInError } = await passClient.auth.signInWithPassword({ email, password })
    if (signInError || !signIn.session) {
      return NextResponse.json(
        { error: "AUTH_FAILED", message: "이메일 또는 비밀번호가 올바르지 않습니다." },
        { status: 401 }
      )
    }

    // `admin` was created above for the durable rate-limit calls;
    // reuse it here to avoid a second service-role client allocation.

    // SECURITY (R-6 remediation): load PRIMARY membership only and
    // fail closed if data is ambiguous (>1 primary). Same policy as
    // /api/auth/login.
    const { data: memberships } = await admin
      .from("store_memberships")
      .select("id, store_uuid, role, status")
      .eq("profile_id", signIn.user.id)
      .eq("is_primary", true)
      .eq("status", "approved")
      .is("deleted_at", null)
      .limit(2)
    if (!memberships || memberships.length === 0) {
      try { await passClient.auth.signOut() } catch {}
      return NextResponse.json(
        { error: "MEMBERSHIP_NOT_APPROVED", message: "승인되지 않은 계정입니다." },
        { status: 401 }
      )
    }
    if (memberships.length > 1) {
      try { await passClient.auth.signOut() } catch {}
      return NextResponse.json(
        { error: "MEMBERSHIP_AMBIGUOUS", message: "계정 설정 오류. 관리자에게 문의하세요." },
        { status: 500 }
      )
    }
    const membership = memberships[0] as { id: string; store_uuid: string; role: string; status: string }

    // Load MFA envelope.
    const { data: mfaRow } = await admin
      .from("user_mfa_settings")
      .select("is_enabled, secret_iv, secret_ciphertext, secret_auth_tag")
      .eq("user_id", signIn.user.id)
      .is("deleted_at", null)
      .maybeSingle()
    const rec = mfaRow as {
      is_enabled: boolean
      secret_iv: string | null
      secret_ciphertext: string | null
      secret_auth_tag: string | null
    } | null

    if (!rec?.is_enabled || !rec.secret_iv || !rec.secret_ciphertext || !rec.secret_auth_tag) {
      try { await passClient.auth.signOut() } catch {}
      return NextResponse.json(
        { error: "MFA_NOT_ENABLED", message: "MFA is not enabled for this account." },
        { status: 409 }
      )
    }

    let ok = false
    let usedBackupCode = false
    let backupCodesRemaining: number | null = null

    if (isBackup) {
      // R25: 백업 코드 경로. consume 가 race-safe atomic update.
      //   성공 시 해당 코드는 즉시 폐기 (1회용).
      const r = await consumeBackupCode(admin, signIn.user.id, code)
      if (r.ok) {
        ok = true
        usedBackupCode = true
        backupCodesRemaining = r.remaining
      }
    } else {
      try {
        const secret = decryptSecret({
          iv: Buffer.from(rec.secret_iv, "base64"),
          ciphertext: Buffer.from(rec.secret_ciphertext, "base64"),
          auth_tag: Buffer.from(rec.secret_auth_tag, "base64"),
        })
        ok = verifyTotp(secret, code)
      } catch {
        ok = false
      }
    }

    if (!ok) {
      // Audit invalid attempt. Use the resolved membership so
      // store_uuid attribution is accurate.
      await logAuditEvent(admin, {
        auth: {
          user_id: signIn.user.id,
          membership_id: membership.id,
          store_uuid: membership.store_uuid,
          role: membership.role as "owner" | "manager" | "hostess",
          membership_status: "approved",
          global_roles: [],
          is_super_admin: false,
        },
        action: "login_mfa_failed",
        entity_table: "profiles",
        entity_id: signIn.user.id,
        status: "denied",
        reason: "INVALID_CODE",
      })
      try { await passClient.auth.signOut() } catch {}
      return NextResponse.json({ error: "INVALID_CODE" }, { status: 401 })
    }

    // Auto-register the device as trusted (upsert unrevoked row).
    if (rememberDevice && clientDeviceId) {
      try {
        const deviceHash = hashDevice(signIn.user.id, clientDeviceId)
        const nowIso = new Date().toISOString()
        const { data: existing } = await admin
          .from("trusted_devices")
          .select("id")
          .eq("user_id", signIn.user.id)
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
            user_id: signIn.user.id,
            device_hash: deviceHash,
            device_name: deviceName,
            user_agent_summary: request.headers.get("user-agent")?.slice(0, 200) ?? null,
            first_seen_at: nowIso,
            last_seen_at: nowIso,
            trusted_at: nowIso,
          })
          await logAuditEvent(admin, {
            auth: {
              user_id: signIn.user.id,
              membership_id: membership.id,
              store_uuid: membership.store_uuid,
              role: membership.role as "owner" | "manager" | "hostess",
              membership_status: "approved",
              global_roles: [],
              is_super_admin: false,
            },
            action: "trusted_device_registered",
            entity_table: "profiles",
            entity_id: signIn.user.id,
            status: "success",
            metadata: { device_name: deviceName },
          })
        }
      } catch {
        // Device registration is best-effort.
      }
    }

    await logAuditEvent(admin, {
      auth: {
        user_id: signIn.user.id,
        membership_id: membership.id,
        store_uuid: membership.store_uuid,
        role: membership.role as "owner" | "manager" | "hostess",
        membership_status: "approved",
        global_roles: [],
        is_super_admin: false,
      },
      // R25: 백업 코드 사용 여부를 audit 에 별도 액션으로 기록.
      //   "내가 안 쓴 백업 코드가 소비됐다" 신호 추적용.
      action: usedBackupCode ? "login_mfa_backup_code_used" : "login_mfa_success",
      entity_table: "profiles",
      entity_id: signIn.user.id,
      status: "success",
      metadata: usedBackupCode
        ? { backup_codes_remaining: backupCodesRemaining }
        : undefined,
    })

    const res = NextResponse.json({
      access_token: signIn.session.access_token,
      user_id: signIn.user.id,
      membership_id: membership.id,
      role: membership.role,
      store_uuid: membership.store_uuid,
      mfa_enabled: true,
      // 백업 코드로 들어왔으면 클라이언트에 강한 경고 + 잔여 개수 노출.
      used_backup_code: usedBackupCode,
      backup_codes_remaining: backupCodesRemaining,
    })
    // 2026-04-28: 4h 운영 정책 — login/route.ts 와 동일 로직.
    const FOUR_HOURS_S = 4 * 60 * 60
    const sessionExpires = typeof signIn.session.expires_in === "number"
      ? signIn.session.expires_in
      : 3600
    res.cookies.set({
      name: "nox_access_token",
      value: signIn.session.access_token,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: Math.min(FOUR_HOURS_S, sessionExpires),
    })
    return res
  } catch {
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "서버 오류." }, { status: 500 })
  }
}
