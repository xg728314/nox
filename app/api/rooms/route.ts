import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { defaultRoomName } from "@/lib/rooms/formatRoomLabel"
import { getRooms } from "@/lib/server/queries/rooms"

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager", "waiter", "staff"].includes(authContext.role)) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Access denied." },
        { status: 403 }
      )
    }

    try {
      const data = await getRooms(authContext)
      return NextResponse.json(data)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to query rooms."
      return NextResponse.json(
        { error: "QUERY_FAILED", message: msg },
        { status: 500 }
      )
    }
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" ? 401 :
        error.type === "AUTH_INVALID" ? 401 :
        error.type === "MEMBERSHIP_NOT_FOUND" ? 403 :
        error.type === "MEMBERSHIP_INVALID" ? 403 :
        error.type === "MEMBERSHIP_NOT_APPROVED" ? 403 :
        error.type === "SERVER_CONFIG_ERROR" ? 500 :
        500

      return NextResponse.json(
        { error: error.type, message: error.message },
        { status }
      )
    }

    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Unexpected error." },
      { status: 500 }
    )
  }
}

/**
 * POST /api/rooms — 새 방 추가 (다음 번호 자동 생성)
 */
export async function POST(request: Request) {
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

    // Find the highest room_no to determine next number
    const { data: existing } = await supabase
      .from("rooms")
      .select("room_no, sort_order")
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .order("sort_order", { ascending: false })
      .limit(1)

    const maxSort = existing?.[0]?.sort_order ?? 0
    const nextNum = maxSort + 1
    const roomNo = String(nextNum)
    const roomName = defaultRoomName(nextNum)

    const { data: room, error: insertError } = await supabase
      .from("rooms")
      .insert({
        store_uuid: authContext.store_uuid,
        room_no: roomNo,
        room_name: roomName,
        sort_order: nextNum,
        is_active: true,
      })
      .select("id, room_no, room_name, is_active, sort_order")
      .single()

    if (insertError || !room) {
      console.error("[rooms POST] insert failed:", insertError?.message)
      return NextResponse.json(
        { error: "CREATE_FAILED", message: "방 생성에 실패했습니다." },
        { status: 500 }
      )
    }

    // Audit
    await supabase.from("audit_events").insert({
      store_uuid: authContext.store_uuid,
      actor_profile_id: authContext.user_id,
      actor_membership_id: authContext.membership_id,
      actor_role: authContext.role,
      actor_type: authContext.role,
      entity_table: "rooms",
      entity_id: room.id,
      action: "room_created",
      after: { room_no: roomNo, room_name: roomName, sort_order: nextNum },
    })

    return NextResponse.json({ room }, { status: 201 })
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
