/**
 * Sprint 2 (2026-07-29): 매장별 대기 인원 상태 트래킹 + 초이스톡 edit.
 *
 * 핵심 spam 방지:
 *   - 사람이 "3인 초이스 있어요" 반복 안 쓰게 · NOX 가 대신 관리
 *   - 상태 변경 감지 (state hash) · 변경 시만 발행 or edit
 *   - 채팅방에 초이스톡은 항상 1개만 존재 (신규 발행 X · UPDATE)
 *   - 채팅창 도배 방지 · 실장 알림 피로 감소
 *
 * 호출 시점:
 *   - session_participants INSERT (아가씨 방 배정)
 *   - session_participants leave (아가씨 방 나옴)
 *   - attendance checkin/checkout
 *   - 매장 오픈/마감
 *
 * 로직:
 *   1. computeStoreChoiceState(storeUuid) — 현재 대기 인원 계산
 *   2. state_hash = "count-P:x·H:y·S:z" 형태로 정규화
 *   3. store_choice_state 조회 · last_state_hash 비교
 *   4. 동일 → skip (spam 방지)
 *   5. 다름 · last_broadcast_message_id 있음 → UPDATE (edit)
 *   6. 다름 · 없음 → 신규 INSERT (chat_messages)
 *
 * DB 실패 (42P01 등) 시 silent · 실제 세션 로직 안 막음.
 */
import { getServiceClient } from "@/lib/supabase/serviceClient"

type ChoiceState = {
  count: number
  by_category: { P: number; H: number; S: number }
}

/** 매장별 대기 아가씨 상태 계산 (attendance=available && no active session) */
async function computeStoreChoiceState(
  sb: ReturnType<typeof getServiceClient>,
  storeUuid: string,
): Promise<ChoiceState> {
  // 매장 hostess 멤버십 리스트
  const { data: mems } = await sb
    .from("store_memberships")
    .select("id")
    .eq("store_uuid", storeUuid)
    .eq("role", "hostess")
    .eq("status", "approved")
    .is("deleted_at", null)
  const membershipIds = ((mems ?? []) as Array<{ id: string }>).map((m) => m.id)
  if (membershipIds.length === 0) return { count: 0, by_category: { P: 0, H: 0, S: 0 } }

  // 지금 활성 세션 참여 중인 hostess → 대기 아님
  const { data: activeParts } = await sb
    .from("session_participants")
    .select("membership_id")
    .in("membership_id", membershipIds)
    .eq("status", "active")
    .is("deleted_at", null)
  const busyIds = new Set(
    ((activeParts ?? []) as Array<{ membership_id: string | null }>)
      .map((p) => p.membership_id)
      .filter((x): x is string => !!x),
  )

  // Attendance 상태 (available = 대기 · off_duty = 결근)
  const { data: att } = await sb
    .from("staff_attendance")
    .select("membership_id, status")
    .in("membership_id", membershipIds)
    .eq("store_uuid", storeUuid)
  const attRows = (att ?? []) as Array<{ membership_id: string; status: string }>

  // 대기 = attendance=available OR in_room · 활성 세션 X
  const waiting = attRows.filter(
    (a) => (a.status === "available" || a.status === "in_room") && !busyIds.has(a.membership_id),
  )

  // by_category: hostess.category (지금은 데이터 부족 · 균등 분포로 가정 · 개선은 hostess.category 채워야)
  //   실 데이터: hostesses 테이블 category 필드 조회
  const waitingIds = waiting.map((w) => w.membership_id)
  let byCategory = { P: 0, H: 0, S: 0 }
  if (waitingIds.length > 0) {
    const { data: hostRows } = await sb
      .from("hostesses")
      .select("membership_id, category")
      .in("membership_id", waitingIds)
    const catByMem = new Map(
      ((hostRows ?? []) as Array<{ membership_id: string; category: string | null }>).map((h) => [h.membership_id, h.category]),
    )
    for (const w of waiting) {
      const cat = catByMem.get(w.membership_id)
      if (cat === "퍼블릭") byCategory.P++
      else if (cat === "하퍼") byCategory.H++
      else if (cat === "셔츠") byCategory.S++
      // 미지정은 count 만 반영 · 종목별 breakdown 은 skip
    }
  }

  return { count: waiting.length, by_category: byCategory }
}

function stateHash(s: ChoiceState): string {
  return `${s.count}-P${s.by_category.P}·H${s.by_category.H}·S${s.by_category.S}`
}

function renderChoiceContent(state: ChoiceState, storeName: string): string {
  const t = new Date()
  const hh = String(t.getHours()).padStart(2, "0")
  const mm = String(t.getMinutes()).padStart(2, "0")
  const parts = [`🔥 ${storeName} 초이스`]
  const cats: string[] = []
  if (state.by_category.P > 0) cats.push(`P ${state.by_category.P}`)
  if (state.by_category.H > 0) cats.push(`H ${state.by_category.H}`)
  if (state.by_category.S > 0) cats.push(`S ${state.by_category.S}`)
  if (cats.length > 0) parts.push(cats.join(" · "))
  parts.push(`${state.count}명 대기`)
  parts.push(`(${hh}:${mm})`)
  return parts.join(" · ")
}

