"use client"

/**
 * ApplyStatusBadge — single, shared visual representation of
 * `session_participant_action_applies.apply_status` for the LATEST
 * action on a participant. Rendered everywhere an operator needs to
 * distinguish "recorded only" vs "actually reflected".
 *
 * States:
 *   - pending        → 적용중            (neutral amber)
 *   - pending stale  → 적용 지연         (stronger amber, same text color
 *                                         but with an alert glyph)
 *   - success        → 반영됨            (emerald)
 *   - failed         → 반영 실패         (red)
 *   - null           → (no badge — no apply row means no backend truth
 *                      to surface; callers should render nothing)
 *
 * The component is intentionally stateless: all signals come from
 * server truth (MonitorRoomParticipant fields). It does NOT compute
 * pending from latest/applied cursor mismatch — that's the legacy
 * "미적용" heuristic and is superseded by the explicit apply row.
 */

import type { MonitorRoomParticipant } from "../../types"

// 5 minutes — mirrors the server-side STALE_PENDING_MS threshold used
// by /api/session-participant-actions/[action_id]/retry. If a pending
// row's last_attempted_at is older than this, retry is eligible AND
// the operator should see a stronger warning.
const STALE_PENDING_MS = 5 * 60 * 1000

export type ApplyStatusBadgeData = Pick<
  MonitorRoomParticipant,
  | "latest_apply_status"
  | "latest_apply_attempt_count"
  | "latest_apply_last_attempted_at"
  | "latest_apply_failure_code"
  | "latest_apply_failure_message"
>

type Props = {
  data: ApplyStatusBadgeData
  /** When true, the failure_message (if any) renders inline under the
   *  badge instead of only in the hover tooltip. Used inside the
   *  ActionPopover where horizontal space is ample. */
  showFailureDetail?: boolean
  /** Compact variant — no failure detail, smaller padding. Default. */
  size?: "sm" | "md"
}

export function isApplyStale(data: ApplyStatusBadgeData, nowMs: number = Date.now()): boolean {
  if (data.latest_apply_status !== "pending") return false
  const lastIso = data.latest_apply_last_attempted_at
  if (!lastIso) return true
  const lastMs = Date.parse(lastIso)
  if (!Number.isFinite(lastMs)) return true
  return (nowMs - lastMs) > STALE_PENDING_MS
}

export default function ApplyStatusBadge({ data, showFailureDetail = false, size = "sm" }: Props) {
  const status = data.latest_apply_status
  if (!status) return null

  const stale = isApplyStale(data)
  const attemptSuffix =
    (data.latest_apply_attempt_count ?? 0) > 1 ? ` · ${data.latest_apply_attempt_count}회 시도` : ""
  const padding = size === "md" ? "px-2 py-1 text-[11px]" : "px-1.5 py-0.5 text-[10px]"

  if (status === "success") {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md border border-emerald-500/45 bg-emerald-500/15 text-emerald-200 font-semibold ${padding}`}
        title="이 변경사항은 참여자 상태에 실제로 반영되었습니다."
      >
        <span aria-hidden>✓</span>
        <span>반영됨{attemptSuffix}</span>
      </span>
    )
  }

  if (status === "failed") {
    const msg = data.latest_apply_failure_message ?? data.latest_apply_failure_code ?? "알 수 없는 오류"
    return (
      <span className="inline-flex flex-col gap-0.5">
        <span
          className={`inline-flex items-center gap-1 rounded-md border border-red-500/50 bg-red-500/20 text-red-200 font-semibold ${padding}`}
          title={`반영 실패 — ${msg}`}
        >
          <span aria-hidden>⚠</span>
          <span>반영 실패{attemptSuffix}</span>
        </span>
        {showFailureDetail && (
          <span className="text-[10px] text-red-300/90 leading-snug max-w-[240px]">
            {humanizeFailure(data.latest_apply_failure_code, data.latest_apply_failure_message)}
          </span>
        )}
      </span>
    )
  }

  // pending — split by stale flag
  if (stale) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md border border-amber-500/60 bg-amber-500/25 text-amber-100 font-semibold ${padding}`}
        title="적용이 지연되고 있습니다. [재시도] 를 눌러 서버에 재적용을 요청하세요."
      >
        <span aria-hidden>⏳</span>
        <span>적용 지연{attemptSuffix}</span>
      </span>
    )
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border border-amber-500/45 bg-amber-500/15 text-amber-200 font-semibold ${padding}`}
      title="서버에서 아직 적용 처리 중입니다."
    >
      <span aria-hidden>…</span>
      <span>적용중{attemptSuffix}</span>
    </span>
  )
}

/**
 * Convert an internal failure code into a short operator-readable line.
 * Never surfaces stack traces or raw DB errors verbatim — only the
 * shape the helper emits. If the code is unknown we fall back to the
 * message as-is (truncated).
 */
function humanizeFailure(code: string | null, message: string | null): string {
  switch (code) {
    case "PARTICIPANT_NOT_FOUND": return "참여자를 찾을 수 없습니다."
    case "SESSION_NOT_FOUND":     return "세션을 찾을 수 없습니다."
    case "SESSION_NOT_ACTIVE":    return "세션이 활성 상태가 아닙니다."
    case "STORE_MISMATCH":        return "다른 매장 소속입니다."
    case "BUSINESS_DAY_CLOSED":   return "영업일이 마감되었습니다."
    case "INVALID_ACTION_TYPE":   return "알 수 없는 액션 유형입니다."
    case "CONFLICT":              return "업데이트 충돌 — 재시도해 주세요."
    case "INTERNAL_ERROR":        return "내부 오류 — 재시도해 주세요."
    default:
      if (message) return message.length > 120 ? message.slice(0, 120) + "…" : message
      return "알 수 없는 오류."
  }
}
