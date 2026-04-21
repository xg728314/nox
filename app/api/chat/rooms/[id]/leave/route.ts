import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { isValidUUID } from "@/lib/validation"
import { loadRoomScoped } from "@/lib/chat/queries/loadRoomScoped"

type Params = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Params) {
  try {
    const authContext = await resolveAuthContext(request)
    const { id } = await params

    if (!isValidUUID(id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "invalid chat room id." }, { status: 400 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // Room lookup + store scope + active check
    const roomResult = await loadRoomScoped(supabase, id, authContext.store_uuid)
    if (roomResult.error) return roomResult.error
    const room = roomResult.room

    // Type gate
    if (room.type === "global") {
      return NextResponse.json(
        { error: "NOT_ALLOWED", message: "매장 전체 채팅은 나갈 수 없습니다." },
        { status: 403 }
      )
    }
    if (room.type === "room_session") {
      return NextResponse.json(
        { error: "NOT_ALLOWED", message: "룸 세션 채팅은 체크아웃 시 자동으로 닫힙니다." },
        { status: 403 }
      )
    }
    if (room.type !== "direct" && room.type !== "group") {
      return NextResponse.json({ error: "NOT_ALLOWED" }, { status: 403 })
    }

    const nowIso = new Date().toISOString()
    const isCreatorLeavingGroup =
      room.type === "group" && room.created_by === authContext.membership_id

    // Soft-leave: update only caller's own active row
    const { data: updated, error: upErr } = await supabase
      .from("chat_participants")
      .update({ left_at: nowIso })
      .eq("chat_room_id", id)
      .eq("membership_id", authContext.membership_id)
      .eq("store_uuid", authContext.store_uuid)
      .is("left_at", null)
      .select("id")
    if (upErr) {
      return NextResponse.json({ error: "UPDATE_FAILED", message: upErr.message }, { status: 500 })
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: "NOT_PARTICIPANT" }, { status: 404 })
    }

    // If the creator of a group leaves, auto-close the room
    if (isCreatorLeavingGroup) {
      const { error: closeErr } = await supabase
        .from("chat_rooms")
        .update({
          is_active: false,
          closed_at: nowIso,
          closed_reason: "creator_left",
        })
        .eq("id", id)
        .eq("store_uuid", authContext.store_uuid)
      if (closeErr) {
        return NextResponse.json({ error: "CLOSE_FAILED", message: closeErr.message }, { status: 500 })
      }
      return NextResponse.json({ chat_room_id: id, action: "closed", closed_reason: "creator_left" })
    }

    return NextResponse.json({ chat_room_id: id, action: "leave" })
  } catch (error) {
    return handleRouteError(error, "chat/rooms/[id]/leave")
  }
}
