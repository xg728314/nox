import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { formatRoomLabel } from "@/lib/rooms/formatRoomLabel"

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager"].includes(authContext.role)) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Access denied." },
        { status: 403 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: presences, error: fetchError } = await supabase
      .from("ble_tag_presence")
      .select("id, store_uuid, minor, room_uuid, membership_id, last_event_type, last_seen_at, updated_at")
      .eq("store_uuid", authContext.store_uuid)
      .order("last_seen_at", { ascending: false })

    if (fetchError) {
      return NextResponse.json(
        { error: "QUERY_FAILED", message: "Failed to query BLE presence." },
        { status: 500 }
      )
    }

    // room 이름 조회
    type PresenceRow = { id: string; store_uuid: string; minor: number; room_uuid: string | null; membership_id: string | null; last_event_type: string | null; last_seen_at: string | null; updated_at: string }
    const roomUuids = [...new Set((presences ?? []).map((p: PresenceRow) => p.room_uuid).filter(Boolean))]
    const roomMap = new Map<string, string>()
    if (roomUuids.length > 0) {
      const { data: rooms } = await supabase
        .from("rooms")
        .select("id, room_name, room_no")
        .eq("store_uuid", authContext.store_uuid)
        .in("id", roomUuids)

      for (const r of rooms ?? []) {
        roomMap.set(r.id, formatRoomLabel(r))
      }
    }

    // membership 이름 조회
    const membershipIds = [...new Set((presences ?? []).map((p: PresenceRow) => p.membership_id).filter(Boolean))]
    const nameMap = new Map<string, string>()
    if (membershipIds.length > 0) {
      const { data: hostesses } = await supabase
        .from("hostesses")
        .select("membership_id, name")
        .eq("store_uuid", authContext.store_uuid)
        .in("membership_id", membershipIds)

      for (const h of hostesses ?? []) {
        nameMap.set(h.membership_id, h.name)
      }
    }

    const enriched = (presences ?? []).map((p: PresenceRow) => ({
      ...p,
      room_name: (p.room_uuid && roomMap.get(p.room_uuid)) || null,
      hostess_name: (p.membership_id && nameMap.get(p.membership_id)) || null,
    }))

    return NextResponse.json({
      store_uuid: authContext.store_uuid,
      count: enriched.length,
      presences: enriched,
    })

  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" ? 401 :
        error.type === "AUTH_INVALID" ? 401 :
        error.type === "MEMBERSHIP_NOT_FOUND" ? 403 :
        error.type === "MEMBERSHIP_INVALID" ? 403 :
        error.type === "MEMBERSHIP_NOT_APPROVED" ? 403 :
        error.type === "SERVER_CONFIG_ERROR" ? 500 : 500
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Unexpected error." }, { status: 500 })
  }
}
