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
  const { data: roomRaw } = await supabase
    .from("chat_rooms")
    .select("id, store_uuid, type, session_id, is_active, created_by")
    .eq("id", roomId)
    .eq("store_uuid", store_uuid)
    .maybeSingle()

  const room = roomRaw as ChatRoomRow | null

  if (!room) {
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
