/**
 * ROUND-OPS-3 — 공통 anomaly severity classifier.
 *
 * /api/ops/attendance-overview · /api/cron/ops-alerts-scan · DailyOpsCheckGate
 * 세 곳이 **같은 규칙으로 blocking/warn 을 분류**하도록 여기서만 판정한다.
 *
 * 분류 (스펙):
 *   BLOCKING (운영 차단): duplicate_open, no_business_day
 *   WARN (경고만):         tag_mismatch, recent_checkout_block
 *   OK:                    전부 0
 *
 * 규칙: blocking 유형은 **1건만 있어도** 차단. warn 도 1건만 있어도 경고
 * 문구 표시. 알림 발송(cron) 의 numeric threshold(예: tag_mismatch >= 3)
 * 는 **별도** — 여기서 정의하는 건 severity 뿐이다.
 */

export type AnomalyCounts = {
  duplicate_open: number
  recent_checkout_block: number
  tag_mismatch: number
  no_business_day: number
}

export const BLOCKING_TYPES = [
  "duplicate_open",
  "no_business_day",
] as const
export type BlockingType = (typeof BLOCKING_TYPES)[number]

export const WARN_TYPES = [
  "tag_mismatch",
  "recent_checkout_block",
] as const
export type WarnType = (typeof WARN_TYPES)[number]

export type Severity = "ok" | "warn" | "blocking"

const LABEL: Record<BlockingType | WarnType, string> = {
  duplicate_open: "중복 출근",
  no_business_day: "영업일 미개방",
  tag_mismatch: "Tag 미매칭",
  recent_checkout_block: "재출근 차단",
}

export function hasBlocking(a: AnomalyCounts): boolean {
  return a.duplicate_open > 0 || a.no_business_day > 0
}

export function hasWarning(a: AnomalyCounts): boolean {
  return a.tag_mismatch > 0 || a.recent_checkout_block > 0
}

export function classifySeverity(a: AnomalyCounts): Severity {
  if (hasBlocking(a)) return "blocking"
  if (hasWarning(a)) return "warn"
  return "ok"
}

export function isBlockingAnomaly(type: string, count: number): boolean {
  if (count <= 0) return false
  return (BLOCKING_TYPES as readonly string[]).includes(type)
}

export function isWarningAnomaly(type: string, count: number): boolean {
  if (count <= 0) return false
  return (WARN_TYPES as readonly string[]).includes(type)
}

export type AnomalyDetail = { type: string; count: number; label: string }

export function listBlockingDetails(a: AnomalyCounts): AnomalyDetail[] {
  const out: AnomalyDetail[] = []
  if (a.duplicate_open > 0)
    out.push({ type: "duplicate_open", count: a.duplicate_open, label: LABEL.duplicate_open })
  if (a.no_business_day > 0)
    out.push({ type: "no_business_day", count: a.no_business_day, label: LABEL.no_business_day })
  return out
}

export function listWarningDetails(a: AnomalyCounts): AnomalyDetail[] {
  const out: AnomalyDetail[] = []
  if (a.tag_mismatch > 0)
    out.push({ type: "tag_mismatch", count: a.tag_mismatch, label: LABEL.tag_mismatch })
  if (a.recent_checkout_block > 0)
    out.push({
      type: "recent_checkout_block",
      count: a.recent_checkout_block,
      label: LABEL.recent_checkout_block,
    })
  return out
}

export function summarizeAnomalies(a: AnomalyCounts): string {
  const sev = classifySeverity(a)
  if (sev === "ok") return "정상"
  const details = [...listBlockingDetails(a), ...listWarningDetails(a)]
  const prefix = sev === "blocking" ? "🚫 차단" : "⚠ 경고"
  return `${prefix} · ${details.map((d) => `${d.label} ${d.count}건`).join(", ")}`
}
