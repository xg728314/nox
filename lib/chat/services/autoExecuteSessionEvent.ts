/**
 * autoExecuteSessionEvent — 채팅 파싱된 세션 이벤트 자동 실행.
 *
 * R-chat-auto-execute (2026-09-04): SESSION_EVENT_PATTERN 감지된 톡을
 * 감사만 하지 않고 실제 참여자 연장/종료 처리.
 *
 * 실행 조건:
 *   - 매장 자동실행 허용 (store_settings.chat_auto_execute = true)
 *   - 파싱 entries 각각 매칭 (매장 · 이름 → hostess membership)
 *   - 매칭된 아가씨의 active 참여자 찾기
 *   - event 에 따라:
 *      · '연장' N개 → participants POST 새 라운드 추가
 *      · '끝'/'메이드'/'완메' → participant leave
 *      · '시간체크' → started_at 지금 리셋 (사용자 판단)
 *
 * best-effort · 실패 시 audit 만 남기고 조용히 skip.
 */
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { parseStaffChat } from "@/app/counter/helpers/staffChatParser"

type ParsedEntry = ReturnType<typeof parseStaffChat>["entries"][number]

export async function autoExecuteSessionEvent(input: {
  chat_message_id: string
  chat_room_id: string
  sender_user_id: string
  sender_membership_id: string | null
  store_uuid: string
  content: string
  parsed: ReturnType<typeof parseStaffChat>
}): Promise<{ executed: number; skipped: number } | null> {
  const { content, store_uuid, parsed, chat_message_id, sender_user_id } = input
  const sb = getServiceClient()

  // R-guard-1 (2026-09-04): 매장 설정에서 자동 실행 허용 여부 확인
  const { data: settings } = await sb.from("store_settings")
    .select("chat_auto_execute").eq("store_uuid", store_uuid).maybeSingle()
  const autoAllowed = (settings as { chat_auto_execute?: boolean } | null)?.chat_auto_execute === true
  if (!autoAllowed) {
    // 설정 꺼져있으면 audit 만
    await sb.from("chat_auto_actions").insert({
      chat_message_id, chat_room_id: input.chat_room_id, sender_user_id,
      action_type: "session_event_skip",
      parsed_json: { reason: "auto_execute_disabled" },
      status: "skipped",
    })
    return null
  }

  let executed = 0
  let skipped = 0

  for (const e of parsed.entries) {
    try {
      const result = await executeOne(sb, e, content)
      if (result.ok) executed++
      else skipped++

      await sb.from("chat_auto_actions").insert({
        chat_message_id, chat_room_id: input.chat_room_id, sender_user_id,
        action_type: "session_event_exec",
        parsed_json: {
          name: e.name, store: e.origin_store_name, event: e.event,
          ticket: e.ticket_type, result,
        },
        status: result.ok ? "success" : "skipped",
        error_message: result.ok ? null : result.reason,
      })
    } catch (err) {
      skipped++
      // eslint-disable-next-line no-console
      console.warn("[autoExecuteSessionEvent] one failed:", err)
    }
  }

  return { executed, skipped }
}

async function executeOne(
  sb: ReturnType<typeof getServiceClient>,
  e: ParsedEntry,
  _content: string,
): Promise<{ ok: boolean; reason?: string; participant_id?: string }> {
  // 1. 이름 + 매장 → hostess membership 매칭
  if (!e.name) return { ok: false, reason: "no_name" }
  const originStore = e.origin_store_name
  if (!originStore) return { ok: false, reason: "no_origin_store" }

  const { data: stores } = await sb.from("stores").select("id").eq("store_name", originStore).limit(1)
  const originStoreId = (stores ?? [])[0]?.id
  if (!originStoreId) return { ok: false, reason: "store_not_found" }

  const { data: hs } = await sb.from("hostesses")
    .select("membership_id").eq("store_uuid", originStoreId).eq("name", e.name)
    .is("deleted_at", null).limit(1)
  const mid = (hs ?? [])[0]?.membership_id
  if (!mid) return { ok: false, reason: "hostess_not_found" }

  // 2. 현재 active 참여자 찾기 (가장 최근 entered)
  const { data: parts } = await sb.from("session_participants")
    .select("id, session_id, category, time_minutes, status")
    .eq("membership_id", mid).eq("status", "active").is("deleted_at", null)
    .order("entered_at", { ascending: false }).limit(1)
  const p = (parts ?? [])[0]
  if (!p) return { ok: false, reason: "no_active_participant" }

  // 3. event 별 처리
  //   parser event enum: 'START' | 'TIME_CHECK' | 'CHECKOUT' | 'CHOICE_REQUEST' | null
  //   추가로 e.state (연장 상태) 도 확인
  const isEnd = e.event === "CHECKOUT"
  const isExtend = (e as { state?: string }).state === "EXTENDED" || (e as { state?: string }).state === "extend"
  if (isEnd) {
    // leave endpoint 를 직접 호출하는 대신 DB update
    await sb.from("session_participants").update({
      status: "left", left_at: new Date().toISOString(),
    }).eq("id", p.id)
    return { ok: true, participant_id: p.id }
  }

  if (isExtend) {
    // 새 라운드 참여자 row 추가 (같은 세션 · 같은 mid · 새 entered_at)
    const { data: created, error } = await sb.from("session_participants").insert({
      session_id: p.session_id,
      membership_id: mid,
      role: "hostess",
      status: "active",
      category: p.category,
      time_minutes: p.time_minutes,
      entered_at: new Date().toISOString(),
    }).select("id").single()
    if (error) return { ok: false, reason: `extend_insert_failed: ${error.message}` }
    return { ok: true, participant_id: (created as { id: string }).id }
  }

  return { ok: false, reason: `event_not_handled: ${e.event}` }
}
