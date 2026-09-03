/**
 * archiveRoomSessionChat — 세션 종료 시 room_session 채팅방 자동 비활성화.
 *
 * R-chat-cleanup-on-close (2026-09-04): 사용자 요구
 *   "1번방이 종료되면 열렸던 채팅창 자동 삭제되게 하자
 *    어차피 채팅창에는 중요한 내용이 없다"
 *
 * 접근:
 *   - hard delete 대신 is_active=false soft-archive (감사/증빙 유지)
 *   - getRoomList 는 is_active=true 만 반환 → UI 리스트에서 자동으로 사라짐
 *   - session_id 로 조회 · 여러 채팅방 있을 수 있으니 update by session_id
 *
 * 호출 지점:
 *   - /api/sessions/participants/[id]/leave (마지막 leave 시 · 이미 처리됨)
 *   - /api/sessions/[id]/force-close (신규 wire)
 *   - /api/sessions/auto-close-expired cron (신규 wire)
 *   - /api/sessions/checkout (close_session_atomic 후 · 신규 wire)
 *
 * fire-and-forget 권장 · 실패해도 세션 close 흐름 막지 않음.
 */
import { type SupabaseClient } from "@supabase/supabase-js"

export async function archiveRoomSessionChat(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<{ archived_count: number }> {
  const { data } = await supabase
    .from("chat_rooms")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("type", "room_session")
    .eq("session_id", sessionId)
    .eq("is_active", true)
    .select("id")
  return { archived_count: (data ?? []).length }
}
