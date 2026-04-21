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

    // Type gate — only group rooms support manual close
    if (room.type !== "group") {
      const msg = room.type === "global"
        ? "매장 전체 채팅은 닫을 수 없습니다."
        : room.type === "room_session"
          ? "룸 세션 채팅은 체크아웃 시 자동으로 닫힙니���."
          : room.type === "direct"
            ? "1:1 채팅은 '나가기'를 사용하세요."
            : "이 채팅방은 닫을 수 없습니다."
      return NextResponse.json({ error: "NOT_ALLOWED", message: msg }, { status: 403 })
    }

    // Hostess cannot close groups
    if (authContext.role === "hostess") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    // Permission: creator OR store owner
    const isCreator = room.created_by === authContext.membership_id
    const isOwner = authContext.role === "owner"
    if (!isCreator && !isOwner) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "그룹 닫기는 생��자 또는 사장만 가능합니다." },
        { status: 403 }
      )
    }

    const now = new Date().toISOString()
    const { data: closed, error: closeErr } = await supabase
      .from("chat_rooms")
      .update({
        is_active: false,
        closed_at: now,
        closed_reason: "manual",
        updated_at: now,
      })
      .eq("id", id)
      .eq("store_uuid", authContext.store_uuid)
      .eq("is_active", true)
      .select("id")
    if (closeErr) {
      return NextResponse.json({ error: "UPDATE_FAILED", message: closeErr.message }, { status: 500 })
    }
    if (!closed || closed.length === 0) {
      return NextResponse.json({ error: "ROOM_NOT_FOUND" }, { status: 404 })
    }

    // Audit
    await supabase.from("audit_events").insert({
      store_uuid: authContext.store_uuid,
      actor_profile_id: authContext.user_id,
      actor_membership_id: authContext.membership_id,
      actor_role: authContext.role,
      actor_type: authContext.role,
      entity_table: "chat_rooms",
      entity_id: id,
      action: "chat_room_closed",
      before: { is_active: true },
      after: { is_active: false, closed_at: now, closed_reason: "manual" },
    })

    return NextResponse.json({ chat_room_id: id, action: "close", closed_at: now })
  } catch (error) {
    return handleRouteError(error, "chat/rooms/[id]/close")
  }
}
