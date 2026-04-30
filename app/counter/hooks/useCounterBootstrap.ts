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
import { hydrateBundle } from "./preferencesStore"
import type { InventoryItem } from "../types"
import type { HostessMatchCandidate } from "../helpers/hostessMatcher"

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
    ;(async () => {
      try {
        const res = await apiFetch("/api/counter/bootstrap")
        if (cancelled) return
        if (!res.ok) {
          fetchUnreadChat(); fetchInventory(); fetchHostessStats(); fetchHostessPool()
          return
        }
        const data = await res.json() as Record<string, unknown>
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
