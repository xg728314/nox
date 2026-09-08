/**
 * lib/chat/bot/autoTrigger.ts
 *
 * R37 (2026-09-09): 채팅 메시지 발송 후 파싱 결과 → 봇 답장 자동 트리거.
 *
 * 흐름:
 *   1. sendMessage 후 호출
 *   2. parseChatWithConfidence + parseWaitingMessage 실행
 *   3. tier + strictness + suppression 판정
 *   4. Pattern A/B/C 답장 payload 생성
 *   5. sendMessage (message_type='bot_reply') · body 에 payload json
 *   6. chat_bot_reply_log 기록
 *
 * tier → Pattern 매핑:
 *   auto (95+)    → 조용히 자동 등록 (봇 답장 없음)
 *   quiet (70-94) → Pattern A · understand_confirm (3초 auto)
 *   pending (40-69) → Pattern B · partial_missing (선택 대기)
 *   fail (<40) + 대기요청 감지 → Pattern A (waiting_request 확인)
 *   fail + 감지 실패 → Pattern C · template_suggest (예시)
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { parseChatWithConfidence, type ResolveResult, type ResolvedEntry } from "@/lib/session/parseChatWithConfidence"
import { parseWaitingMessage } from "@/lib/chat/bot/parseWaitingRequest"
import type { BotStrictness } from "@/lib/chat/bot/strictness"
import { autoRegisterThreshold, botCanReply } from "@/lib/chat/bot/strictness"
import { shouldSuppressBotReply, logBotReply } from "@/lib/chat/bot/suppression"
import {
  composeUnderstandConfirm,
  composePartialMissing,
  composeTemplateSuggest,
  type BotReplyPayload,
} from "@/lib/chat/bot/composer"

export type AutoTriggerContext = {
  supabase: SupabaseClient
  chatRoomId: string
  parentMessageId: string
  senderMembershipId: string
  senderProfileId: string
  senderStoreUuid: string
  strictness: BotStrictness
}

export type AutoTriggerResult = {
  bot_replied: boolean
  reply_pattern?: string
  suppressed?: boolean
  suppress_reason?: string
  parse_tier?: string
  waiting_detected?: boolean
}

export async function autoTriggerBotReply(
  text: string,
  ctx: AutoTriggerContext,
): Promise<AutoTriggerResult> {
  // 0. strictness=silent → 완전 침묵
  if (!botCanReply(ctx.strictness)) {
    return { bot_replied: false, suppressed: true, suppress_reason: "strictness_silent" }
  }

  // 1. 대기 요청 먼저 감지 (아가씨 이름 없이 오는 메시지)
  const waiting = parseWaitingMessage(text)
  if (waiting) {
    if (waiting.kind === "waiting_cancel") {
      // 대기 취소 — Pattern A 로 확인 요청
      const payload = composeUnderstandConfirm({
        eventType: "waiting",
        hostessNames: [],
        extraNotes: ["대기 취소 (초이스 스톱)"],
        compressed: false,
      })
      payload.title = "대기 취소로 이해했어요. 리스트에서 뺄까요?"
      return await sendBotReplyIfAllowed(payload, "waiting_cancel", "understand_confirm", ctx)
    }
    // waiting_request
    const payload = composeUnderstandConfirm({
      eventType: waiting.is_choice ? "choice" : "waiting",
      hostessNames: [],
      category: waiting.category,
      extraNotes: [
        `${waiting.party_size}인 × ${waiting.room_count}방`,
        waiting.is_new_room ? "새방" : "체인지",
        waiting.seen_policy === "unseen_only" ? "안본인원" : "본인원",
        ...(waiting.tags.length > 0 ? [waiting.tags.join(" · ")] : []),
      ],
    })
    return await sendBotReplyIfAllowed(payload, "waiting_request", "understand_confirm", ctx)
  }

  // 2. 정규 파싱 (hostess/store/category/ticket)
  let parseResult: ResolveResult
  try {
    parseResult = await parseChatWithConfidence(text, {
      supabase: ctx.supabase,
      actor_membership_id: ctx.senderMembershipId,
      actor_store_uuid: ctx.senderStoreUuid,
    })
  } catch {
    return { bot_replied: false, parse_tier: "error" }
  }

  const threshold = autoRegisterThreshold(ctx.strictness) * 100
  const overall = parseResult.overall_confidence

  // 3. tier 별 분기
  if (parseResult.entries.length === 0) {
    // 파서가 아무것도 못 잡음 → template_suggest (Pattern C)
    // 단, 텍스트가 너무 짧거나 이모지만 있으면 아예 발송 skip
    const cleanText = text.replace(/[\s\p{P}\p{S}]/gu, "")
    if (cleanText.length < 3) {
      return { bot_replied: false, parse_tier: "fail", suppressed: true, suppress_reason: "too_short" }
    }
    const payload = composeTemplateSuggest({
      reason: "메시지를 이해하지 못했어요.",
      templateLines: [
        "이 형식으로 써주세요:",
        "  [매장] [아가씨] [종목] [완메·반메·끝·연장·스타트]",
        "",
        "예시:",
        `  「마블 지연 셔츠 완메」`,
        `  「마블 유나 하퍼 스타트」`,
      ],
      refillTemplate: "[매장] [아가씨] [종목] [이벤트]",
    })
    return await sendBotReplyIfAllowed(payload, "unparsed", "template_suggest", ctx)
  }

  if (overall >= threshold) {
    // AUTO — 조용히 자동 등록 (호출측에서 처리) · 봇 답장 없음
    // 로그만 남김
    await logBotReply({
      chatRoomId: ctx.chatRoomId,
      parentMessageId: ctx.parentMessageId,
      targetMembershipId: ctx.senderMembershipId,
      targetProfileId: ctx.senderProfileId,
      replyPattern: "silence",
      errorSignature: null,
      suppressed: true,
      suppressReason: "auto_register_high_conf",
    })
    return { bot_replied: false, parse_tier: parseResult.tier, suppressed: true, suppress_reason: "auto_register_high_conf" }
  }

  // MEDIUM confidence → Pattern A · understand_confirm (3초 auto)
  if (overall >= 40) {
    const first = parseResult.entries[0]
    const eventType: "checkin" | "checkout" | "extend" =
      first.raw.event === "CHECKOUT" ? "checkout" :
      first.raw.event === "START" ? "checkin" :
      "checkin"
    const payload = composeUnderstandConfirm({
      eventType,
      storeName: first.origin_store_name_confirmed ?? undefined,
      hostessNames: parseResult.entries.map(e => e.hostess_name_confirmed),
      category: first.category ?? undefined,
      timeType: first.ticket_type ?? undefined,
      roomLabel: first.room_no ? `${first.room_no}번방` : undefined,
    })
    // pending tier 는 자동 등록 없음 (사용자 확인 필요)
    payload.auto_register_after_sec = parseResult.tier === "quiet" ? 3 : undefined
    return await sendBotReplyIfAllowed(payload, errorSignatureFor(parseResult), "understand_confirm", ctx)
  }

  // LOW/FAIL — 이름은 있지만 매장/종목 등이 애매 → Pattern B (partial_missing)
  const missing = firstMissingHostess(parseResult.entries)
  if (missing) {
    const payload = composePartialMissing({
      missingName: missing.hostess_name_confirmed,
      hint: "💡 매장 접두를 붙이면 자동 매칭돼요",
      hintExample: `예: 「${ctx.senderStoreUuid.slice(0, 4)} ${missing.hostess_name_confirmed} 완메」`,
    })
    return await sendBotReplyIfAllowed(payload, "hostess_not_found", "partial_missing", ctx)
  }

  // fallback → Pattern C
  const payload = composeTemplateSuggest({
    reason: "일부 항목이 애매해요.",
    templateLines: [
      "이 형식으로 다시 써주세요:",
      "  [매장] [아가씨] [종목] [이벤트]",
    ],
  })
  return await sendBotReplyIfAllowed(payload, "low_confidence", "template_suggest", ctx)
}

// ── helpers ────────────────────────────────────────────────────────

function firstMissingHostess(entries: ResolvedEntry[]): ResolvedEntry | null {
  return entries.find(e => e.needs_provisioning) ?? null
}

function errorSignatureFor(res: ResolveResult): string {
  // 대표 이슈 하나 · 억제 카운팅 key
  for (const e of res.entries) {
    if (e.issues.length > 0) return e.issues[0].replace(/[^\p{L}\p{N}]/gu, "_").slice(0, 40)
  }
  return "low_confidence"
}

async function sendBotReplyIfAllowed(
  payload: BotReplyPayload,
  errorSignature: string,
  patternKey: "understand_confirm" | "partial_missing" | "template_suggest" | "silence",
  ctx: AutoTriggerContext,
): Promise<AutoTriggerResult> {
  const decision = await shouldSuppressBotReply({
    strictness: ctx.strictness,
    errorSignature,
    targetMembershipId: ctx.senderMembershipId,
    chatRoomId: ctx.chatRoomId,
  })
  if (decision.suppressed) {
    await logBotReply({
      chatRoomId: ctx.chatRoomId,
      parentMessageId: ctx.parentMessageId,
      targetMembershipId: ctx.senderMembershipId,
      targetProfileId: ctx.senderProfileId,
      replyPattern: patternKey,
      errorSignature,
      suppressed: true,
      suppressReason: decision.reason,
    })
    return { bot_replied: false, suppressed: true, suppress_reason: decision.reason, reply_pattern: patternKey }
  }

  // 압축 모드 (피크시간)
  if (decision.compressed) payload.compressed = true

  // 봇 답장 chat_messages 에 발송 · message_type='bot_reply' · body 는 JSON payload.
  // R37-fix (2026-09-09): 실 chat_messages 스키마는
  //   { id, chat_room_id, store_uuid, sender_membership_id, content, message_type, created_at, deleted_at }
  //   sender_name/macro_context 컬럼 없음 · store_uuid 필요.
  //   store_uuid 는 room 에서 조회.
  const { data: room } = await ctx.supabase.from("chat_rooms")
    .select("store_uuid").eq("id", ctx.chatRoomId).maybeSingle()
  const storeUuid = (room as { store_uuid?: string } | null)?.store_uuid ?? ctx.senderStoreUuid

  const payloadJson = JSON.stringify({ ...payload, _parent: ctx.parentMessageId, _pattern: patternKey })
  const { error } = await ctx.supabase.from("chat_messages").insert({
    chat_room_id: ctx.chatRoomId,
    store_uuid: storeUuid,
    sender_membership_id: null,          // 봇 · null (컬럼 nullable 이어야)
    content: payloadJson,
    message_type: "bot_reply",
  })
  if (error) {
    // send 실패해도 log 는 남김
    await logBotReply({
      chatRoomId: ctx.chatRoomId,
      parentMessageId: ctx.parentMessageId,
      targetMembershipId: ctx.senderMembershipId,
      targetProfileId: ctx.senderProfileId,
      replyPattern: patternKey,
      errorSignature,
      suppressed: true,
      suppressReason: `send_error:${error.message}`,
    })
    return { bot_replied: false, suppressed: true, suppress_reason: "send_error", reply_pattern: patternKey }
  }

  await logBotReply({
    chatRoomId: ctx.chatRoomId,
    parentMessageId: ctx.parentMessageId,
    targetMembershipId: ctx.senderMembershipId,
    targetProfileId: ctx.senderProfileId,
    replyPattern: patternKey,
    errorSignature,
    suppressed: false,
  })
  return { bot_replied: true, reply_pattern: patternKey }
}
