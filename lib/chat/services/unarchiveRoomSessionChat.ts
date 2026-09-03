/**
 * lib/chat/services/unarchiveRoomSessionChat.ts
 *
 * R31 (2026-09-04): 세션 reopen 시 archiveRoomSessionChat 으로 is_active=false 처리된
 * 방채팅 (type='room_session') 을 다시 활성화.
 *
 * 대칭: archiveRoomSessionChat 이 close/force-close/auto-close 에서 호출되어
 * chat_rooms.is_active=false 로 만든다. reopen 은 이 반대로 복원.
 *
 * fire-and-forget: 실패해도 세션 reopen 은 성공. best-effort.
 */
import type { SupabaseClient } from "@supabase/supabase-js"

export async function unarchiveRoomSessionChat(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<{ restored_count: number }> {
  const { data } = await supabase
    .from("chat_rooms")
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq("type", "room_session")
    .eq("session_id", sessionId)
    .eq("is_active", false)
    .select("id")
  return { restored_count: (data ?? []).length }
}
