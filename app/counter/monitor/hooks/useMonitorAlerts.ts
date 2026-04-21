"use client"

/**
 * useMonitorAlerts — per-user alert customization.
 *
 * Piped through the shared preferencesStore under scope
 * `counter.monitor_alerts`. Shares the full precedence chain with other
 * monitor prefs:
 *   forced_per_store → forced_global → user_per_store → user_global → DEFAULT
 *
 * No network/business mutation happens from this hook. It only reads the
 * user's preference blob and exposes a mutator that writes through the
 * same API already used by other scopes.
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
  DEFAULT_MONITOR_ALERTS,
  isMonitorAlertsPrefs,
  mergeMonitorAlertsPrefs,
  type MonitorAlertsPrefs,
} from "@/lib/counter/monitorAlertsTypes"

const SCOPE = "counter.monitor_alerts"

const subUser = (l: () => void) => subscribePref(SCOPE, l)
const userSnap = () => getPrefSnapshot<MonitorAlertsPrefs>(SCOPE)
const subForced = (l: () => void) => subscribeForced(SCOPE, l)
const forcedSnap = () => getForcedSnapshot<MonitorAlertsPrefs>(SCOPE)

export type UseMonitorAlertsResult = {
  prefs: MonitorAlertsPrefs
  loading: boolean
  forcedActive: boolean
  forcedSource: "store" | "global" | null
  update: (patch: Partial<MonitorAlertsPrefs>, target?: "store" | "global") => Promise<boolean>
  reset: (target?: "store" | "global") => Promise<boolean>
}

export function useMonitorAlerts(storeUuid: string | null): UseMonitorAlertsResult {
  useEffect(() => {
    ensurePrefLoaded<MonitorAlertsPrefs>(SCOPE)
    ensureForcedLoaded<MonitorAlertsPrefs>(SCOPE)
  }, [])

  const user = useSyncExternalStore(subUser, userSnap, userSnap)
  const forced = useSyncExternalStore(subForced, forcedSnap, forcedSnap)

  const forcedStore = storeUuid && forced.resp?.per_store ? forced.resp.per_store[storeUuid] : undefined
  const forcedGlobal = forced.resp?.global
  const userStore = storeUuid && user.resp?.per_store ? user.resp.per_store[storeUuid] : undefined
  const userGlobal = user.resp?.global

  const prefs: MonitorAlertsPrefs =
    isMonitorAlertsPrefs(forcedStore)  ? forcedStore  :
    isMonitorAlertsPrefs(forcedGlobal) ? forcedGlobal :
    isMonitorAlertsPrefs(userStore)    ? userStore    :
    isMonitorAlertsPrefs(userGlobal)   ? userGlobal   :
    DEFAULT_MONITOR_ALERTS

  const forcedSource: "store" | "global" | null =
    isMonitorAlertsPrefs(forcedStore) ? "store" :
    isMonitorAlertsPrefs(forcedGlobal) ? "global" : null

  const loading =
    (!user.loaded   && (user.loading   || !user.resp)) ||
    (!forced.loaded && (forced.loading || !forced.resp))

  const update = useCallback(
    (patch: Partial<MonitorAlertsPrefs>, target: "store" | "global" = "store") =>
      setPref<MonitorAlertsPrefs>(SCOPE, mergeMonitorAlertsPrefs(prefs, patch), storeUuid, target),
    [prefs, storeUuid],
  )

  const reset = useCallback(
    (target: "store" | "global" = "store") =>
      resetPref<MonitorAlertsPrefs>(SCOPE, storeUuid, target),
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
