/**
 * lib/chat/bot/suppression.ts
 *
 * R36: 봇 답장 자동 억제 (노이즈 폭발 방지).
 *
 * 4가지 규칙:
 *   ① 같은 사용자 같은 오류 3회 후 침묵 (해당 사람은 학습 대상 제외)
 *   ② 피크 시간대 (21:00~03:00 KST) 압축 모드
 *   ③ strictness='silent' 일 때 완전 침묵
 *   ④ 같은 방에서 30초 내 봇 답장 5회 초과 시 rate limit
 *
 * 반환: { suppressed: boolean, reason?: string, compressed?: boolean }
 */
import { getServiceClient } from "@/lib/supabase/serviceClient"
import type { BotStrictness } from "./strictness"

const PEAK_START_HOUR_KST = 21 // 21:00 KST
const PEAK_END_HOUR_KST = 3    // 03:00 KST (다음날)
const SAME_USER_ERROR_LIMIT = 3
const ROOM_RATE_LIMIT_WINDOW_SEC = 30
const ROOM_RATE_LIMIT_COUNT = 5

export type SuppressDecision = {
  suppressed: boolean
  reason?: string
  compressed?: boolean // 피크시간 → 답장 상세 X · pill 만
}

/** KST 기준 현재 시각이 피크 시간 (21~03시) 인지 */
export function isPeakHourKST(nowUtc = new Date()): boolean {
  const kstHour = (nowUtc.getUTCHours() + 9) % 24
  return kstHour >= PEAK_START_HOUR_KST || kstHour < PEAK_END_HOUR_KST
}

/**
 * shouldSuppressBotReply — 봇 답장 전 호출 · 억제 여부 판정.
 *
 * @param opts.strictness         — 매장 봇 엄격도
 * @param opts.errorSignature     — 오류 서명 (e.g. "missing_store_prefix")
 * @param opts.targetMembershipId — 대상 사용자 (같은 사람 반복 감지)
 * @param opts.chatRoomId         — 방 rate limit 감지
 */
export async function shouldSuppressBotReply(opts: {
  strictness: BotStrictness
  errorSignature: string | null
  targetMembershipId: string | null
  chatRoomId: string
}): Promise<SuppressDecision> {
  // ③ silent 모드
  if (opts.strictness === "silent") {
    return { suppressed: true, reason: "strictness_silent" }
  }

  const sb = getServiceClient()

  // ① 같은 사용자 같은 오류 3회 후 침묵
  if (opts.targetMembershipId && opts.errorSignature) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // 24시간 window
    const { count } = await sb.from("chat_bot_reply_log")
      .select("id", { count: "exact", head: true })
      .eq("target_membership_id", opts.targetMembershipId)
      .eq("error_signature", opts.errorSignature)
      .eq("suppressed", false)
      .gte("created_at", since)
    if ((count ?? 0) >= SAME_USER_ERROR_LIMIT) {
      return { suppressed: true, reason: "user_repeated" }
    }
  }

  // ④ 방 rate limit
  {
    const since = new Date(Date.now() - ROOM_RATE_LIMIT_WINDOW_SEC * 1000).toISOString()
    const { count } = await sb.from("chat_bot_reply_log")
      .select("id", { count: "exact", head: true })
      .eq("chat_room_id", opts.chatRoomId)
      .eq("suppressed", false)
      .gte("created_at", since)
    if ((count ?? 0) >= ROOM_RATE_LIMIT_COUNT) {
      return { suppressed: true, reason: "room_rate_limit" }
    }
  }

  // ② 피크 시간대 → 답장은 하되 압축 모드
  if (isPeakHourKST()) {
    return { suppressed: false, compressed: true }
  }

  return { suppressed: false }
}

/**
 * logBotReply — 봇 답장 (or 억제) 기록. rate limit + audit 겸용.
 */
export async function logBotReply(opts: {
  chatRoomId: string
  parentMessageId?: string | null
  targetMembershipId?: string | null
  targetProfileId?: string | null
  replyPattern: "understand_confirm" | "partial_missing" | "template_suggest" | "silence"
  errorSignature?: string | null
  suppressed?: boolean
  suppressReason?: string | null
}): Promise<void> {
  const sb = getServiceClient()
  await sb.from("chat_bot_reply_log").insert({
    chat_room_id: opts.chatRoomId,
    parent_message_id: opts.parentMessageId ?? null,
    target_membership_id: opts.targetMembershipId ?? null,
    target_profile_id: opts.targetProfileId ?? null,
    reply_pattern: opts.replyPattern,
    error_signature: opts.errorSignature ?? null,
    suppressed: opts.suppressed ?? false,
    suppress_reason: opts.suppressReason ?? null,
  })
}
