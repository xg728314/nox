import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { parseUuid } from "@/lib/security/guards"
import { logAuditEvent } from "@/lib/audit/logEvent"

/**
 * STEP-013D: POST /api/auth/devices/revoke
 *
 * Revokes a trusted device owned by the caller. Self-scope only — the
 * row must belong to auth.user_id or the call returns 404 to avoid
 * leaking id existence. Revocation is soft (revoked_at set) so audit
 * history survives.
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
    const body = (await request.json().catch(() => ({}))) as { device_id?: unknown }
    const deviceId = parseUuid(body.device_id)
    if (!deviceId) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "device_id must be a valid uuid." }, { status: 400 })
    }

    const supabase = supa()
    const { data: found } = await supabase
      .from("trusted_devices")
      .select("id")
      .eq("id", deviceId)
      .eq("user_id", auth.user_id)
      .is("revoked_at", null)
      .maybeSingle()
    if (!found) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }

    await supabase
      .from("trusted_devices")
      .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", deviceId)
      .eq("user_id", auth.user_id)

    await logAuditEvent(supabase, {
      auth,
      action: "trusted_device_revoked",
      entity_table: "profiles",
      entity_id: auth.user_id,
      status: "success",
      metadata: { device_id: deviceId },
    })

    return NextResponse.json({ revoked: true })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
