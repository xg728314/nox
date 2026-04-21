/**
 * Monitor view-option preferences — scope `counter.monitor_view_options`.
 *
 * A per-user toggle set for BLE validation / analytics surfaces on
 * /counter/monitor. Keeps the default monitor view simple for
 * operators who are not participating in BLE validation, and lets
 * participating operators opt into advanced tools.
 *
 * Five toggles, all default OFF so a first-time operator sees a clean
 * monitor identical to the pre-BLE-overlay experience:
 *
 *   show_ble_validation_info    BleHint pills on panel rows when
 *                               source === "ble" (raw BLE readings).
 *   show_correction_indicators  BleHint "수정" pill variant on panel
 *                               rows when source === "corrected"
 *                               (human overlay). Does NOT hide the
 *                               correction itself — the zone is still
 *                               replaced server-side; this just hides
 *                               the visual 수정 distinction.
 *   show_feedback_buttons       👍 / 👎 quick-taps in ActionPopover.
 *   show_recommendation_hints   ⚠ recommendation chips in absence
 *                               rows and the action popover. When
 *                               false, also hides the red-ring long-
 *                               mid-out accent on absence rows.
 *   show_kpi_strip              Thin accuracy + contribution KPI
 *                               strip under the toolbar.
 *
 * Persisted via the existing shared `preferencesStore` so this scope
 * inherits the same user / forced-override precedence chain used by
 * every other monitor preference.
 */

export type MonitorViewOptions = {
  version: 1
  show_ble_validation_info: boolean
  show_correction_indicators: boolean
  show_feedback_buttons: boolean
  show_recommendation_hints: boolean
  show_kpi_strip: boolean
}

export const DEFAULT_MONITOR_VIEW_OPTIONS: MonitorViewOptions = {
  version: 1,
  show_ble_validation_info: false,
  show_correction_indicators: false,
  show_feedback_buttons: false,
  show_recommendation_hints: false,
  show_kpi_strip: false,
}

export function isMonitorViewOptions(v: unknown): v is MonitorViewOptions {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  if (typeof o.version !== "number") return false
  // Boolean guards: accept presence; default anything missing to false
  // at the consumer via mergeMonitorViewOptions.
  return true
}

export function mergeMonitorViewOptions(
  prev: MonitorViewOptions,
  patch: Partial<MonitorViewOptions>,
): MonitorViewOptions {
  return {
    version: 1,
    show_ble_validation_info:   patch.show_ble_validation_info   ?? prev.show_ble_validation_info,
    show_correction_indicators: patch.show_correction_indicators ?? prev.show_correction_indicators,
    show_feedback_buttons:      patch.show_feedback_buttons      ?? prev.show_feedback_buttons,
    show_recommendation_hints:  patch.show_recommendation_hints  ?? prev.show_recommendation_hints,
    show_kpi_strip:             patch.show_kpi_strip             ?? prev.show_kpi_strip,
  }
}

export const VIEW_OPTION_LABELS: Record<keyof Omit<MonitorViewOptions, "version">, string> = {
  show_ble_validation_info:   "BLE 검증 정보",
  show_correction_indicators: "수정 표시",
  show_feedback_buttons:      "피드백 버튼",
  show_recommendation_hints:  "추천 힌트",
  show_kpi_strip:             "정확도 KPI",
}
