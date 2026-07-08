import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"

export type ChatRoomRow = {
  id: string
  store_uuid: string
  type: string
  session_id: string | null
  is_active: boolean
  created_by: string | null
}

type LoadResult =
  | { room: ChatRoomRow; error?: never }
  | { room?: never; error: NextResponse }

/**
 * Loads a chat room by id with store_uuid scope.
 *
 * Extracts the repeated room lookup + store scope + is_active check
 * from close, leave, read, pin, messages, and participants routes.
 */
export async function loadRoomScoped(
  supabase: SupabaseClient,
  roomId: string,
  store_uuid: string,
  opts?: { allowClosed?: boolean }
): Promise<LoadResult> {
  // R-inter-store (2026-07-08): store 검증 없이 방 정보 먼저 조회 후,
  //   type='inter_store' 이면 store 매칭 skip. 그 외는 store_uuid 강제.
  const { data: roomRaw } = await supabase
    .from("chat_rooms")
    .select("id, store_uuid, type, session_id, is_active, created_by")
    .eq("id", roomId)
    .maybeSingle()

  const room = roomRaw as ChatRoomRow | null

  if (!room) {
    return {
      error: NextResponse.json({ error: "ROOM_NOT_FOUND", message: "채팅방을 찾을 수 없습니다." }, { status: 404 }),
    }
  }

  // inter_store 통합 채팅방은 store scope 검증 skip (모든 매장 공용).
  //   그 외 타입은 store_uuid 매칭 필수 — 다른 매장 방 접근 차단.
  if (room.type !== "inter_store" && room.store_uuid !== store_uuid) {
    return {
      error: NextResponse.json({ error: "ROOM_NOT_FOUND", message: "채팅방을 찾을 수 없습니다." }, { status: 404 }),
    }
  }

  if (!opts?.allowClosed && !room.is_active) {
    return {
      error: NextResponse.json({ error: "ROOM_CLOSED", message: "비활성 채팅방입니다." }, { status: 403 }),
    }
  }

  return { room }
}
