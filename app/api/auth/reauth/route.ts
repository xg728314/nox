import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { verifyTotp } from "@/lib/security/totp"
import { decryptSecret } from "@/lib/security/crypto"
import { REAUTH_TTL_MS, type ActionClass } from "@/lib/security/mfaPolicy"
import { logAuditEvent } from "@/lib/audit/logEvent"
import { rateLimit } from "@/lib/security/guards"
import { rateLimitDurable } from "@/lib/security/rateLimitDurable"

/**
 * STEP-013D: POST /api/auth/reauth
 *
 * Body: { action_class: 'financial_write' | 'account_change', code: '123456' }
 *
 * Verifies a fresh TOTP code (for users with MFA enabled) or the
 * current password (for users without MFA — future follow-up; for now
 * non-MFA users can still obtain a reauth row by calling with an
 * empty code which returns 409 MFA_REQUIRED). On success, inserts a
 * short-lived `reauth_verifications` row that financial write routes
 * check via `hasRecentReauth`.
 */

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

const VALID_ACTION_CLASSES: ActionClass[] = ["financial_write", "account_change"]

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    // Fast-path in-memory burst guard.
    const rlLocal = rateLimit(`reauth:${auth.user_id}`, { limit: 20, windowMs: 60_000 })
    if (!rlLocal.ok) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many reauth attempts. Retry shortly." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rlLocal.retryAfter / 1000)) } }
      )
    }
    // SECURITY (R-7): durable rate-limit. Reauth protects financial
    // writes; multi-instance bypass would let a stolen session still
    // brute-force the TOTP gate.
    const supabaseForRate = supa()
    const rl = await rateLimitDurable(supabaseForRate, {
      key: `reauth:user:${auth.user_id}`,
      action: "reauth",
      limit: 10,
      windowSeconds: 60,
    })
    if (!rl.ok) {
      const status = rl.reason === "db_error" ? 503 : 429
      return NextResponse.json(
        { error: rl.reason === "db_error" ? "SECURITY_STATE_UNAVAILABLE" : "RATE_LIMITED",
          message: "Too many reauth attempts. Retry shortly." },
        { status, headers: { "Retry-After": String(Math.max(1, rl.retryAfter)) } }
      )
    }
    const body = (await request.json().catch(() => ({}))) as { action_class?: string; code?: string }
    const actionClass = body.action_class as ActionClass
    if (!VALID_ACTION_CLASSES.includes(actionClass)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "invalid action_class." }, { status: 400 })
    }
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
      return NextResponse.json({ error: "MFA_REQUIRED", message: "Enable MFA before re-authenticating." }, { status: 409 })
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
        action: "reauth_failed",
        entity_table: "profiles",
        entity_id: auth.user_id,
        status: "denied",
        reason: "INVALID_CODE",
        metadata: { action_class: actionClass },
      })
      return NextResponse.json({ error: "INVALID_CODE" }, { status: 401 })
    }

    const now = Date.now()
    const expiresAt = new Date(now + REAUTH_TTL_MS).toISOString()
    await supabase.from("reauth_verifications").insert({
      user_id: auth.user_id,
      action_class: actionClass,
      verified_at: new Date(now).toISOString(),
      expires_at: expiresAt,
    })

    await logAuditEvent(supabase, {
      auth,
      action: "reauth_success",
      entity_table: "profiles",
      entity_id: auth.user_id,
      status: "success",
      metadata: { action_class: actionClass, expires_at: expiresAt },
    })

    return NextResponse.json({ ok: true, expires_at: expiresAt })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
