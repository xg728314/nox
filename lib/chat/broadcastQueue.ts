/**
 * Sprint 2 (2026-07-29): 매크로 발행 대기열 + rate limit + 배치.
 *
 * 목적:
 *   - 여러 세션 동시 등록 시 카톡 채팅 도배 방지
 *   - 매장당 1분에 최대 5건 정상 발행 · 초과 시 배치 요약으로 묶음
 *   - 5분 유예 매크로: undo 가능
 *
 * 흐름:
 *   1. 매크로 발행 요청 → enqueue (scheduled_at = 지금+30초)
 *   2. Cron worker (10초 주기) → queue 조회 · scheduled_at ≤ now
 *   3. 매장별 최근 60초 발행 카운트 체크:
 *      - < 5건 → 개별 발행 (chat_messages INSERT)
 *      - ≥ 5건 → 최근 3분치 pending 을 배치로 묶어 1개 발행
 *   4. sent_at 스탬프 · batched_into_message_id 참조
 *
 * DB 실패 (42P01 등) 시 silent · 세션 로직 안 막음.
 */
import { getServiceClient } from "@/lib/supabase/serviceClient"

const DEFAULT_DELAY_SECONDS = 30
const RATE_LIMIT_WINDOW_SECONDS = 60
const RATE_LIMIT_MAX = 5
const BATCH_WINDOW_MINUTES = 3

type EnqueueInput = {
  chat_room_id: string
  store_uuid: string
  message_type: string
  content: string
  macro_context?: Record<string, unknown> | null
  priority?: 1 | 2 | 3
  delay_seconds?: number
  sender_membership_id: string
  /** 매크로가 참조하는 session (undo 시 참여자 정리용) */
  session_id?: string | null
}

/**
 * 매크로 발행을 큐에 추가 (즉시 X · 5초~30초 지연 후 worker 가 발행).
 */
export async function enqueueBroadcast(input: EnqueueInput): Promise<{
  queued: boolean
  queue_id?: string
  reason?: string
}> {
  try {
    const sb = getServiceClient()
    const delaySec = input.delay_seconds ?? DEFAULT_DELAY_SECONDS
    const scheduledAt = new Date(Date.now() + delaySec * 1000).toISOString()

    const { data, error } = await sb
      .from("broadcast_queue")
      .insert({
        chat_room_id: input.chat_room_id,
        store_uuid: input.store_uuid,
        message_type: input.message_type,
        macro_context: {
          ...(input.macro_context ?? {}),
          sender_membership_id: input.sender_membership_id,
          session_id: input.session_id ?? null,
        },
        content: input.content,
        priority: input.priority ?? 2,
        scheduled_at: scheduledAt,
      })
      .select("id")
      .single()
    if (error) {
      if ((error as { code?: string }).code === "42P01") {
        return { queued: false, reason: "migration_pending" }
      }
      return { queued: false, reason: error.message }
    }
    return { queued: true, queue_id: (data as { id: string }).id }
  } catch (e) {
    return { queued: false, reason: e instanceof Error ? e.message : "unknown" }
  }
}

/**
 * Worker: pending queue drain (rate limit + 배치).
 * Cron 이 호출 (10초 주기 · CRON_SECRET 검증은 route 에서).
 */
