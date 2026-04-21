"use client"

/**
 * useMenuConfig — Phase D + admin forced override.
 *
 * Resolution precedence:
 *   forced_per_store > forced_global > user_per_store > user_global > DEFAULT
 *
 * `resolveMenu` is ALWAYS re-run with `role` as authoritative filter,
 * so a forced override (or a tampered user payload) cannot surface a
 * role-disallowed menu item at render time.
 *
 * External API mirrors useRoomLayout:
 *   - items           : final rendered list
 *   - config          : the RESOLVED SidebarMenuConfig (after precedence)
 *   - loading         : true while either layer is still loading
 *   - hasUserConfig   : user has a personal pref
 *   - forcedActive    : admin forced override currently in effect
 *   - forcedSource    : "store" | "global" | null
 *   - setConfig/resetConfig           — personal
 *   - setForcedConfig/resetForcedConfig — admin
 *
 * Write helpers return Promise<boolean>.
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
import {
  DEFAULT_SIDEBAR_MENU,
  resolveMenu,
  type CounterMenuRole,
  type MenuItemDefinition,
  type SidebarMenuConfig,
} from "@/lib/counter/menu"

const SCOPE = "counter.sidebar_menu"

function isMenuConfig(v: unknown): v is SidebarMenuConfig {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  return (
    typeof o.version === "number" &&
    Array.isArray(o.order) &&
    Array.isArray(o.hidden)
  )
}

const subscribeUser = (l: () => void) => subscribePref(SCOPE, l)
const userSnap = () => getPrefSnapshot<SidebarMenuConfig>(SCOPE)
const subscribeForcedFn = (l: () => void) => subscribeForced(SCOPE, l)
const forcedSnap = () => getForcedSnapshot<SidebarMenuConfig>(SCOPE)

export type UseMenuConfigResult = {
  items: MenuItemDefinition[]
  config: SidebarMenuConfig
  loading: boolean
  hasUserConfig: boolean
  forcedActive: boolean
  forcedSource: "store" | "global" | null
  setConfig: (next: SidebarMenuConfig, target?: "store" | "global") => Promise<boolean>
  resetConfig: (target?: "store" | "global") => Promise<boolean>
  setForcedConfig: (next: SidebarMenuConfig, target?: "store" | "global") => Promise<boolean>
  resetForcedConfig: (target?: "store" | "global") => Promise<boolean>
}

export function useMenuConfig(
  role: CounterMenuRole | null,
  storeUuid: string | null,
): UseMenuConfigResult {
  useEffect(() => {
    ensurePrefLoaded<SidebarMenuConfig>(SCOPE)
    ensureForcedLoaded<SidebarMenuConfig>(SCOPE)
  }, [])

  const user = useSyncExternalStore(subscribeUser, userSnap, userSnap)
  const forced = useSyncExternalStore(subscribeForcedFn, forcedSnap, forcedSnap)

  const forcedStore = storeUuid && forced.resp?.per_store ? forced.resp.per_store[storeUuid] : undefined
  const forcedGlobal = forced.resp?.global
  const userStore = storeUuid && user.resp?.per_store ? user.resp.per_store[storeUuid] : undefined
  const userGlobal = user.resp?.global

  const config: SidebarMenuConfig =
    isMenuConfig(forcedStore)  ? forcedStore  :
    isMenuConfig(forcedGlobal) ? forcedGlobal :
    isMenuConfig(userStore)    ? userStore    :
    isMenuConfig(userGlobal)   ? userGlobal   :
    DEFAULT_SIDEBAR_MENU

  const hasUserConfig = isMenuConfig(userStore) || isMenuConfig(userGlobal)
  const forcedSource: "store" | "global" | null =
    isMenuConfig(forcedStore) ? "store" :
    isMenuConfig(forcedGlobal) ? "global" : null
  const forcedActive = forcedSource !== null

  const loading =
    (!user.loaded   && (user.loading   || !user.resp))  ||
    (!forced.loaded && (forced.loading || !forced.resp))

  // role filter 는 이 경로에서 **항상** 재적용된다 — stored config 가
  // 무엇이든 role-disallowed id 는 runtime 에서 제거된다.
  const items = resolveMenu(role, config)

  const setConfig = useCallback(
    (next: SidebarMenuConfig, target: "store" | "global" = "store") =>
      setPref<SidebarMenuConfig>(SCOPE, next, storeUuid, target),
    [storeUuid],
  )
  const resetConfig = useCallback(
    (target: "store" | "global" = "store") =>
      resetPref<SidebarMenuConfig>(SCOPE, storeUuid, target),
    [storeUuid],
  )
  const setForcedConfig = useCallback(
    (next: SidebarMenuConfig, target: "store" | "global" = "store") =>
      setForcedPref<SidebarMenuConfig>(SCOPE, next, storeUuid, target),
    [storeUuid],
  )
  const resetForcedConfig = useCallback(
    (target: "store" | "global" = "store") =>
      resetForcedPref<SidebarMenuConfig>(SCOPE, storeUuid, target),
    [storeUuid],
  )

  return {
    items,
    config,
    loading,
    hasUserConfig,
    forcedActive,
    forcedSource,
    setConfig,
    resetConfig,
    setForcedConfig,
    resetForcedConfig,
  }
}
