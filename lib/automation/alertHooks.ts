import { sendTelegram, type TelegramSendResult } from "./channels/telegram"

/**
 * ROUND-ALERT-1 — automation alert emitter with in-memory dedup.
 *
 * 1차 구현: Telegram 단일 채널. 중복 방지는 in-memory Map (TTL).
 * Vercel serverless 인스턴스가 warm 상태로 재사용되는 동안에만 dedup 유효.
 * cold-start 시 초기화 → 드물게 재발송 가능성 존재 (수용 가능한 trade-off
 * vs DB write 최소화 원칙). 향후 DB-기반 dedup 으로 업그레이드 가능.
 *
 * Cooldown per alert_type (default 20m):
 *   duplicate_open       15m
 *   tag_mismatch         30m
 *   no_business_day      60m
 *   그 외                   20m
 */

export type AlertType =
  | "duplicate_open"
  | "tag_mismatch"
  | "no_business_day"
  | "recent_checkout_block"
  | string

export type AlertInput = {
  type: AlertType
  /** 매장 scope — dedup key + 메시지 prefix 에 사용. */
  store_uuid: string
  /** 매장 이름 (선택, 메시지 표시용). */
  store_name?: string | null
  /** 이상 주체 식별자 모음 (예: membership_id 배열 / 또는 빈 배열). 같은
   *  집합이면 같은 dedup 키 → 재발송 skip. */
  entity_ids?: string[]
  /** 메시지 본문에 포함할 사람-친화 설명. */
  message: string
  /** 디버깅용 부가 정보 (메시지 꼬리에 inline 로 표시). */
  detail?: Record<string, unknown>
}

export type EmitResult =
  | { ok: true; deduped: false; channel_result: TelegramSendResult }
  | { ok: true; deduped: true; reason: "recent_same_alert" }
  | { ok: false; reason: "channel_failed"; channel_result: TelegramSendResult }

const DEFAULT_COOLDOWN_MS = 20 * 60 * 1000
const COOLDOWN_BY_TYPE: Record<string, number> = {
  duplicate_open: 15 * 60 * 1000,
  tag_mismatch: 30 * 60 * 1000,
  no_business_day: 60 * 60 * 1000,
  recent_checkout_block: 30 * 60 * 1000,
}

// module-level in-memory dedup store. TTL 은 위 cooldown 표 기준.
// 같은 serverless instance 의 warm 재호출에만 유효. 의도적으로 최소 구현.
const dedupMap: Map<string, number> = new Map()
const DEDUP_MAX_ENTRIES = 5_000 // 메모리 상한 — 매우 넉넉

function dedupKey(input: AlertInput): string {
  const ids = (input.entity_ids ?? []).slice().sort().join(",")
  return `${input.type}|${input.store_uuid}|${ids}`
}

function cooldownMs(type: string): number {
  return COOLDOWN_BY_TYPE[type] ?? DEFAULT_COOLDOWN_MS
}

function cleanupExpired(now: number): void {
  if (dedupMap.size < DEDUP_MAX_ENTRIES) return
  const cutoff = now - 3 * 60 * 60 * 1000 // 3시간 지난 엔트리 정리
  for (const [k, t] of dedupMap) {
    if (t < cutoff) dedupMap.delete(k)
  }
}

function formatMessage(input: AlertInput): string {
  const header = `🚨 <b>NOX 알림</b> · ${escapeHtml(input.type)}`
  const storeLine = input.store_name
    ? `매장: <b>${escapeHtml(input.store_name)}</b>`
    : `store_uuid: <code>${escapeHtml(input.store_uuid.slice(0, 8))}</code>`
  const body = escapeHtml(input.message)
  const ids = input.entity_ids?.length
    ? `\n대상 ${input.entity_ids.length}건: ${input.entity_ids
        .slice(0, 10)
        .map((i) => `<code>${escapeHtml(i.slice(0, 8))}</code>`)
        .join(", ")}`
    : ""
  const detail = input.detail
    ? `\n<i>${escapeHtml(JSON.stringify(input.detail).slice(0, 500))}</i>`
    : ""
  return `${header}\n${storeLine}\n${body}${ids}${detail}`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

/**
 * Emit an automation alert.
 *
 * - dedup 적용: 같은 (type, store_uuid, entity_ids) 가 cooldown 이내면 skip.
 * - 발송 결과를 구조화해 반환. 실패도 throw 하지 않고 caller 가 로그·집계.
 */
export async function emitAutomationAlert(
  input: AlertInput,
): Promise<EmitResult> {
  const now = Date.now()
  cleanupExpired(now)

  const key = dedupKey(input)
  const last = dedupMap.get(key)
  if (last && now - last < cooldownMs(input.type)) {
    return { ok: true, deduped: true, reason: "recent_same_alert" }
  }

  const channelResult = await sendTelegram(formatMessage(input))

  if (!channelResult.ok) {
    // 실패 시 dedup 갱신하지 않음 — 다음 cron 실행에서 재시도 가능.
    return { ok: false, reason: "channel_failed", channel_result: channelResult }
  }

  dedupMap.set(key, now)
  return { ok: true, deduped: false, channel_result: channelResult }
}

/** 테스트/관측용 export (production 사용처 없음). */
export function __resetAlertDedup(): void {
  dedupMap.clear()
}
