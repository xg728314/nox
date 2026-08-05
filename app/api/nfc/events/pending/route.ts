/**
 * GET /api/nfc/events/pending
 *   실장/사장/웨이터 알림 배너용. 자기 매장의 pending 이벤트 리스트.
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (!["owner", "manager", "waiter"].includes(auth.role) && !auth.is_super_admin) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const sb = getServiceClient()
    let q = sb
      .from("nfc_scan_events")
      .select("id, tag_type, store_uuid, room_uuid, actor_membership_id, session_id, participant_id, scanned_at")
      .eq("status", "pending")
      .order("scanned_at", { ascending: false })
      .limit(50)
    if (!auth.is_super_admin) q = q.eq("store_uuid", auth.store_uuid)
    const { data, error } = await q
    if (error) {
      if ((error as { code?: string }).code === "42P01") return NextResponse.json({ pending: [], migration_pending: true })
      return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    }
    const events = data ?? []
    // actor 이름 · room 번호 lookup (bulk)
    type Ev = {
      id: string; tag_type: string; store_uuid: string; room_uuid: string | null
      actor_membership_id: string | null; session_id: string | null; participant_id: string | null
      scanned_at: string
      actor_name?: string; room_no?: string | null
    }
    const rows = events as Ev[]
    const memIds = Array.from(new Set(rows.map((r) => r.actor_membership_id).filter((x): x is string => !!x)))
    const roomIds = Array.from(new Set(rows.map((r) => r.room_uuid).filter((x): x is string => !!x)))
    const [memRes, roomRes] = await Promise.all([
      memIds.length > 0
        ? sb.from("store_memberships").select("id, profile_id").in("id", memIds)
        : Promise.resolve({ data: [] }),
      roomIds.length > 0
        ? sb.from("rooms").select("id, room_no").in("id", roomIds)
        : Promise.resolve({ data: [] }),
    ])
    const memRows = (memRes.data ?? []) as Array<{ id: string; profile_id: string }>
    const profileIds = memRows.map((m) => m.profile_id)
    const profRes = profileIds.length > 0
      ? await sb.from("profiles").select("id, full_name").in("id", profileIds)
      : { data: [] as Array<{ id: string; full_name: string | null }> }
    const nameByProfile = new Map((profRes.data ?? []).map((p) => [p.id, p.full_name ?? ""]))
    const nameByMem = new Map(memRows.map((m) => [m.id, nameByProfile.get(m.profile_id) ?? ""]))
    const roomNoById = new Map(((roomRes.data ?? []) as Array<{ id: string; room_no: string }>).map((r) => [r.id, r.room_no]))
    for (const r of rows) {
      r.actor_name = r.actor_membership_id ? (nameByMem.get(r.actor_membership_id) ?? "") : ""
      r.room_no = r.room_uuid ? (roomNoById.get(r.room_uuid) ?? null) : null
    }
    return NextResponse.json({ pending: rows })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
