"use client"

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import { useRouter } from "next/navigation"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { apiFetch } from "@/lib/apiFetch"
import type { Room, DailySummary } from "../types"

/**
 * useRooms — owns rooms / dailySummary / currentStoreUuid / loading / now(polling)
 * / realtime subscription lifted out of CounterPageV2.
 *
 * Behavior preserved verbatim from the original inline code:
 *   - fetchRooms → /api/rooms, then if business_day_id present, /api/reports/daily
 *   - 401/403 → router.push("/login")
 *   - polling: setNow every 1s
 *   - realtime: subscribe to room_sessions / session_participants / orders
 *     and invoke refreshRooms on any change. Callers that also need to refresh
 *     focus data can pass onRealtimeEvent — the counter page uses it to
 *     call fetchFocusData on room_sessions / session_participants events.
 *
 * Returns setRooms so mutation handlers that optimistically patch the list
 * can keep doing so (existing pattern in CounterPageV2).
 */

type RealtimeTable = "room_sessions" | "session_participants" | "orders"

/**
 * Realtime event envelope — P1 준비 구조.
 * 현재: table 만 전달 (기존 형태). 다음 라운드에 room_uuid / session_id 필드를
 * 추가해 per-room refresh 로 좁히는 경로를 이미 callsite 가 받을 수 있도록
 * 보강형 타입을 함께 노출한다. 기존 호출자는 string 하나만 받아도 되도록
 * overload 형태로 유지.
 */
export type RealtimeEvent = {
  table: RealtimeTable
  /** payload 에 room_uuid 가 실려오면 선택적 refresh 에 사용할 수 있도록 전달.
   *  구현 전까지 null. */
  roomId?: string | null
  /** session_id (room_sessions / session_participants / orders 공통). */
  sessionId?: string | null
}

type UseRoomsReturn = {
  rooms: Room[]
  setRooms: Dispatch<SetStateAction<Room[]>>
  dailySummary: DailySummary | null
  currentStoreUuid: string | null
  loading: boolean
  now: number
  refreshRooms: () => Promise<void>
  /**
   * Per-room selective refresh scaffold (P1 — structure only).
   * 현재 동작: 전체 refreshRooms() 로 fall-back.
   * 다음 라운드에 특정 room/session 만 골라서 갱신하도록 채워 넣는다.
   */
  refreshRoomPartial: (roomId: string) => Promise<void>
  setOnRealtimeEvent: (cb: ((ev: RealtimeEvent) => void) | ((table: RealtimeTable) => void) | null) => void
}

