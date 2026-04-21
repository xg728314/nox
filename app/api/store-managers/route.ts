import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { parseUuid } from "@/lib/security/guards"

/**
 * STEP-015: GET /api/store-managers
 *
 * Read-only list of approved manager memberships for picker UX.
 * Owner-only. The `store_uuid` query parameter defaults to the caller's
 * own store — explicit cross-store lookup (for cross-store settlement
 * items allocating to managers at the destination store) is allowed
 * because the spec's use-case is "allocate payout to managers at the
 * target store we're about to settle with."
 *
 * Query:
 *   ?store_uuid=<uuid>   — defaults to auth.store_uuid
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
    if (auth.role !== "owner") {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }

    const url = new URL(request.url)
    const rawStore = url.searchParams.get("store_uuid")
    const storeUuid = rawStore ? parseUuid(rawStore) : auth.store_uuid
    if (!storeUuid) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "store_uuid must be a valid uuid." },
        { status: 400 }
      )
    }

    const supabase = supa()
    const { data: memberships } = await supabase
      .from("store_memberships")
      .select("id, profile_id, role, status")
      .eq("store_uuid", storeUuid)
      .eq("role", "manager")
      .eq("status", "approved")
      .is("deleted_at", null)
      .limit(500)

    const rows = (memberships ?? []) as Array<{ id: string; profile_id: string; role: string; status: string }>
    const profileIds = Array.from(new Set(rows.map(r => r.profile_id)))
    const nameById: Record<string, string> = {}
    if (profileIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", profileIds)
      for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null }>) {
        nameById[p.id] = p.full_name ?? p.id.slice(0, 8)
      }
    }

    const managers = rows
      .map(r => ({
        membership_id: r.id,
        profile_id: r.profile_id,
        name: nameById[r.profile_id] ?? r.profile_id.slice(0, 8),
        store_uuid: storeUuid,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"))

    return NextResponse.json({ managers })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
