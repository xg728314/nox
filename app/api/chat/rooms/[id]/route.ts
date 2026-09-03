/**
 * GET /api/chat/rooms/[id] — 채팅방 메타 정보 (type · session_id · room · name)
 *
 * R-chat-room-meta (2026-09-04): 채팅 페이지에서 「이 방이 room_session 인지?」
 * 판별하고 session_id 를 가져와 서비스 콜 트리거 등 컨텍스트-의존 UI 노출.
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await resolveAuthContext(request)
    const { id } = await params
    if (!isValidUUID(id)) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })

    const sb = getServiceClient()

    // 채팅방 정보
    const { data: room } = await sb.from("chat_rooms")
      .select("id, store_uuid, type, session_id, room_uuid, name, is_active, created_at")
      .eq("id", id).maybeSingle()
    if (!room) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })

    // 참여자 검증 (super_admin bypass)
    if (!auth.is_super_admin) {
      const { data: cp } = await sb.from("chat_participants")
        .select("id").eq("chat_room_id", id).eq("membership_id", auth.membership_id)
        .is("removed_at", null).limit(1).maybeSingle()
      if (!cp) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }

    // room_no lookup (session_id 있을 때 편의)
    let roomNo: string | null = null
    if (room.room_uuid) {
      const { data: r } = await sb.from("rooms").select("room_no").eq("id", room.room_uuid).maybeSingle()
      roomNo = (r as { room_no?: string } | null)?.room_no ?? null
    }

    // 세션 status (session_id 있을 때 · active 인 경우만 서비스 콜 노출 판단)
    let sessionActive = false
    if (room.session_id) {
      const { data: s } = await sb.from("room_sessions").select("status").eq("id", room.session_id).maybeSingle()
      sessionActive = (s as { status?: string } | null)?.status === "active"
    }

    return NextResponse.json({
      id: room.id,
      store_uuid: room.store_uuid,
      type: room.type,
      session_id: room.session_id ?? null,
      session_active: sessionActive,
      room_uuid: room.room_uuid ?? null,
      room_no: roomNo,
      name: room.name,
      is_active: room.is_active,
      created_at: room.created_at,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.type, message: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (error as Error).message }, { status: 500 })
  }
}
