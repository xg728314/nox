"use client"

/**
 * R29 (2026-04-26): CounterPageV2.tsx 분할.
 *
 * 카운터 페이지 진입 시 한 번 호출되는 4개 데이터 fetch 묶음.
 *   - chat_unread   : 채팅 미읽음 카운트
 *   - inventory     : 주문 picker 용 품목 리스트
 *   - hostess_stats : 실장 시점 호스티스 현황
 *   - hostess_pool  : 이름 매칭 후보군 (read-only)
 *
 * 우선 `/api/counter/bootstrap` 단일 endpoint 로 한 번에 가져오고, 실패하거나
 * 일부 슬롯 누락 시 개별 endpoint 로 fallback. 이 패턴은 CounterPageV2 의
 * useEffect 에 인라인이었다 — 본 훅으로 분리해 페이지 컴포넌트의 useState
 * 표면을 4개 줄임.
 */

import { useCallback, useEffect, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import * as counterApi from "../services/counterApi"
import {
  hydrateBundle,
  claimSlotsForBootstrap,
  releaseClaimedSlots,
} from "./preferencesStore"
import type { InventoryItem } from "../types"
import type { HostessMatchCandidate } from "../helpers/hostessMatcher"

// 2026-05-01 R-Counter-Speed v2: bootstrap 가 prefetch 하는 prefs scope 화이트리스트.
//   client 가 ensurePrefLoaded 보다 먼저 이 slot 들을 inFlight 로 claim 해서
//   중복 fetch 차단. server 측 화이트리스트와 정확히 동기화되어야 함
//   (app/api/counter/bootstrap/route.ts COUNTER_PREF_SCOPES_USER / _FORCED).
const CLAIM_USER_SCOPES = [
  "daily_ops_check",
  "counter.sidebar_menu",
  "counter.room_layout",
] as const
const CLAIM_FORCED_SCOPES = [
  "counter.sidebar_menu",
  "counter.room_layout",
] as const

/**
 * 2026-05-01 R-Counter-Speed: bootstrap 응답 module-level cache (10초 TTL).
 *   카운터 ↔ 다른 페이지 이동 시 useCounterBootstrap remount 마다 4-5초 fetch
 *   하던 문제. 짧은 TTL 캐시로 같은 응답 재사용.
 *   mutation 후엔 invalidateBootstrapCache() 호출하면 즉시 무효화.
 */
const BOOTSTRAP_TTL_MS = 10_000
let cachedBootstrap: { data: Record<string, unknown>; ts: number } | null = null

function getCachedBootstrap(): Record<string, unknown> | null {
  if (!cachedBootstrap) return null
  if (Date.now() - cachedBootstrap.ts > BOOTSTRAP_TTL_MS) {
    cachedBootstrap = null
    return null
  }
  return cachedBootstrap.data
}
function setCachedBootstrap(data: Record<string, unknown>): void {
  cachedBootstrap = { data, ts: Date.now() }
}
export function invalidateBootstrapCache(): void {
  cachedBootstrap = null
}

export type HostessStats = {
  managed_total: number
  on_duty_count: number
  waiting_count: number
  in_room_count: number
  scope: string
}

export type UseCounterBootstrapResult = {
  chatUnread: number
  setChatUnread: (n: number) => void
  inventoryItems: InventoryItem[]
  hostessStats: HostessStats | null
  hostessNamePool: HostessMatchCandidate[] | string[]
  /** /api/counter/bootstrap 실패 시 개별 fetch 들. dependency 로 외부 hook 에 전달 가능. */
  fetchUnreadChat: () => Promise<void>
  fetchInventory: () => Promise<void>
  fetchHostessStats: () => Promise<void>
  fetchHostessPool: () => Promise<void>
}

export function useCounterBootstrap(): UseCounterBootstrapResult {
  // 2026-05-01 R-Counter-Speed v2: 첫 render 시점에 prefs slot 들을 inFlight 로
  //   claim. CounterPageV2 가 useCounterBootstrap 을 useRoomLayout / Sidebar /
  //   useMonitorViewOptions 보다 먼저 호출하므로, 같은 render pass 의 후속
  //   useEffect (ensurePrefLoaded) 들이 inFlight=true 를 보고 fetch 생략.
  //   직렬 6초+ 의 4개 preferences 직접 fetch 제거.
  useState(() => {
    if (typeof window !== "undefined" && !getCachedBootstrap()) {
      claimSlotsForBootstrap("user", CLAIM_USER_SCOPES)
      claimSlotsForBootstrap("forced", CLAIM_FORCED_SCOPES)
    }
    return true
  })

  const [chatUnread, setChatUnread] = useState(0)
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([])
  const [hostessStats, setHostessStats] = useState<HostessStats | null>(null)
  const [hostessNamePool, setHostessNamePool] = useState<HostessMatchCandidate[] | string[]>([])

  const fetchUnreadChat = useCallback(async () => {
    try {
      const r = await apiFetch("/api/chat/unread")
      if (!r.ok) return
      const d = await r.json().catch(() => ({})) as { unread?: number }
      if (typeof d.unread === "number") setChatUnread(d.unread)
    } catch { /* ignore */ }
  }, [])

  const fetchInventory = useCallback(async () => {
    try {
      const items = await counterApi.fetchInventoryItems<InventoryItem>()
      setInventoryItems(items)
    } catch { /* ignore */ }
  }, [])

  const fetchHostessStats = useCallback(async () => {
    try {
      const d = await counterApi.fetchHostessStats<HostessStats>()
      if (d) setHostessStats(d)
    } catch { /* ignore */ }
  }, [])

  // raw 응답을 매칭 후보군으로 정규화. 두 응답 형태 (구조화 vs 이름 only) 모두 흡수.
  const processHostessPool = useCallback((list: ReadonlyArray<Record<string, unknown>>) => {
    if (list.length === 0) { setHostessNamePool([]); return }
    const structured = list.every(
      (r) => typeof r?.membership_id === "string" && typeof r?.name === "string"
    )
    if (structured) {
      const seen = new Set<string>()
      const out: HostessMatchCandidate[] = []
      for (const r of list) {
        const mid = String(r.membership_id ?? "")
        if (!mid || seen.has(mid)) continue
        seen.add(mid)
        const name = typeof r.name === "string" ? r.name : ""
        const normalized_name =
          typeof r.normalized_name === "string" && (r.normalized_name as string).length > 0
            ? (r.normalized_name as string)
            : name.replace(/\s+/g, "").trim()
        out.push({
          membership_id: mid,
          name,
          normalized_name,
          store_uuid: (typeof r.store_uuid === "string" ? r.store_uuid : null),
          store_name: (typeof r.store_name === "string" ? r.store_name : null),
          manager_membership_id:
            typeof r.manager_membership_id === "string" ? r.manager_membership_id : null,
          manager_name:
            typeof r.manager_name === "string" ? r.manager_name : null,
          is_active_today:
            typeof r.is_active_today === "boolean" ? r.is_active_today : null,
          recent_assignment_score:
            typeof r.recent_assignment_score === "number" ? r.recent_assignment_score : null,
        })
      }
      setHostessNamePool(out)
    } else {
      const names = Array.from(
        new Set(
          list
            .map((s) => (typeof s?.name === "string" ? (s.name as string).trim() : ""))
            .filter((n): n is string => n.length > 0)
        )
      )
      setHostessNamePool(names)
    }
  }, [])

  const fetchHostessPool = useCallback(async () => {
    try {
      const list = await counterApi.fetchHostessPool()
      processHostessPool(list as ReadonlyArray<Record<string, unknown>>)
    } catch { /* ignore */ }
  }, [processHostessPool])

  // Bootstrap 1회 + 누락 슬롯 fallback.
  useEffect(() => {
    let cancelled = false

    function applyData(data: Record<string, unknown>) {
      if (data.preferences && typeof data.preferences === "object") {
        const prefs = data.preferences as Record<string, unknown>
        if (prefs.user) hydrateBundle("user", prefs.user as Parameters<typeof hydrateBundle>[1])
        if (prefs.forced) hydrateBundle("forced", prefs.forced as Parameters<typeof hydrateBundle>[1])
      }
      if (typeof data.chat_unread === "number") setChatUnread(data.chat_unread)
      if (data.inventory && Array.isArray((data.inventory as Record<string, unknown>).items)) {
        setInventoryItems((data.inventory as Record<string, unknown>).items as InventoryItem[])
      }
      if (data.hostess_stats && typeof data.hostess_stats === "object") {
        setHostessStats(data.hostess_stats as HostessStats)
      }
      if (Array.isArray(data.hostess_pool)) {
        processHostessPool(data.hostess_pool as ReadonlyArray<Record<string, unknown>>)
      }
    }

    // 2026-05-01 R-Counter-Speed: cache hit 면 즉시 적용 + fetch 생략.
    const cached = getCachedBootstrap()
    if (cached) {
      applyData(cached)
      return
    }

    ;(async () => {
      try {
        const res = await apiFetch("/api/counter/bootstrap")
        if (cancelled) return
        if (!res.ok) {
          // 2026-05-01 R-Counter-Speed v2: bootstrap 실패 시 claim 풀어서
          //   consumer hook 의 ensureLoaded 가 fetch 시도할 수 있게 한다.
          releaseClaimedSlots("user", CLAIM_USER_SCOPES)
          releaseClaimedSlots("forced", CLAIM_FORCED_SCOPES)
          fetchUnreadChat(); fetchInventory(); fetchHostessStats(); fetchHostessPool()
          return
        }
        const data = await res.json() as Record<string, unknown>
        setCachedBootstrap(data)
        const missing: string[] = []

        // 2026-04-30 R-Perf-PrefBundle: preferences hydrate.
        //   bootstrap 응답에 user/forced preferences 다중 scope 포함됨.
        //   preferencesStore 에 hydrate 하면 후속 ensureLoaded 5번 fetch skip.
        if (data.preferences && typeof data.preferences === "object") {
          const prefs = data.preferences as Record<string, unknown>
          if (prefs.user) hydrateBundle("user", prefs.user as Parameters<typeof hydrateBundle>[1])
          if (prefs.forced) hydrateBundle("forced", prefs.forced as Parameters<typeof hydrateBundle>[1])
        }

        if (typeof data.chat_unread === "number") setChatUnread(data.chat_unread)
        else missing.push("chat_unread")

        if (data.inventory && Array.isArray((data.inventory as Record<string, unknown>).items)) {
          setInventoryItems((data.inventory as Record<string, unknown>).items as InventoryItem[])
        } else missing.push("inventory")

        if (data.hostess_stats && typeof data.hostess_stats === "object") {
          setHostessStats(data.hostess_stats as HostessStats)
        } else missing.push("hostess_stats")

        if (Array.isArray(data.hostess_pool)) {
          processHostessPool(data.hostess_pool as ReadonlyArray<Record<string, unknown>>)
        } else missing.push("hostess_pool")

        if (missing.includes("chat_unread")) fetchUnreadChat()
        if (missing.includes("inventory")) fetchInventory()
        if (missing.includes("hostess_stats")) fetchHostessStats()
        if (missing.includes("hostess_pool")) fetchHostessPool()
      } catch {
        if (cancelled) return
        releaseClaimedSlots("user", CLAIM_USER_SCOPES)
        releaseClaimedSlots("forced", CLAIM_FORCED_SCOPES)
        fetchUnreadChat(); fetchInventory(); fetchHostessStats(); fetchHostessPool()
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    chatUnread, setChatUnread,
    inventoryItems, hostessStats, hostessNamePool,
    fetchUnreadChat, fetchInventory, fetchHostessStats, fetchHostessPool,
  }
}
