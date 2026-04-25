/**
 * Shared confidence style + label mappings.
 *
 * Single source of truth for color semantics + Korean copy used by
 * both the list-surface badge (`ConfidenceBadge`) and the map-surface
 * avatar dot (`FloorMap` Avatar). Consolidated here so the high /
 * medium / low palette can never drift between panels and the map.
 */

export type ConfidenceLevel = "high" | "medium" | "low"

export const LEVEL_LABEL: Record<ConfidenceLevel, string> = {
  high:   "높음",
  medium: "중간",
  low:    "낮음",
}

/**
 * Per-level style bundle. Only Tailwind utility strings — consumers
 * pick the slot they need (dot vs pill) without a second lookup.
 */
export const LEVEL_STYLE: Record<ConfidenceLevel, { dot: string; pill: string }> = {
  high: {
    dot:  "bg-emerald-400",
    pill: "bg-emerald-500/10 border-emerald-500/40 text-emerald-200",
  },
  medium: {
    dot:  "bg-amber-400",
    pill: "bg-amber-500/15 border-amber-500/45 text-amber-200",
  },
  low: {
    dot:  "bg-red-400",
    pill: "bg-red-500/20 border-red-500/50 text-red-200",
  },
}

/**
 * Reason code → Korean operator-facing label. Missing codes fall
 * through to the raw code string at call sites so a new rule added
 * server-side without a label update still renders something.
 */
export const REASON_LABEL: Record<string, string> = {
  signal_near_expiry:                    "신호 만료 임박",
  signal_moderate_age:                   "신호 오래됨",
  signal_timestamp_unknown:              "타임스탬프 오류",
  hotspot_zone:                          "핫스팟 구역",
  zone_unknown:                          "구역 미상",
  multiple_recent_corrections:           "최근 수정 다수",
  recent_correction:                     "최근 수정 있음",
  conflicts_with_very_recent_correction: "최근 수정과 불일치",
  flip_flop_pattern:                     "반복 토글",
  human_corrected:                       "사람 수정",
}
