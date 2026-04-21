/**
 * Monitor alert customization preferences.
 *
 * Persisted under preferences scope `counter.monitor_alerts` via the
 * existing shared `preferencesStore`. Reuses the full user/forced
 * precedence chain (forced_store → forced_global → user_store →
 * user_global → DEFAULT), so a super-admin / owner can pin alert
 * policy across a store without rewriting the system.
 *
 * Alert codes (server-derived):
 *   long_mid_out        — mid_out participant has been out for N minutes
 *   long_session        — active participant elapsed past N minutes
 *   overdue             — active participant exceeded their booked time
 *   extension_reminder  — extension action recorded but not yet applied
 *
 * Client filters server-emitted recommendations by:
 *   (1) `categories[code]` toggle
 *   (2) `thresholds.*_minutes` — recommendation must reach the user's
 *       configured minute floor to render
 *
 * Server ALWAYS computes the facts; client never infers alerts from raw
 * participant numbers (preserves "server computes recommendations;
 * client only renders").
 *
 * No business mutation is ever triggered by alerts.
 */

export type MonitorRecCode =
  | "long_mid_out"
  | "long_session"
  | "overdue"
  | "extension_reminder"

export type MonitorAlertsPrefs = {
  version: 1
  /** Show / hide each recommendation category entirely. */
  categories: Record<MonitorRecCode, boolean>
  /** Minute floor per minute-bearing category. */
  thresholds: {
    long_mid_out_minutes: number
    long_session_minutes: number
    overdue_minutes: number
  }
  /** Surface-level display toggles. */
  display: {
    /** SummaryBar cell halo when any participant in that category has
     *  an active alert. */
    summary_highlight: boolean
    /** Small exclamation badge on map avatars for participants with
     *  active alerts. */
    map_badges: boolean
    /** Render recommendation chips inline (absence rows, popover). */
    recommendations: boolean
  }
}

export const DEFAULT_MONITOR_ALERTS: MonitorAlertsPrefs = {
  version: 1,
  categories: {
    long_mid_out: true,
    long_session: true,
    overdue: true,
    extension_reminder: true,
  },
  thresholds: {
    long_mid_out_minutes: 10,
    long_session_minutes: 120,
    overdue_minutes: 1,
  },
  display: {
    summary_highlight: true,
    map_badges: true,
    recommendations: true,
  },
}

export function isMonitorAlertsPrefs(v: unknown): v is MonitorAlertsPrefs {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  if (typeof o.version !== "number") return false
  if (!o.categories || typeof o.categories !== "object") return false
  if (!o.thresholds || typeof o.thresholds !== "object") return false
  if (!o.display || typeof o.display !== "object") return false
  return true
}

export function mergeMonitorAlertsPrefs(
  prev: MonitorAlertsPrefs,
  patch: Partial<MonitorAlertsPrefs>,
): MonitorAlertsPrefs {
  return {
    ...prev,
    ...patch,
    version: 1,
    categories: { ...prev.categories, ...(patch.categories ?? {}) },
    thresholds: { ...prev.thresholds, ...(patch.thresholds ?? {}) },
    display: { ...prev.display, ...(patch.display ?? {}) },
  }
}

/**
 * Client-side filter: given a server-emitted recommendation list, drop
 * entries that the user has disabled or whose minutes don't reach the
 * user's threshold. Pure function — no side effects.
 */
export function filterRecommendations<R extends { code: MonitorRecCode; minutes?: number }>(
  recs: R[],
  prefs: MonitorAlertsPrefs,
): R[] {
  return recs.filter(r => {
    if (!prefs.categories[r.code]) return false
    const m = r.minutes ?? 0
    switch (r.code) {
      case "long_mid_out": return m >= prefs.thresholds.long_mid_out_minutes
      case "long_session": return m >= prefs.thresholds.long_session_minutes
      case "overdue":      return m >= prefs.thresholds.overdue_minutes
      case "extension_reminder": return true
      default: return false
    }
  })
}

export const REC_LABEL: Record<MonitorRecCode, string> = {
  long_mid_out: "오래 자리비움",
  long_session: "장시간 경과",
  overdue: "예상 종료 초과",
  extension_reminder: "연장 적용 필요",
}
