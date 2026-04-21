"use client"

/**
 * useMonitorPreferences — monitor layout prefs piped through the
 * existing shared preferencesStore. Reuses the same scope-precedence
 * chain (forced_store → forced_global → user_store → user_global →
 * DEFAULT) that room_layout / sidebar_menu use.
 *
 * Scope: `counter.monitor_layout`.
 *
 * Exposes:
 *   - prefs       : resolved MonitorLayoutPrefs
 *   - loading     : initial load in-flight
 *   - forcedActive: any admin forced override is in effect
 *   - update(patch, target?) → Promise<boolean>
 *   - reset(target?)         → Promise<boolean>
 */

import { useCallback, useEffect, useSyncExternalStore } from "react"
import {
  ensureForcedLoaded,
  ensurePrefLoaded,
  getForcedSnapshot,
  getPrefSnapshot,
  resetPref,
  setPref,
  subscribeForced,
  subscribePref,
} from "../../hooks/preferencesStore"
import {
  DEFAULT_MONITOR_LAYOUT,
  isMonitorLayoutPrefs,
  mergeMonitorLayoutPrefs,
  type MonitorLayoutPrefs,
} from "@/lib/counter/monitorLayoutTypes"

const SCOPE = "counter.monitor_layout"

const subUser = (l: () => void) => subscribePref(SCOPE, l)
const userSnap = () => getPrefSnapshot<MonitorLayoutPrefs>(SCOPE)
const subForced = (l: () => void) => subscribeForced(SCOPE, l)
const forcedSnap = () => getForcedSnapshot<MonitorLayoutPrefs>(SCOPE)

export type UseMonitorPreferencesResult = {
  prefs: MonitorLayoutPrefs
  loading: boolean
  forcedActive: boolean
  forcedSource: "store" | "global" | null
  update: (patch: Partial<MonitorLayoutPrefs>, target?: "store" | "global") => Promise<boolean>
  reset: (target?: "store" | "global") => Promise<boolean>
}

export function useMonitorPreferences(storeUuid: string | null): UseMonitorPreferencesResult {
  useEffect(() => {
    ensurePrefLoaded<MonitorLayoutPrefs>(SCOPE)
    ensureForcedLoaded<MonitorLayoutPrefs>(SCOPE)
  }, [])

  const user = useSyncExternalStore(subUser, userSnap, userSnap)
  const forced = useSyncExternalStore(subForced, forcedSnap, forcedSnap)

  const forcedStore = storeUuid && forced.resp?.per_store ? forced.resp.per_store[storeUuid] : undefined
  const forcedGlobal = forced.resp?.global
  const userStore = storeUuid && user.resp?.per_store ? user.resp.per_store[storeUuid] : undefined
  const userGlobal = user.resp?.global

  const prefs: MonitorLayoutPrefs =
    isMonitorLayoutPrefs(forcedStore)  ? forcedStore  :
    isMonitorLayoutPrefs(forcedGlobal) ? forcedGlobal :
    isMonitorLayoutPrefs(userStore)    ? userStore    :
    isMonitorLayoutPrefs(userGlobal)   ? userGlobal   :
    DEFAULT_MONITOR_LAYOUT

  const forcedSource: "store" | "global" | null =
    isMonitorLayoutPrefs(forcedStore) ? "store" :
    isMonitorLayoutPrefs(forcedGlobal) ? "global" : null

  const loading =
    (!user.loaded   && (user.loading   || !user.resp)) ||
    (!forced.loaded && (forced.loading || !forced.resp))

  const update = useCallback(
    async (patch: Partial<MonitorLayoutPrefs>, target: "store" | "global" = "store"): Promise<boolean> => {
      const merged = mergeMonitorLayoutPrefs(prefs, patch)
      return setPref<MonitorLayoutPrefs>(SCOPE, merged, storeUuid, target)
    },
    [prefs, storeUuid],
  )

  const reset = useCallback(
    (target: "store" | "global" = "store"): Promise<boolean> =>
      resetPref<MonitorLayoutPrefs>(SCOPE, storeUuid, target),
    [storeUuid],
  )

  return {
    prefs,
    loading,
    forcedActive: forcedSource !== null,
    forcedSource,
    update,
    reset,
  }
}
