import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { verifyTotp } from "@/lib/security/totp"
import { decryptSecret } from "@/lib/security/crypto"
import { logAuditEvent } from "@/lib/audit/logEvent"
import { rateLimit } from "@/lib/security/guards"
import { rateLimitDurable } from "@/lib/security/rateLimitDurable"
import { generateBackupCodes } from "@/lib/security/backupCodes"

/**
 * STEP-013D: POST /api/auth/mfa/enable
 *
 * Flips is_enabled=true after a successful TOTP check. This is the
 * point where MFA becomes load-bearing for the account — do not allow
 * the flag to flip without a valid code.
 */

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    // Fast-path burst guard.
    const rlLocal = rateLimit(`mfa-enable:${auth.user_id}`, { limit: 20, windowMs: 60_000 })
    if (!rlLocal.ok) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many MFA attempts. Retry shortly." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rlLocal.retryAfter / 1000)) } }
      )
    }
    // SECURITY (R-7): durable rate-limit.
    const rl = await rateLimitDurable(supa(), {
      key: `mfa-enable:user:${auth.user_id}`,
      action: "mfa_enable",
      limit: 10,
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
    const body = (await request.json().catch(() => ({}))) as { code?: string }
    const code = typeof body.code === "string" ? body.code.trim() : ""
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "6-digit code required." }, { status: 400 })
    }

    const supabase = supa()
    const { data: row } = await supabase
      .from("user_mfa_settings")
      .select("id, is_enabled, secret_iv, secret_ciphertext, secret_auth_tag")
      .eq("user_id", auth.user_id)
      .is("deleted_at", null)
      .maybeSingle()
    const rec = row as {
      id: string
      is_enabled: boolean
      secret_iv: string | null
      secret_ciphertext: string | null
      secret_auth_tag: string | null
    } | null

    if (!rec?.secret_iv || !rec.secret_ciphertext || !rec.secret_auth_tag) {
      return NextResponse.json({ error: "MFA_NOT_SETUP" }, { status: 409 })
    }

    let ok = false
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

    if (!ok) {
      await logAuditEvent(supabase, {
        auth,
        action: "mfa_verification_failed",
        entity_table: "profiles",
        entity_id: auth.user_id,
        status: "denied",
        reason: "INVALID_CODE",
      })
      return NextResponse.json({ error: "INVALID_CODE" }, { status: 401 })
    }

    // R25: enable 시 백업 코드 8개 발급. 평문은 응답에 1회 노출 후 폐기.
    //   서버는 SHA-256 해시만 저장. 사용자가 못 받아도 곧 regenerate 가능.
    const { plain: backupCodesPlain, hashed: backupCodesHashed } = generateBackupCodes()

    await supabase
      .from("user_mfa_settings")
      .update({
        is_enabled: true,
        enabled_at: new Date().toISOString(),
        backup_codes_hashed: backupCodesHashed,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", auth.user_id)

    await logAuditEvent(supabase, {
      auth,
      action: "mfa_enabled",
      entity_table: "profiles",
      entity_id: auth.user_id,
      status: "success",
      metadata: { backup_codes_issued: backupCodesPlain.length },
    })

    return NextResponse.json({
      enabled: true,
      backup_codes: backupCodesPlain,
      backup_codes_warning:
        "이 코드는 지금 한 번만 표시됩니다. 안전한 곳에 저장하세요. 폰을 분실해도 로그인할 수 있는 유일한 방법입니다.",
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
