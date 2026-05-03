/**
 * Counter Monitor — server-derived recommendation facts.
 *
 * 2026-05-03: app/api/counter/monitor/route.ts 분할의 일부.
 *   raw numbers (자리비움 N분, 경과 N분, 예상 종료 초과 N분, 연장 적용 대기) 만
 *   서버에서 도출하고, 임계 필터링은 client 의 사용자 알림 prefs 에서 처리.
 *
 * NO state mutation / NO business impact.
 *
 * Baseline 기준 (서버는 이 값 이상만 emit, client 는 사용자 prefs 로 더 높은
 * floor 를 적용):
 *   long_mid_out  ≥ 5분
 *   long_session  ≥ 60분
 */

export type RecCode = "long_mid_out" | "long_session" | "overdue" | "extension_reminder"
export type Rec = { code: RecCode; minutes?: number; message: string }

const SERVER_LONG_MID_OUT_FLOOR = 5     // minutes (baseline emit threshold)
const SERVER_LONG_SESSION_FLOOR = 60    // minutes

export function deriveRecommendations(input: {
  status: string
  entered_at: string
  left_at: string | null
  time_minutes: number
  operator_status: "normal" | "still_working" | "ended" | "extended"
  extension_count: number
  latest_action_id: string | null
  last_applied_action_id: string | null
  nowMs: number
}): Rec[] {
  const out: Rec[] = []
  const { status, entered_at, left_at, time_minutes, nowMs } = input

  // long_mid_out — use left_at as the mid-out anchor if available; else
  // entered_at as the safe fallback.
  if (status === "mid_out" || status === "left") {
    const baseIso = left_at || entered_at
    const baseMs = new Date(baseIso).getTime()
    if (Number.isFinite(baseMs)) {
      const mins = Math.max(0, Math.floor((nowMs - baseMs) / 60_000))
      if (mins >= SERVER_LONG_MID_OUT_FLOOR) {
        out.push({ code: "long_mid_out", minutes: mins, message: `자리비움 ${mins}분` })
      }
    }
  }

  // long_session — elapsed since entered_at for active participants.
  if (status === "active") {
    const enteredMs = new Date(entered_at).getTime()
    if (Number.isFinite(enteredMs)) {
      const mins = Math.max(0, Math.floor((nowMs - enteredMs) / 60_000))
      if (mins >= SERVER_LONG_SESSION_FLOOR) {
        out.push({ code: "long_session", minutes: mins, message: `경과 ${mins}분` })
      }
      // overdue — active participant whose booked time_minutes has elapsed.
      if (time_minutes > 0) {
        const overdue = mins - time_minutes
        if (overdue > 0) {
          out.push({ code: "overdue", minutes: overdue, message: `예상 종료 초과 ${overdue}분` })
        }
      }
    }
  }

  // extension_reminder — operator recorded an extension but hasn't
  // applied yet (latest action != last applied cursor). Categorical.
  if (input.operator_status === "extended"
      && input.latest_action_id
      && input.latest_action_id !== input.last_applied_action_id) {
    out.push({ code: "extension_reminder", message: `연장 ${input.extension_count}회 적용 대기` })
  }

  return out
}
