"use client"

/**
 * useMonitorData — polls /api/counter/monitor every N seconds.
 *
 * Phase 2 of this round wires real manual session/participant data. The
 * server is the single source of truth: this hook only fetches the
 * response and exposes it with refresh + loading state.
 *
 * Server is reachable via cookie + bearer. All business rules and
 * visibility policies are enforced server-side; the client never
 * post-filters foreign workers beyond what the server already returned.
 *
 * Phase 3 note: this file also hosts `useScopedMonitor(scope)` below.
 * The existing `useMonitorData()` signature is UNCHANGED and continues
 * to call `/api/counter/monitor` — MonitorPanel's data path is not
 * touched. `useScopedMonitor` is the new entry point for
 * CounterBleMinimapWidget (and future mobile widget) that need
 * multi-store scopes.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import type { MonitorResponse } from "../types"

const DEFAULT_INTERVAL_MS = 7_000

export type UseMonitorDataResult = {
  data: MonitorResponse | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  lastUpdatedAt: string | null
}

export function useMonitorData(intervalMs: number = DEFAULT_INTERVAL_MS): UseMonitorDataResult {
  const [data, setData] = useState<MonitorResponse | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)
  const mounted = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    mounted.current = false
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const r = await apiFetch("/api/counter/monitor")
      if (!r.ok) {
        const msg = r.status === 401 || r.status === 403
          ? "접근 권한이 없습니다."
          : `모니터링 데이터 로드 실패 (${r.status})`
        if (mounted.current) {
          setError(msg)
          setLoading(false)
        }
        return
      }
      const json = (await r.json()) as MonitorResponse
      if (!mounted.current) return
      setData(json)
      setError(null)
      setLastUpdatedAt(json.generated_at)
      setLoading(false)
    } catch (e) {
      if (!mounted.current) return
      setError(e instanceof Error ? e.message : "네트워크 오류")
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let stopped = false
    const loop = async () => {
      if (stopped) return
      await refresh()
      if (stopped) return
      timer.current = setTimeout(loop, intervalMs)
    }
    loop()
    return () => {
      stopped = true
      if (timer.current) clearTimeout(timer.current)
    }
  }, [intervalMs, refresh])

  return { data, loading, error, refresh, lastUpdatedAt }
}

// ────────────────────────────────────────────────────────────────
// useScopedMonitor — Phase 3 scope-aware hook.
// ────────────────────────────────────────────────────────────────

/**
 * Scope string accepted by the hook + API. 'mine' routes to the legacy
 * endpoint for zero regression; every other scope hits the new
 * /api/monitor/scope single-query layer and is unwrapped to
 * `MonitorResponse` so existing consumers keep working.
 */
export type MonitorScope =
  | "mine"
  | "current_floor"
  | "floor-5" | "floor-6" | "floor-7" | "floor-8"
  | `store-${string}`

type ScopedMonitorApiResponse = {
  scope: string
  generated_at: string
  mode: "manual" | "hybrid"
  stores: Array<{
    store_uuid: string
    store_name: string
    floor_no: number | null
    summary: MonitorResponse["summary"]
    rooms: MonitorResponse["rooms"]
    ble: MonitorResponse["ble"]
  }>
  home_workers: MonitorResponse["home_workers"]
  foreign_workers_at_mine: MonitorResponse["foreign_workers"]
  movement: MonitorResponse["movement"]
}

/**
 * Unwrap the new multi-store response into the single-store
 * `MonitorResponse` shape so existing consumers (widget, future mobile
 * minimap) render without reshaping.
 *
 * For multi-store scopes, `stores[0]` is used as the primary view
 * (caller's own store if present, else first). Callers that need
 * cross-store rollup should read the raw response via `useScopedMonitorRaw`
 * (left for a future phase — widget does not need it).
 */
function unwrapScopedResponse(
  r: ScopedMonitorApiResponse,
  preferStoreUuid: string | null,
): MonitorResponse {
  const store =
    (preferStoreUuid ? r.stores.find(s => s.store_uuid === preferStoreUuid) : null)
    ?? r.stores[0]
    ?? null

  const emptySummary = { present: 0, mid_out: 0, restroom: 0, external_floor: 0, waiting: 0 }

  return {
    store_uuid: store?.store_uuid ?? "",
    mode: r.mode,
    generated_at: r.generated_at,
    summary: store?.summary ?? emptySummary,
    rooms: store?.rooms ?? [],
    home_workers: r.home_workers ?? [],
    foreign_workers: r.foreign_workers_at_mine ?? [],
    movement: r.movement ?? [],
    ble: store?.ble ?? { confidence: "manual", presence: [] },
  }
}

export function useScopedMonitor(
  scope: MonitorScope,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): UseMonitorDataResult {
  const [data, setData] = useState<MonitorResponse | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)
  const mounted = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    mounted.current = false
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const refresh = useCallback(async () => {
    try {
      // scope === 'mine' → legacy endpoint, zero regression for callers
      // that migrated from useMonitorData to useScopedMonitor('mine').
      if (scope === "mine") {
        const r = await apiFetch("/api/counter/monitor")
        if (!r.ok) {
          const msg = r.status === 401 || r.status === 403
            ? "접근 권한이 없습니다."
            : `모니터링 데이터 로드 실패 (${r.status})`
          if (mounted.current) { setError(msg); setLoading(false) }
          return
        }
        const json = (await r.json()) as MonitorResponse
        if (!mounted.current) return
        setData(json)
        setError(null)
        setLastUpdatedAt(json.generated_at)
        setLoading(false)
        return
      }

      // Non-mine scopes → new single-query API.
      const url = `/api/monitor/scope?scope=${encodeURIComponent(scope)}`
      const r = await apiFetch(url)
      if (!r.ok) {
        const msg = r.status === 403
          ? "해당 범위를 볼 수 있는 권한이 없습니다."
          : r.status === 401
            ? "로그인이 필요합니다."
            : `모니터링 데이터 로드 실패 (${r.status})`
        if (mounted.current) { setError(msg); setLoading(false) }
        return
      }
      const json = (await r.json()) as ScopedMonitorApiResponse
      if (!mounted.current) return
      // Widget needs a single-store view; pick caller's own store when it's
      // in scope, else the first store.
      const unwrapped = unwrapScopedResponse(json, null)
      setData(unwrapped)
      setError(null)
      setLastUpdatedAt(unwrapped.generated_at)
      setLoading(false)
    } catch (e) {
      if (!mounted.current) return
      setError(e instanceof Error ? e.message : "네트워크 오류")
      setLoading(false)
    }
  }, [scope])

  useEffect(() => {
    let stopped = false
    const loop = async () => {
      if (stopped) return
      await refresh()
      if (stopped) return
      timer.current = setTimeout(loop, intervalMs)
    }
    loop()
    return () => {
      stopped = true
      if (timer.current) clearTimeout(timer.current)
    }
  }, [intervalMs, refresh])

  return { data, loading, error, refresh, lastUpdatedAt }
}
