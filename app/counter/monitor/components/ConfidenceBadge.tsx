"use client"

/**
 * ConfidenceBadge — minimal visual indicator for BLE presence
 * confidence. Driven entirely by server-computed
 * `MonitorBlePresence.confidence_*` fields; never re-derives anything.
 *
 * Display modes (tied to existing monitor view-option toggles):
 *
 *   BASIC (default)      → color dot only; reasons in native tooltip.
 *                          Never fully hidden — the dot is present on
 *                          every BLE hint.
 *   BLE VALIDATION       → color dot + level label (높음/중간/낮음)
 *                          (opt-in via `show_ble_validation_info`)
 *   ADMIN / KPI strip on → color dot + level label + short reason tag
 *                          + score (opt-in via `show_kpi_strip`)
 *
 * The basic-mode dot is intentionally tiny so it does not change the
 * row height on any existing panel. Hover title reveals the full
 * reason list and score for curious operators.
 */

import type { MonitorBlePresence } from "../types"
import { LEVEL_LABEL, LEVEL_STYLE, REASON_LABEL } from "./confidenceStyles"

export type ConfidenceBadgeProps = {
  data: Pick<MonitorBlePresence, "confidence_level" | "confidence_score" | "confidence_reasons">
  /** Show level label next to the dot. Controlled by
   *  `show_ble_validation_info`. */
  showLevel?: boolean
  /** Show first reason + score. Controlled by `show_kpi_strip`
   *  (used as the proxy for "admin detail mode"). */
  showDetail?: boolean
  size?: "xs" | "sm"
  className?: string
}

export default function ConfidenceBadge({
  data, showLevel = false, showDetail = false, size = "xs", className = "",
}: ConfidenceBadgeProps) {
  const level = data.confidence_level
  const style = LEVEL_STYLE[level]
  const reasons = data.confidence_reasons ?? []
  const firstReason = reasons[0]

  const titleLines: string[] = [
    `정확도: ${LEVEL_LABEL[level]} (${data.confidence_score.toFixed(2)})`,
    ...reasons.map(r => `• ${REASON_LABEL[r] ?? r}`),
  ]
  const title = titleLines.join("\n")

  // Basic mode — bare color dot. Always rendered (never hide in default).
  if (!showLevel && !showDetail) {
    return (
      <span
        className={`inline-flex items-center ${className}`}
        title={title}
        aria-label={`정확도 ${LEVEL_LABEL[level]}`}
      >
        <span className={`inline-block rounded-full ${style.dot} ${size === "sm" ? "w-2 h-2" : "w-1.5 h-1.5"}`} />
      </span>
    )
  }

  // Validation / admin — pill with level (+ optional detail).
  const sizeCls = size === "sm" ? "text-[11px] px-2 py-0.5" : "text-[9.5px] px-1.5 py-0.5"
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border font-semibold ${style.pill} ${sizeCls} ${className}`}
      title={title}
      aria-label={`정확도 ${LEVEL_LABEL[level]}`}
    >
      <span className={`inline-block rounded-full ${style.dot} ${size === "sm" ? "w-1.5 h-1.5" : "w-1 h-1"}`} />
      <span>{LEVEL_LABEL[level]}</span>
      {showDetail && firstReason && (
        <span className="opacity-80">· {REASON_LABEL[firstReason] ?? firstReason}</span>
      )}
      {showDetail && (
        <span className="opacity-60">· {data.confidence_score.toFixed(2)}</span>
      )}
    </span>
  )
}