export function useRooms(): UseRoomsReturn {
  const router = useRouter()

  const [rooms, setRooms] = useState<Room[]>([])
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null)
  const [currentStoreUuid, setCurrentStoreUuid] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())

  // Realtime event sink — updated via setOnRealtimeEvent. Stored in a ref-like
  // state so the realtime useEffect doesn't re-subscribe every time the parent
  // rebinds its callback (parent can call setOnRealtimeEvent freely).
  //
  // The callback accepts either the legacy `(table)` shape or the new
  // `(event)` shape; we normalize at dispatch time. Legacy callers keep
  // working without change.
  const [onRealtimeEvent, setOnRealtimeEventState] =
    useState<((ev: RealtimeEvent) => void) | ((table: RealtimeTable) => void) | null>(null)
  const setOnRealtimeEvent = useCallback(
    (cb: ((ev: RealtimeEvent) => void) | ((table: RealtimeTable) => void) | null) =>
      setOnRealtimeEventState(() => cb),
    []
  )

  // ─── Realtime coalesce scaffold (P1 — structure only) ───────────
  //
  // 현재 behavior: realtime 이벤트가 1건이든 N건이든 `refreshRooms()` 한 번만
  // 실행하도록 coalesce 창(150ms)을 둔다. 기존 동작 대비 중복 fetch 를
  // 억제하는 **성능 안전장치** 이며, 최종 state 결과는 동일하다.
  //
  // 다음 라운드에서 이벤트 payload (room_uuid/session_id) 를 활용해 전체
  // refreshRooms 대신 `refreshRoomPartial(roomId)` 로 좁히는 분기를 여기에
  // 추가한다.
  const coalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingEventsRef = useRef<Set<RealtimeTable>>(new Set())
  const scheduleRefreshRef = useRef<(() => void) | null>(null)

  const refreshRooms = useCallback(async () => {
    try {
      const res = await apiFetch("/api/rooms")
      if (res.status === 401 || res.status === 403) { router.push("/login"); return }
      const data = await res.json()
      setRooms(data.rooms || [])
      if (data.store_uuid) setCurrentStoreUuid(data.store_uuid)

      if (data.business_day_id) {
        const dr = await apiFetch(`/api/reports/daily?business_day_id=${data.business_day_id}`)
        if (dr.ok) {
          const dd = await dr.json()
          setDailySummary({
            total_sessions: dd.totals?.total_sessions ?? 0,
            gross_total: dd.totals?.gross_total ?? 0,
            order_total: dd.totals?.order_total ?? 0,
            participant_total: dd.totals?.participant_total ?? 0,
          })
        }
      }
    } catch {
      /* swallow; page-level error UI is handled elsewhere */
    } finally {
      setLoading(false)
    }
  }, [router])

  // Partial refresh stub — P1 scaffold.
  // 현재: 전체 refreshRooms 로 fall-back. 다음 라운드에서 /api/rooms/{id}
  // 또는 기존 /api/rooms 응답에서 해당 room 만 골라 setRooms 하는 경로로
  // 치환. caller 는 이미 이 함수로 호출해 두면 자동 혜택.
  const refreshRoomPartial = useCallback(async (_roomId: string) => {
    await refreshRooms()
  }, [refreshRooms])

  // Coalesce dispatcher — 마지막으로 호출된 onRealtimeEvent/최신 상태를
  // 기반으로 이벤트를 실행. 현재 behavior: 150ms 동안 들어온 이벤트를
  // 묶어서 refreshRooms 1회 + onRealtimeEvent callback 은 이벤트마다 전달.
  const scheduleRefresh = useCallback(() => {
    if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current)
    coalesceTimerRef.current = setTimeout(() => {
      coalesceTimerRef.current = null
      pendingEventsRef.current.clear()
      void refreshRooms()
    }, 150)
  }, [refreshRooms])
  scheduleRefreshRef.current = scheduleRefresh

  // Polling clock — 1s tick for remaining-time displays.
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [])

  // Realtime subscription — resubscribe only when store_uuid changes.
  //
  // P1 준비: 이벤트를 직접 refreshRooms 에 바로 꽂는 대신 scheduleRefresh
  // 를 통과시켜 150ms 내 중복을 하나로 합친다. onRealtimeEvent 콜백은
  // 이벤트마다 호출되며 legacy `(table)` 시그니처와 새 `(event)` 시그니처
  // 모두 지원. BLE ingest 가 session_participants 에 초당 수십 건을 쓰는
  // 시나리오에서 refetch 폭증을 구조적으로 막는다.
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key || !currentStoreUuid) return

    function dispatchEvent(table: RealtimeTable, payload?: Record<string, unknown>) {
      pendingEventsRef.current.add(table)
      const sink = onRealtimeEvent
      if (sink) {
        // Legacy `(table: RealtimeTable) => void` callers keep receiving the
        // original string. New `(ev: RealtimeEvent) => void` callers can use
        // roomId / sessionId hints (currently always null — payload parsing
        // is next-round scope).
        const legacyLen = (sink as { length: number }).length
        if (legacyLen <= 1) {
          try { (sink as (t: RealtimeTable) => void)(table) } catch { /* ignore */ }
        } else {
          const ev: RealtimeEvent = {
            table,
            roomId: typeof payload?.room_uuid === "string" ? payload.room_uuid as string : null,
            sessionId: typeof payload?.session_id === "string" ? payload.session_id as string : null,
          }
          try { (sink as (e: RealtimeEvent) => void)(ev) } catch { /* ignore */ }
        }
      }
      // orders 는 rooms 리스트 자체에 반영 안 되므로 refresh 스케줄 생략 —
      // 기존 동작과 동일 (orders 이벤트는 onRealtimeEvent 로만 전파).
      if (table !== "orders") scheduleRefreshRef.current?.()
    }

    const client = createSupabaseClient(url, key)
    const channel = client
      .channel("counter-v2-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "room_sessions" }, (p) => {
        dispatchEvent("room_sessions", p?.new as Record<string, unknown> ?? p?.old as Record<string, unknown>)
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "session_participants" }, (p) => {
        dispatchEvent("session_participants", p?.new as Record<string, unknown> ?? p?.old as Record<string, unknown>)
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (p) => {
        dispatchEvent("orders", p?.new as Record<string, unknown> ?? p?.old as Record<string, unknown>)
      })
      .subscribe()
    return () => {
      if (coalesceTimerRef.current) {
        clearTimeout(coalesceTimerRef.current)
        coalesceTimerRef.current = null
      }
      client.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStoreUuid, onRealtimeEvent])

  return {
    rooms,
    setRooms,
    dailySummary,
    currentStoreUuid,
    loading,
    now,
    refreshRooms,
    refreshRoomPartial,
    setOnRealtimeEvent,
  }
}
