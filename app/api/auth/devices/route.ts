import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * STEP-013D: GET /api/auth/devices
 *
 * Returns the caller's trusted-device list (self-scoped only). Raw
 * device hashes are intentionally not exposed — only the derived id,
 * name, and timestamps so the UI can display + revoke.
 */

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const supabase = supa()
    const { data } = await supabase
      .from("trusted_devices")
      .select("id, device_name, user_agent_summary, first_seen_at, last_seen_at, trusted_at, revoked_at")
      .eq("user_id", auth.user_id)
      .order("last_seen_at", { ascending: false })
      .limit(200)
    return NextResponse.json({ devices: data ?? [] })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
