"use client"

/**
 * useMonitorViewOptions — per-user view-option toggles.
 *
 * Backed by the shared `preferencesStore` under scope
 * `counter.monitor_view_options`. Shares the forced / user store /
 * user global / DEFAULT precedence chain used by every other monitor
 * preference. Failures never surface to the operator — the UI just
 * falls back to the "everything OFF" default.
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
  DEFAULT_MONITOR_VIEW_OPTIONS,
  isMonitorViewOptions,
  mergeMonitorViewOptions,
  type MonitorViewOptions,
} from "@/lib/counter/monitorViewOptionsTypes"

const SCOPE = "counter.monitor_view_options"

const subUser = (l: () => void) => subscribePref(SCOPE, l)
const userSnap = () => getPrefSnapshot<MonitorViewOptions>(SCOPE)
const subForced = (l: () => void) => subscribeForced(SCOPE, l)
const forcedSnap = () => getForcedSnapshot<MonitorViewOptions>(SCOPE)

export type UseMonitorViewOptionsResult = {
  options: MonitorViewOptions
  loading: boolean
  forcedActive: boolean
  forcedSource: "store" | "global" | null
  update: (patch: Partial<MonitorViewOptions>, target?: "store" | "global") => Promise<boolean>
  reset: (target?: "store" | "global") => Promise<boolean>
}

export function useMonitorViewOptions(storeUuid: string | null): UseMonitorViewOptionsResult {
  useEffect(() => {
    ensurePrefLoaded<MonitorViewOptions>(SCOPE)
    ensureForcedLoaded<MonitorViewOptions>(SCOPE)
  }, [])

  const user = useSyncExternalStore(subUser, userSnap, userSnap)
  const forced = useSyncExternalStore(subForced, forcedSnap, forcedSnap)

  const forcedStore = storeUuid && forced.resp?.per_store ? forced.resp.per_store[storeUuid] : undefined
  const forcedGlobal = forced.resp?.global
  const userStore = storeUuid && user.resp?.per_store ? user.resp.per_store[storeUuid] : undefined
  const userGlobal = user.resp?.global

  const raw: MonitorViewOptions =
    isMonitorViewOptions(forcedStore)  ? forcedStore  :
    isMonitorViewOptions(forcedGlobal) ? forcedGlobal :
    isMonitorViewOptions(userStore)    ? userStore    :
    isMonitorViewOptions(userGlobal)   ? userGlobal   :
    DEFAULT_MONITOR_VIEW_OPTIONS

  // Safety merge — if a partial/legacy record was persisted before a
  // new key existed, any missing fields fall back to the default.
  const options = mergeMonitorViewOptions(DEFAULT_MONITOR_VIEW_OPTIONS, raw)

  const forcedSource: "store" | "global" | null =
    isMonitorViewOptions(forcedStore) ? "store" :
    isMonitorViewOptions(forcedGlobal) ? "global" : null

  const loading =
    (!user.loaded   && (user.loading   || !user.resp)) ||
    (!forced.loaded && (forced.loading || !forced.resp))

  const update = useCallback(
    (patch: Partial<MonitorViewOptions>, target: "store" | "global" = "store") =>
      setPref<MonitorViewOptions>(SCOPE, mergeMonitorViewOptions(options, patch), storeUuid, target),
    [options, storeUuid],
  )

  const reset = useCallback(
    (target: "store" | "global" = "store") =>
      resetPref<MonitorViewOptions>(SCOPE, storeUuid, target),
    [storeUuid],
  )

  return {
    options,
    loading,
    forcedActive: forcedSource !== null,
    forcedSource,
    update,
    reset,
  }
}
