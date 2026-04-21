import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { generateSecret, encodeBase32, buildOtpauthUri } from "@/lib/security/totp"
import { encryptSecret } from "@/lib/security/crypto"
import { logAuditEvent } from "@/lib/audit/logEvent"

/**
 * STEP-013D: POST /api/auth/mfa/setup
 *
 * Issues a fresh TOTP secret for the authenticated user, stores the
 * AES-256-GCM encrypted envelope into `user_mfa_settings` with
 * `is_enabled=false`, and returns a one-shot base32 secret + otpauth
 * URI so the client can render a QR. The raw secret is returned ONCE;
 * it is never written to logs, audit events, or response bodies after
 * the `enable` step.
 *
 * If `is_enabled` is already true for this user, the call is rejected
 * — disable first, then re-setup. This prevents silently rotating the
 * secret behind an existing enabled flag.
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
    const supabase = supa()

    const { data: existing } = await supabase
      .from("user_mfa_settings")
      .select("id, is_enabled")
      .eq("user_id", auth.user_id)
      .is("deleted_at", null)
      .maybeSingle()

    if ((existing as { is_enabled?: boolean } | null)?.is_enabled) {
      return NextResponse.json(
        { error: "MFA_ALREADY_ENABLED", message: "Disable MFA before re-setup." },
        { status: 409 }
      )
    }

    const secret = generateSecret(20)
    const env = encryptSecret(secret)
    const secretBase32 = encodeBase32(secret)

    const payload = {
      user_id: auth.user_id,
      is_enabled: false,
      secret_iv: env.iv.toString("base64"),
      secret_ciphertext: env.ciphertext.toString("base64"),
      secret_auth_tag: env.auth_tag.toString("base64"),
      updated_at: new Date().toISOString(),
    }

    if (existing) {
      await supabase.from("user_mfa_settings").update(payload).eq("user_id", auth.user_id)
    } else {
      await supabase.from("user_mfa_settings").insert(payload)
    }

    const uri = buildOtpauthUri({
      secretBase32,
      accountName: auth.user_id,
      issuer: "NOX",
    })

    await logAuditEvent(supabase, {
      auth,
      action: "mfa_setup_started",
      entity_table: "profiles",
      entity_id: auth.user_id,
      status: "success",
      metadata: {}, // intentionally no secret material
    })

    return NextResponse.json({ secret_base32: secretBase32, otpauth_uri: uri })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