export async function drainBroadcastQueue(): Promise<{
  processed: number
  batched: number
  errors: string[]
}> {
  const sb = getServiceClient()
  const nowIso = new Date().toISOString()
  const errors: string[] = []
  let processed = 0
  let batched = 0

  // 1) 발행 대기 (scheduled_at 지남 · 미발송)
  const { data: pending, error } = await sb
    .from("broadcast_queue")
    .select("id, chat_room_id, store_uuid, message_type, content, macro_context, priority, scheduled_at")
    .lte("scheduled_at", nowIso)
    .is("sent_at", null)
    .order("scheduled_at", { ascending: true })
    .limit(200)
  if (error) {
    if ((error as { code?: string }).code === "42P01") {
      return { processed: 0, batched: 0, errors: ["migration_pending"] }
    }
    return { processed: 0, batched: 0, errors: [error.message] }
  }
  const items = (pending ?? []) as Array<{
    id: string
    chat_room_id: string
    store_uuid: string
    message_type: string
    content: string
    macro_context: Record<string, unknown> | null
    priority: number
    scheduled_at: string
  }>
  if (items.length === 0) return { processed: 0, batched: 0, errors: [] }

  // 2) 매장별 그룹 · rate limit 체크
  const byStore = new Map<string, typeof items>()
  for (const it of items) {
    const arr = byStore.get(it.store_uuid) ?? []
    arr.push(it)
    byStore.set(it.store_uuid, arr)
  }

  for (const [storeUuid, storeItems] of byStore.entries()) {
    // 최근 60초 발행 카운트 (rate limit check)
    const rateWindowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_SECONDS * 1000).toISOString()
    const { count: recentCount } = await sb
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("store_uuid", storeUuid)
      .in("message_type", ["macro_maid", "macro_end", "macro_extend", "macro_nfc"])
      .gte("created_at", rateWindowStart)

    const overLimit = (recentCount ?? 0) + storeItems.length > RATE_LIMIT_MAX

    if (overLimit && storeItems.length > 1) {
      // 배치 모드: 매장 내 pending 을 하나의 요약 message 로
      const batchContent = renderBatchSummary(storeItems)
      const firstItem = storeItems[0]
      // sender = 첫 아이템 sender_membership_id
      const senderId = getSenderMembershipId(firstItem.macro_context, storeUuid, sb)
      const senderIdResolved = await senderId
      if (!senderIdResolved) {
        errors.push(`no_sender_${storeUuid}`)
        continue
      }
      const { data: msg, error: msgErr } = await sb
        .from("chat_messages")
        .insert({
          chat_room_id: firstItem.chat_room_id, // 모두 같은 매장 · 같은 채팅방 가정
          store_uuid: storeUuid,
          sender_membership_id: senderIdResolved,
          content: batchContent,
          message_type: "system",
          macro_context: {
            batch: true,
            item_count: storeItems.length,
            item_ids: storeItems.map((i) => i.id),
            item_previews: storeItems.slice(0, 10).map((i) => i.content),
          },
          created_at: nowIso,
        })
        .select("id")
        .maybeSingle()
      if (msgErr || !msg) {
        errors.push(`batch_insert_fail_${storeUuid}: ${msgErr?.message ?? "unknown"}`)
        continue
      }
      const msgId = (msg as { id: string }).id
      // 큐 아이템 sent_at 스탬프 + batched_into 참조
      await sb
        .from("broadcast_queue")
        .update({ sent_at: nowIso, batched_into_message_id: msgId })
        .in("id", storeItems.map((i) => i.id))
      batched += storeItems.length
    } else {
      // 개별 발행
      for (const it of storeItems) {
        const senderIdResolved = await getSenderMembershipId(it.macro_context, storeUuid, sb)
        if (!senderIdResolved) {
          errors.push(`no_sender_item_${it.id}`)
          continue
        }
        const undoDeadline = new Date(Date.now() + 5 * 60_000).toISOString()
        const sessionId = ((it.macro_context ?? {}) as { session_id?: string | null }).session_id ?? null
        const { data: msg, error: msgErr } = await sb
          .from("chat_messages")
          .insert({
            chat_room_id: it.chat_room_id,
            store_uuid: it.store_uuid,
            sender_membership_id: senderIdResolved,
            content: it.content,
            message_type: it.message_type,
            macro_context: it.macro_context,
            session_id: sessionId,
            undo_deadline_at: undoDeadline,
            created_at: nowIso,
          })
          .select("id")
          .maybeSingle()
        if (msgErr || !msg) {
          errors.push(`insert_fail_${it.id}: ${msgErr?.message ?? "unknown"}`)
          continue
        }
        await sb
          .from("broadcast_queue")
          .update({ sent_at: nowIso, batched_into_message_id: (msg as { id: string }).id })
          .eq("id", it.id)
        processed++
      }
    }
  }

  return { processed, batched, errors }
}

function renderBatchSummary(items: Array<{ content: string }>): string {
  const previews = items.slice(0, 5).map((i) => `• ${i.content}`).join("\n")
  const more = items.length > 5 ? `\n외 ${items.length - 5}건` : ""
  const t = new Date()
  const hh = String(t.getHours()).padStart(2, "0")
  const mm = String(t.getMinutes()).padStart(2, "0")
  return `📥 최근 매크로 ${items.length}건 (${hh}:${mm})\n${previews}${more}`
}

async function getSenderMembershipId(
  macroContext: Record<string, unknown> | null,
  storeUuid: string,
  sb: ReturnType<typeof getServiceClient>,
): Promise<string | null> {
  const ctx = (macroContext ?? {}) as { sender_membership_id?: string }
  if (ctx.sender_membership_id) return ctx.sender_membership_id
  // fallback: 매장 owner/manager 첫 명
  const { data } = await sb
    .from("store_memberships")
    .select("id")
    .eq("store_uuid", storeUuid)
    .in("role", ["owner", "manager"])
    .eq("status", "approved")
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as { id?: string } | null)?.id ?? null
}
