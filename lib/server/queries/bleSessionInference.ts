/**
 * Pure helpers for the BLE session_inference cron. Extracted for unit
 * testability — behaviour identical to the in-route implementation.
 *
 * Locked constants (see round design doc):
 *   WINDOW_SEC           = 600   (10 min bucket for source_ref)
 *   DURATION_MIN_SKIP    = 9     (minutes; <9m is not billable per biz rule)
 *   DEFAULT_MIN          = 15    (reaper fallback duration in minutes)
 *   MAX_OPEN_DURATION_MS = 4h    (reaper cutoff)
 */

export const WINDOW_SEC = 600
export const DURATION_MIN_SKIP = 9
export const DEFAULT_MIN = 15
export const MAX_OPEN_DURATION_MS = 4 * 60 * 60 * 1000

/**
 * Infer work_type from session duration.
 *   < 9m         → null (skip; not billable — 비즈룰: 0–8분 기본 0원)
 *   9m  – 15m    → "cha3"
 *   16m – 45m    → "half"
 *   > 45m        → "full"
 */
export function inferWorkType(
  durationMs: number,
): "cha3" | "half" | "full" | null {
  if (!Number.isFinite(durationMs)) return null
  const m = durationMs / 60000
  if (m < DURATION_MIN_SKIP) return null
  if (m <= 15) return "cha3"
  if (m <= 45) return "half"
  return "full"
}

/**
 * Deterministic source_ref for dedupe via UNIQUE(source, source_ref).
 *   "ble:{gateway_id}:{minor}:{floor(enter_ts_sec / WINDOW_SEC)}"
 */
export function sourceRef(
  gatewayId: string,
  minor: number,
  enterIso: string,
): string {
  const tsSec = Math.floor(new Date(enterIso).getTime() / 1000)
  const bucket = Math.floor(tsSec / WINDOW_SEC)
  return `ble:${gatewayId}:${minor}:${bucket}`
}
