import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { verifyTotp } from "@/lib/security/totp"
import { decryptSecret } from "@/lib/security/crypto"
import { logAuditEvent } from "@/lib/audit/logEvent"
import { rateLimit } from "@/lib/security/guards"
import { rateLimitDurable } from "@/lib/security/rateLimitDurable"

/**
 * STEP-013D: POST /api/auth/mfa/disable
 *
 * Disables MFA after confirming a live TOTP code — refuses to disable
 * on password-only proof so a stolen cookie alone cannot remove the
 * second factor. The encrypted secret is soft-cleared (envelope fields
 * wiped) so a future /setup issues a fresh secret rather than
 * reactivating the old one.
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
    const rlLocal = rateLimit(`mfa-disable:${auth.user_id}`, { limit: 20, windowMs: 60_000 })
    if (!rlLocal.ok) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many MFA attempts. Retry shortly." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rlLocal.retryAfter / 1000)) } }
      )
    }
    // SECURITY (R-7): durable rate-limit.
    const rl = await rateLimitDurable(supa(), {
      key: `mfa-disable:user:${auth.user_id}`,
      action: "mfa_disable",
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
      .select("is_enabled, secret_iv, secret_ciphertext, secret_auth_tag")
      .eq("user_id", auth.user_id)
      .is("deleted_at", null)
      .maybeSingle()
    const rec = row as {
      is_enabled: boolean
      secret_iv: string | null
      secret_ciphertext: string | null
      secret_auth_tag: string | null
    } | null

    if (!rec?.is_enabled || !rec.secret_iv || !rec.secret_ciphertext || !rec.secret_auth_tag) {
      return NextResponse.json({ error: "MFA_NOT_ENABLED" }, { status: 409 })
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

    await supabase
      .from("user_mfa_settings")
      .update({
        is_enabled: false,
        secret_iv: null,
        secret_ciphertext: null,
        secret_auth_tag: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", auth.user_id)

    await logAuditEvent(supabase, {
      auth,
      action: "mfa_disabled",
      entity_table: "profiles",
      entity_id: auth.user_id,
      status: "success",
    })

    return NextResponse.json({ disabled: true })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
