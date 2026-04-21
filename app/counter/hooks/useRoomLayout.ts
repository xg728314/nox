"use client"

/**
 * useRoomLayout — Phase D + admin forced override.
 *
 * Resolution precedence (exact):
 *   1) forced_per_store
 *   2) forced_global
 *   3) user_per_store
 *   4) user_global
 *   5) DEFAULT_ROOM_LAYOUT
 *
 * Both user prefs and forced overrides are served by the shared
 * preferencesStore via `useSyncExternalStore`, so any editor save /
 * admin mutation propagates immediately to all live consumers
 * (RoomCardV2, RoomLayoutEditor, …) without reload.
 *
 * External API:
 *   - layout           : resolved RoomLayoutConfig
 *   - loading          : true while either layer is still loading
 *   - hasUserLayout    : user has a personal pref (store OR global)
 *   - forcedActive     : an admin forced override is currently in effect
 *   - forcedSource     : "store" | "global" | null
 *   - setLayout/resetLayout           — personal (user_preferences)
 *   - setForcedLayout/resetForcedLayout — admin (admin_preference_overrides)
 *
 * All write helpers return Promise<boolean> (true ⇒ 2xx).
 */

import { useCallback, useEffect, useSyncExternalStore } from "react"
import {
  ensureForcedLoaded,
  ensurePrefLoaded,
  getForcedSnapshot,
  getPrefSnapshot,
  resetForcedPref,
  resetPref,
  setForcedPref,
  setPref,
  subscribeForced,
  subscribePref,
} from "./preferencesStore"
import { DEFAULT_ROOM_LAYOUT, type RoomLayoutConfig } from "../widgets/layoutTypes"

const SCOPE = "counter.room_layout"

export type UseRoomLayoutResult = {
  layout: RoomLayoutConfig
  loading: boolean
  hasUserLayout: boolean
  forcedActive: boolean
  forcedSource: "store" | "global" | null
  setLayout: (next: RoomLayoutConfig, target?: "store" | "global") => Promise<boolean>
  resetLayout: (target?: "store" | "global") => Promise<boolean>
  setForcedLayout: (next: RoomLayoutConfig, target?: "store" | "global") => Promise<boolean>
  resetForcedLayout: (target?: "store" | "global") => Promise<boolean>
}

function isLayout(v: unknown): v is RoomLayoutConfig {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  return (
    typeof o.version === "number" &&
    Array.isArray(o.order) &&
    Array.isArray(o.hidden)
  )
}

const subscribeUser = (l: () => void) => subscribePref(SCOPE, l)
const userSnap = () => getPrefSnapshot<RoomLayoutConfig>(SCOPE)
const subscribeForcedFn = (l: () => void) => subscribeForced(SCOPE, l)
const forcedSnap = () => getForcedSnapshot<RoomLayoutConfig>(SCOPE)

export function useRoomLayout(storeUuid: string | null): UseRoomLayoutResult {
  useEffect(() => {
    ensurePrefLoaded<RoomLayoutConfig>(SCOPE)
    ensureForcedLoaded<RoomLayoutConfig>(SCOPE)
  }, [])

  const user = useSyncExternalStore(subscribeUser, userSnap, userSnap)
  const forced = useSyncExternalStore(subscribeForcedFn, forcedSnap, forcedSnap)

  const forcedStore = storeUuid && forced.resp?.per_store ? forced.resp.per_store[storeUuid] : undefined
  const forcedGlobal = forced.resp?.global
  const userStore = storeUuid && user.resp?.per_store ? user.resp.per_store[storeUuid] : undefined
  const userGlobal = user.resp?.global

  const resolved: RoomLayoutConfig =
    isLayout(forcedStore)  ? forcedStore  :
    isLayout(forcedGlobal) ? forcedGlobal :
    isLayout(userStore)    ? userStore    :
    isLayout(userGlobal)   ? userGlobal   :
    DEFAULT_ROOM_LAYOUT

  const hasUserLayout = isLayout(userStore) || isLayout(userGlobal)
  const forcedSource: "store" | "global" | null =
    isLayout(forcedStore) ? "store" :
    isLayout(forcedGlobal) ? "global" : null
  const forcedActive = forcedSource !== null

  const loading =
    (!user.loaded   && (user.loading   || !user.resp))  ||
    (!forced.loaded && (forced.loading || !forced.resp))

  const setLayout = useCallback(
    (next: RoomLayoutConfig, target: "store" | "global" = "store") =>
      setPref<RoomLayoutConfig>(SCOPE, next, storeUuid, target),
    [storeUuid],
  )
  const resetLayout = useCallback(
    (target: "store" | "global" = "store") =>
      resetPref<RoomLayoutConfig>(SCOPE, storeUuid, target),
    [storeUuid],
  )
  const setForcedLayout = useCallback(
    (next: RoomLayoutConfig, target: "store" | "global" = "store") =>
      setForcedPref<RoomLayoutConfig>(SCOPE, next, storeUuid, target),
    [storeUuid],
  )
  const resetForcedLayout = useCallback(
    (target: "store" | "global" = "store") =>
      resetForcedPref<RoomLayoutConfig>(SCOPE, storeUuid, target),
    [storeUuid],
  )

  return {
    layout: resolved,
    loading,
    hasUserLayout,
    forcedActive,
    forcedSource,
    setLayout,
    resetLayout,
    setForcedLayout,
    resetForcedLayout,
  }
}