/**
 * 매장 초이스 상태 갱신 (변경 시만 edit or 신규 발행).
 * best-effort · 실패 시 silent (호출자 로직 안 막음).
 */
export async function refreshStoreChoiceState(storeUuid: string): Promise<{
  changed: boolean
  reason?: string
  new_hash?: string
}> {
  try {
    const sb = getServiceClient()

    // 1) 현재 상태 계산
    const current = await computeStoreChoiceState(sb, storeUuid)
    const newHash = stateHash(current)

    // 2) 기존 상태 조회
    const { data: existing, error: exErr } = await sb
      .from("store_choice_state")
      .select("last_state_hash, last_broadcast_message_id")
      .eq("store_uuid", storeUuid)
      .maybeSingle()
    if (exErr) {
      // migration 174 미apply → silent skip
      if ((exErr as { code?: string }).code === "42P01") return { changed: false, reason: "migration_pending" }
    }
    const prevHash = (existing as { last_state_hash?: string } | null)?.last_state_hash ?? null
    const prevMsgId = (existing as { last_broadcast_message_id?: string } | null)?.last_broadcast_message_id ?? null

    // 3) 상태 동일 → skip
    if (prevHash === newHash) {
      return { changed: false, reason: "same_hash", new_hash: newHash }
    }

    // 4) 매장 정보 lookup
    const { data: storeRow } = await sb
      .from("stores")
      .select("store_name")
      .eq("id", storeUuid)
      .maybeSingle()
    const storeName = (storeRow as { store_name?: string } | null)?.store_name ?? "매장"

    // 5) 매장 전체톡 lookup (초이스톡 발행 채널)
    const { data: chatRoom } = await sb
      .from("chat_rooms")
      .select("id")
      .eq("type", "global")
      .eq("store_uuid", storeUuid)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle()
    const chatRoomId = (chatRoom as { id?: string } | null)?.id
    if (!chatRoomId) {
      // 매장 전체톡 없음 → state 는 update 하되 broadcast X
      await sb
        .from("store_choice_state")
        .upsert({
          store_uuid: storeUuid,
          available_count: current.count,
          by_category: current.by_category,
          last_state_hash: newHash,
          updated_at: new Date().toISOString(),
        })
      return { changed: true, reason: "no_chat_room", new_hash: newHash }
    }

    const nowIso = new Date().toISOString()
    const content = renderChoiceContent(current, storeName)

    // 6) 발행자 = 시스템 · sender_membership_id 는 매장 owner/manager 중 하나
    //   (chat_messages 는 NOT NULL 이므로) · 매장 첫 owner membership 사용.
    const { data: ownerMem } = await sb
      .from("store_memberships")
      .select("id")
      .eq("store_uuid", storeUuid)
      .in("role", ["owner", "manager"])
      .eq("status", "approved")
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()
    const systemSenderId = (ownerMem as { id?: string } | null)?.id
    if (!systemSenderId) {
      return { changed: false, reason: "no_system_sender" }
    }

    // 7) 기존 macro_choice message 있으면 UPDATE (edit) · 없으면 INSERT
    let newMessageId: string | null = null
    if (prevMsgId) {
      // 기존 message 확인 (deleted_at, superseded_at)
      const { data: prev } = await sb
        .from("chat_messages")
        .select("id, deleted_at, superseded_at")
        .eq("id", prevMsgId)
        .maybeSingle()
      const p = prev as { deleted_at?: string | null; superseded_at?: string | null } | null
      if (p && !p.deleted_at && !p.superseded_at) {
        // edit
        const { data: upd } = await sb
          .from("chat_messages")
          .update({
            content,
            macro_context: {
              state: current,
              hash: newHash,
              edited_at: nowIso,
            },
            // updated_at auto (or explicit)
          })
          .eq("id", prevMsgId)
          .select("id")
          .maybeSingle()
        if (upd) newMessageId = (upd as { id: string }).id
      }
    }
    if (!newMessageId) {
      // 신규 INSERT
      const { data: ins } = await sb
        .from("chat_messages")
        .insert({
          chat_room_id: chatRoomId,
          store_uuid: storeUuid,
          sender_membership_id: systemSenderId,
          content,
          message_type: "macro_choice",
          macro_context: { state: current, hash: newHash, created_at: nowIso },
          created_at: nowIso,
        })
        .select("id")
        .single()
      newMessageId = (ins as { id?: string } | null)?.id ?? null
    }

    // 8) state upsert
    await sb
      .from("store_choice_state")
      .upsert({
        store_uuid: storeUuid,
        available_count: current.count,
        by_category: current.by_category,
        last_state_hash: newHash,
        last_broadcast_message_id: newMessageId,
        last_broadcast_at: nowIso,
        updated_at: nowIso,
      })

    // 9) chat_rooms last_message 갱신
    if (newMessageId) {
      await sb
        .from("chat_rooms")
        .update({ last_message_text: content, last_message_at: nowIso, updated_at: nowIso })
        .eq("id", chatRoomId)
        .then(() => { /* best-effort */ })
    }

    return { changed: true, new_hash: newHash }
  } catch (e) {
    // best-effort · silent
    return { changed: false, reason: e instanceof Error ? e.message : "unknown" }
  }
}
