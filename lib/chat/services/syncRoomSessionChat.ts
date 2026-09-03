/**
 * syncRoomSessionChat — 세션의 모든 active participant + 담당 매니저를
 * room_session 채팅방의 chat_participants 로 일괄 sync.
 *
 *   사용 시점:
 *     1. session 신규 체크인 (sessions/checkin)
 *     2. 새 participant 추가 (sessions/participants POST)
 *     3. cross-store dispatch (cross-store/dispatch — 외부 식구 등록)
 *
 *   동작:
 *     1. chat_room (type='room_session', session_id) 존재 확인 — 없으면 생성
 *     2. 세션의 active participants 모두 chat_participants 에 upsert
 *     3. 세션의 manager_membership_id 도 함께 upsert
 *     4. 본 매장 + 외부 식구 (cross-store) 모두 자동 참여
 *
 *   주의: 호출자는 background fire-and-forget 으로 호출 권장
 *         (chat 동기화 실패해도 session 흐름 막지 않게).
 */
import { type SupabaseClient } from "@supabase/supabase-js"

export async function syncRoomSessionChat(
  supabase: SupabaseClient,
  params: {
    session_id: string
    store_uuid: string
    /** 호출자 — chat_room 생성 시 created_by */
    actor_membership_id?: string | null
  },
): Promise<{ chat_room_id: string; synced_count: number } | { error: string }> {
  const { session_id, store_uuid, actor_membership_id } = params

  // 1. 세션 정보 (room_uuid, manager_membership_id, status)
  const { data: session, error: sessErr } = await supabase
    .from("room_sessions")
    .select("id, room_uuid, manager_membership_id, status")
    .eq("id", session_id)
    .eq("store_uuid", store_uuid)
    .maybeSingle()

  if (sessErr || !session) {
    return { error: "SESSION_NOT_FOUND" }
  }
  if ((session as { status: string }).status !== "active") {
    return { error: "SESSION_NOT_ACTIVE" }
  }

  // 2. 방 이름 · rooms 컬럼은 room_name / room_no
  //    R-column-fix (2026-09-04): 이전 SELECT("name") 은 42703 오류 발생 → 폴백 "룸"
  //    으로 모든 채팅방 이름이 "룸 채팅" 통일되어 방 구분 안 됨.
  const { data: room } = await supabase
    .from("rooms")
    .select("room_name, room_no")
    .eq("id", (session as { room_uuid: string }).room_uuid)
    .eq("store_uuid", store_uuid)
    .is("deleted_at", null)
    .maybeSingle()
  const roomRow = room as { room_name?: string | null; room_no?: string | null } | null
  const roomName = roomRow?.room_name || (roomRow?.room_no ? `${roomRow.room_no}번방` : "룸")

  // 3. chat_room 조회 또는 생성
  const { data: existing } = await supabase
    .from("chat_rooms")
    .select("id")
    .eq("store_uuid", store_uuid)
    .eq("type", "room_session")
    .eq("session_id", session_id)
    .eq("is_active", true)
    .maybeSingle()

  let chatRoomId: string
  if (existing) {
    chatRoomId = (existing as { id: string }).id
  } else {
    const { data: created, error: createErr } = await supabase
      .from("chat_rooms")
      .insert({
        store_uuid,
        type: "room_session",
        session_id,
        room_uuid: (session as { room_uuid: string }).room_uuid,
        name: `${roomName} 채팅`,
        created_by: actor_membership_id ?? null,
      })
      .select("id")
      .single()

    if (createErr) {
      // 23505 race — 누군가 이미 만듦
      const { data: retry } = await supabase
        .from("chat_rooms")
        .select("id")
        .eq("store_uuid", store_uuid)
        .eq("type", "room_session")
        .eq("session_id", session_id)
        .eq("is_active", true)
        .maybeSingle()
      if (!retry) return { error: "CREATE_FAILED" }
      chatRoomId = (retry as { id: string }).id
    } else {
      chatRoomId = (created as { id: string }).id
    }
  }

  // 4. 참여자 집합 구성:
  //    - 세션의 active participants (본 매장 + cross-store 외부 식구)
  //    - 세션 담당 매니저
  const { data: parts } = await supabase
    .from("session_participants")
    .select("membership_id")
    .eq("session_id", session_id)
    .eq("status", "active")
    .is("deleted_at", null)

  const memSet = new Set<string>()
  for (const p of (parts ?? []) as { membership_id: string }[]) {
    memSet.add(p.membership_id)
  }
  const managerMid = (session as { manager_membership_id?: string | null }).manager_membership_id
  if (managerMid) memSet.add(managerMid)
  // R-include-actor (2026-06-28): dispatch 호출자(=사용자)도 채팅 참여자에 추가.
  //   사용자 요구: '마블실장 + 파 지수 + 신 미연 그룹채팅'. 이전엔 세션 매니저만
  //   추가돼서 사용자가 호출했어도 (다른 매니저가 지정되면) 채팅 목록에 안 떴음.
  if (actor_membership_id) memSet.add(actor_membership_id)

  if (memSet.size === 0) {
    return { chat_room_id: chatRoomId, synced_count: 0 }
  }

  // 5. chat_participants 일괄 upsert
  //    cross-store 식구의 store_uuid 는 본인 origin 매장이 아닌 채팅방 매장 (= working store)
  //    으로 등록 — chat_participants 의 store_uuid 는 채팅방 scope 매장.
  const rows = Array.from(memSet).map((mid) => ({
    chat_room_id: chatRoomId,
    membership_id: mid,
    store_uuid,
  }))

  const { error: upErr } = await supabase
    .from("chat_participants")
    .upsert(rows, { onConflict: "chat_room_id,membership_id" })

  if (upErr) {
    return { error: `UPSERT_FAILED: ${upErr.message}` }
  }

  return { chat_room_id: chatRoomId, synced_count: rows.length }
}
