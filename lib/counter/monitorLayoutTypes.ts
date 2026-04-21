/**
 * Monitor layout preferences — shape + defaults.
 *
 * Persisted under preferences scope `counter.monitor_layout` using the
 * existing shared preferences store (`app/counter/hooks/preferencesStore.ts`).
 * Not a new storage backend — piggy-backs on `/api/me/preferences` so
 * it inherits scope precedence, optimistic-with-rollback, and the
 * live-propagation model.
 *
 * Scope is a single compound blob (not 3 separate scopes) because every
 * field is read/written together when the user toggles the minimap or
 * flips a panel. One scope keeps fetches/writes atomic.
 */

export type MonitorPanelId =
  | "home_workers"
  | "foreign_workers"
  | "floor_summary"
  | "absence"
  | "movement_feed"
  /** master switch for the entire right column (tablet drawer control). */
  | "right_column"

export type MonitorDensity = "compact" | "comfortable"

export type MonitorMobileTab = "rooms" | "map" | "workers" | "alerts"

export type MonitorLayoutPrefs = {
  version: 1
  /** When true, the center map region is hidden on desktop/tablet. */
  mapCollapsed: boolean
  density: MonitorDensity
  /** Fine-grained visibility toggles. `right_column=false` hides the whole
   *  right side on desktop; panels become drawer-openable on tablet. */
  panels: Record<MonitorPanelId, boolean>
  /** Default tab when the user lands on /counter/monitor on a phone. */
  mobileDefaultTab: MonitorMobileTab
}

export const DEFAULT_MONITOR_LAYOUT: MonitorLayoutPrefs = {
  version: 1,
  mapCollapsed: false,
  density: "comfortable",
  panels: {
    home_workers: true,
    foreign_workers: true,
    floor_summary: true,
    absence: true,
    movement_feed: true,
    right_column: true,
  },
  mobileDefaultTab: "rooms",
}

export function isMonitorLayoutPrefs(v: unknown): v is MonitorLayoutPrefs {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  if (typeof o.version !== "number") return false
  if (typeof o.mapCollapsed !== "boolean") return false
  if (typeof o.density !== "string") return false
  if (!o.panels || typeof o.panels !== "object") return false
  if (typeof o.mobileDefaultTab !== "string") return false
  return true
}

/**
 * Merge a partial update against the current prefs without losing
 * unknown fields. Used by the hook's `update(patch)` helper.
 */
export function mergeMonitorLayoutPrefs(
  prev: MonitorLayoutPrefs,
  patch: Partial<MonitorLayoutPrefs>,
): MonitorLayoutPrefs {
  return {
    ...prev,
    ...patch,
    version: 1,
    panels: { ...prev.panels, ...(patch.panels ?? {}) },
  }
}
