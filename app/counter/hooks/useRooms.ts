"use client"

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import { useRouter } from "next/navigation"
import { createAuthedClient } from "@/lib/supabaseClient"
import { apiFetch } from "@/lib/apiFetch"
import { useServerClock } from "@/lib/time/serverClock"
import type { Room, DailySummary } from "../types"

/**
 * 2026-05-01 R-Counter-Speed: realtime-token module-level cache.
 *   카운터 ↔ 다른 페이지 이동 시 useRooms 가 unmount/remount 되며 매번
 *   realtime-token 1초+ fetch 하던 문제. expires_at 까지 60s 여유 있으면
 *   재사용 → 페이지 이동 즉시 token 사용 가능.
 */
let cachedRealtimeToken: { token: string; expires_at: number } | null = null

function getCachedRealtimeToken(): string | null {
  if (!cachedRealtimeToken) return null
  // 60 초 이내 만료 임박 → 새 fetch 강제.
  if (cachedRealtimeToken.expires_at * 1000 < Date.now() + 60_000) {
    cachedRealtimeToken = null
    return null
  }
  return cachedRealtimeToken.token
}

function setCachedRealtimeToken(token: string, expires_at: number): void {
  cachedRealtimeToken = { token, expires_at }
}

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
  /**
   * Postgres CDC event type — INSERT / UPDATE / DELETE.
   * Added in the realtime patch-mode round so callers can apply an
   * incremental patch to local state instead of a full refetch.
   */
  eventType?: "INSERT" | "UPDATE" | "DELETE"
  /**
   * Raw `new` row (INSERT/UPDATE). Typed as unknown record — callers
   * narrow by `table`. RLS is disabled for MVP so the full row is
   * delivered via Supabase Realtime with no column filtering.
   */
  newRow?: Record<string, unknown> | null
  /**
   * Raw `old` row (UPDATE/DELETE).
   */
  oldRow?: Record<string, unknown> | null
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
  // 2026-04-30 R-Counter-Clock: client clock 어긋남 방지. /api/system/time
  //   1회 fetch 후 offset 보정해서 server-adjusted now 1s tick 으로 반환.
  //   카운터 PC 시계가 5~30분 어긋난 매장에서도 elapsed/remaining 표시 정확.
  //   정산 금액은 server 가 별도 계산하므로 여기 영향 X (UI 표시만 보정).
  const now = useServerClock(1000)

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

      // 2026-05-01 R-Counter-Speed: /api/rooms 응답에 daily_totals 가 있으면
      //   별도 /api/reports/daily fetch 생략 (직렬 RTT 1회 절감, ~250ms).
      //   business_day_id 있는데 daily_totals 빈 응답 (구버전 서버) 일 때만 fallback.
      if (data.daily_totals) {
        setDailySummary({
          total_sessions: data.daily_totals.total_sessions ?? 0,
          gross_total: data.daily_totals.gross_total ?? 0,
          order_total: data.daily_totals.order_total ?? 0,
          participant_total: data.daily_totals.participant_total ?? 0,
        })
      } else if (data.business_day_id) {
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

  // 2026-04-30: polling clock 은 useServerClock 이 관리. 기존 setInterval 제거.

  // ─── Realtime token state (authed transition prep) ──────────────
  //
  // 변경 배경 (이번 라운드):
  //   room_sessions / session_participants / orders 에 RLS 가 켜지기 전에,
  //   realtime client 를 anon → authed 로 전환한다. anon 은 향후 RLS 정책
  //   (068/069/070 동형) 하에 0 이벤트로 degrade 되므로 fail-closed 설계가
  //   기본. token 이 없으면 구독을 열지 않는다.
  //
  // 토큰 소스:
  //   /api/auth/realtime-token  — 서버가 HttpOnly 쿠키(nox_access_token)
  //                               를 읽고 { access_token, expires_at } 반환.
  //                               401 → fail-closed (구독 X).
  //
  // 갱신:
  //   exp - 60 초 시점에 재요청해서 새 토큰으로 resubscribe. 실패 시
  //   기존 channel 은 즉시 해제하고 구독 없음 상태로 전환 (anon fallback
  //   금지 규칙).
  const [realtimeToken, setRealtimeToken] = useState<string | null>(() => {
    // 2026-05-01 R-Counter-Speed: module-level cache 재사용 (페이지 이동 후 재mount 시).
    return getCachedRealtimeToken()
  })
  const tokenRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchToken(): Promise<void> {
      // 2026-05-01 R-Counter-Speed: module cache hit 면 fetch 생략.
      const cached = getCachedRealtimeToken()
      if (cached) {
        setRealtimeToken(cached)
        return
      }
      try {
        const res = await apiFetch("/api/auth/realtime-token")
        if (cancelled) return
        if (!res.ok) {
          // fail-closed: 401/403/429/그 외 모두 token 비우기 → 구독 effect 가 열지 않음.
          // 조용히 죽지는 않게 한 줄 warn 로그 — Vercel logs / DevTools 에서
          // realtime 구독 미활성 원인을 추적할 단서를 남긴다. 토큰 자체는
          // 절대 로그에 남기지 않음 (상태 코드 + 에러 코드만).
          let code = "NO_BODY"
          try {
            const body = (await res.json()) as { error?: string }
            if (typeof body.error === "string") code = body.error
          } catch { /* ignore */ }
          // eslint-disable-next-line no-console
          console.warn(`[useRooms] realtime-token ${res.status} ${code} — realtime subscription disabled`)
          setRealtimeToken(null)
          // 429 는 짧은 backoff 로 재시도, 그 외 장애는 다음 mount 까지 대기.
          if (res.status === 429) {
            const retryAfter = Number(res.headers.get("Retry-After") ?? "") || 30
            if (tokenRefreshTimerRef.current) clearTimeout(tokenRefreshTimerRef.current)
            tokenRefreshTimerRef.current = setTimeout(() => { void fetchToken() }, retryAfter * 1000)
          }
          return
        }
        const body = (await res.json()) as { access_token?: string; expires_at?: number }
        const tok = typeof body.access_token === "string" ? body.access_token : ""
        const exp = typeof body.expires_at === "number" ? body.expires_at : 0
        if (!tok || !exp) {
          // eslint-disable-next-line no-console
          console.warn("[useRooms] realtime-token 200 but payload invalid — realtime disabled")
          setRealtimeToken(null)
          return
        }
        setRealtimeToken(tok)
        // 2026-05-01 R-Counter-Speed: module-level cache 저장 (page nav 시 재사용).
        setCachedRealtimeToken(tok, exp)
        // schedule refresh 60 s before exp. exp 이 이미 60 s 내면 30 s 후 재시도.
        const msUntilRefresh = Math.max(30_000, exp * 1000 - Date.now() - 60_000)
        if (tokenRefreshTimerRef.current) clearTimeout(tokenRefreshTimerRef.current)
        tokenRefreshTimerRef.current = setTimeout(() => { void fetchToken() }, msUntilRefresh)
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        // eslint-disable-next-line no-console
        console.warn(`[useRooms] realtime-token fetch failed: ${msg} — realtime disabled`)
        setRealtimeToken(null)
      }
    }

    void fetchToken()

    return () => {
      cancelled = true
      if (tokenRefreshTimerRef.current) {
        clearTimeout(tokenRefreshTimerRef.current)
        tokenRefreshTimerRef.current = null
      }
    }
  }, [])

  // ─── Realtime subscription ──────────────────────────────────────
  //
  // 구독 lifecycle:
  //   - realtimeToken / currentStoreUuid 가 모두 준비된 경우에만 channel open.
  //     둘 중 하나라도 없으면 기존 channel 이 있으면 teardown 후 구독 없음.
  //   - token 이 바뀌면 (refresh 성공 or 로그아웃 후 재로그인) dependency 가
  //     재평가되어 이전 channel 은 cleanup 으로 removeChannel, 새 token 으로
  //     재구독.
  //   - fail-closed: anon fallback 없음. token 부재 = 구독 없음.
  //
  // coalesce 동작 (기존):
  //   150ms 내 이벤트 1회 refreshRooms. onRealtimeEvent 콜백은 개별 이벤트로
  //   유지. refetchRooms 흐름 불변.
  useEffect(() => {
    if (!currentStoreUuid) return
    if (!realtimeToken) return // fail-closed

    type CdcEventType = "INSERT" | "UPDATE" | "DELETE"
    function dispatchEvent(
      table: RealtimeTable,
      eventType: CdcEventType,
      newRow: Record<string, unknown> | null,
      oldRow: Record<string, unknown> | null,
    ) {
      pendingEventsRef.current.add(table)
      const sink = onRealtimeEvent
      if (sink) {
        const legacyLen = (sink as { length: number }).length
        if (legacyLen <= 1) {
          try { (sink as (t: RealtimeTable) => void)(table) } catch { /* ignore */ }
        } else {
          const idRow = newRow ?? oldRow
          const ev: RealtimeEvent = {
            table,
            eventType,
            newRow,
            oldRow,
            roomId: typeof idRow?.room_uuid === "string" ? idRow.room_uuid as string : null,
            sessionId: typeof idRow?.session_id === "string" ? idRow.session_id as string : null,
          }
          try { (sink as (e: RealtimeEvent) => void)(ev) } catch { /* ignore */ }
        }
      }
      if (table !== "orders") scheduleRefreshRef.current?.()
    }

    function extractEventType(p: unknown): CdcEventType {
      const t = (p as { eventType?: string })?.eventType
      if (t === "INSERT" || t === "UPDATE" || t === "DELETE") return t
      return "UPDATE"
    }

    // 2026-04-24 P2 fix: store_uuid 필터를 서버(Realtime)에서 적용해서
    //   6~8층 확장 후 메시지량 폭증 방지. 이전에는 전체 매장 이벤트를
    //   client 가 받아 필터링 → 불필요한 트래픽/배터리 소모.
    const storeFilter = `store_uuid=eq.${currentStoreUuid}`
    // 2026-04-30 P0: createAuthedClient 는 NEXT_PUBLIC_SUPABASE_URL /
    //   NEXT_PUBLIC_SUPABASE_ANON_KEY 부재 시 throw. Cloud Run 빌드 args
    //   누락된 배포에서 카운터 페이지 전체가 죽는 사고 발생 (system_errors
    //   테이블 26회+ 기록). 여기서는 realtime degrade (구독 안 함) 로만
    //   처리하고 페이지는 계속 동작. 폴링이 1초 간격으로 데이터 갱신.
    let client: ReturnType<typeof createAuthedClient>
    try {
      client = createAuthedClient(realtimeToken)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // eslint-disable-next-line no-console
      console.warn(`[useRooms] realtime client init failed — disabled. ${msg}`)
      return
    }
    const channel = client
      .channel(`counter-v2-rt-${currentStoreUuid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_sessions", filter: storeFilter }, (p) => {
        dispatchEvent(
          "room_sessions",
          extractEventType(p),
          (p?.new as Record<string, unknown>) ?? null,
          (p?.old as Record<string, unknown>) ?? null,
        )
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "session_participants", filter: storeFilter }, (p) => {
        dispatchEvent(
          "session_participants",
          extractEventType(p),
          (p?.new as Record<string, unknown>) ?? null,
          (p?.old as Record<string, unknown>) ?? null,
        )
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: storeFilter }, (p) => {
        dispatchEvent(
          "orders",
          extractEventType(p),
          (p?.new as Record<string, unknown>) ?? null,
          (p?.old as Record<string, unknown>) ?? null,
        )
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
  }, [currentStoreUuid, realtimeToken, onRealtimeEvent])

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
