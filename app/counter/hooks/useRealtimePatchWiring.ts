"use client"

/**
 * R29-refactor: Realtime CDC 이벤트를 focusData 의 in-memory 상태로 patch.
 *
 * 이전 동작 (재페치): 모든 이벤트 발생 시 fetchFocusData 호출 →
 *   /api/rooms/{id}/participants + /api/sessions/orders 두 번 풀 페치.
 *   BLE ingest burst 시 participants×5 / orders×5 스택이 Network 탭에 보임.
 *
 * 현 동작 (patch-mode): Supabase CDC payload 가 row 전체를 포함 (RLS off) →
 *   row.id 키로 in-memory merge. 같은 session 의 이벤트만 처리, 다른 세션은
 *   useRooms 가 처리.
 *
 * Fallback: payload shape 가 예상과 다르면 (서버 업그레이드 중 등) 해당 이벤트
 *   에 대해서만 fetchFocusData 로 풀 페치 → UI 일관성 보장.
 */

import { useEffect } from "react"
import type { Dispatch, SetStateAction } from "react"
import type { useRooms } from "./useRooms"
import type { useFocusedSession } from "./useFocusedSession"
import type { Participant, Order } from "../types"

type FocusData = ReturnType<typeof useFocusedSession>["focusData"]
type RealtimeEvent = import("./useRooms").RealtimeEvent

export type UseRealtimePatchWiringDeps = {
  focusRoomId: string | null
  focusData: FocusData
  setFocusData: Dispatch<SetStateAction<FocusData>>
  setOnRealtimeEvent: ReturnType<typeof useRooms>["setOnRealtimeEvent"]
  fetchFocusData: (roomId: string, sessionId: string, startedAt: string) => void
}

export function useRealtimePatchWiring(deps: UseRealtimePatchWiringDeps): void {
  const { focusRoomId, focusData, setFocusData, setOnRealtimeEvent, fetchFocusData } = deps

  useEffect(() => {
    setOnRealtimeEvent((ev: RealtimeEvent) => {
      const focusSessionId = focusData?.sessionId
      if (!focusRoomId || !focusSessionId) return

      // room_sessions 자체 변경 — focused 세션이 그 대상이면 풀 페치 (드물고 저렴).
      if (ev.table === "room_sessions") {
        if (ev.sessionId === focusSessionId) {
          fetchFocusData(focusRoomId, focusSessionId, focusData.started_at)
        }
        return
      }

      // participants / orders — focused session 이벤트만 처리.
      const eventSessionId =
        ev.sessionId ??
        (ev.newRow?.session_id as string | undefined) ??
        (ev.oldRow?.session_id as string | undefined)
      if (eventSessionId && eventSessionId !== focusSessionId) return

      const eventType = ev.eventType ?? "UPDATE"

      if (ev.table === "session_participants") {
        const row = (ev.newRow ?? ev.oldRow) as Record<string, unknown> | null
        const id = typeof row?.id === "string" ? row.id : null
        if (!id) {
          fetchFocusData(focusRoomId, focusSessionId, focusData.started_at)
          return
        }
        setFocusData((prev) => {
          if (!prev || prev.sessionId !== focusSessionId) return prev
          if (eventType === "DELETE") {
            return { ...prev, participants: prev.participants.filter((p) => p.id !== id) }
          }
          const nextRow = ev.newRow as unknown as Participant | null
          if (!nextRow || typeof nextRow.id !== "string") {
            fetchFocusData(focusRoomId, focusSessionId, focusData.started_at)
            return prev
          }
          const idx = prev.participants.findIndex((p) => p.id === id)
          if (idx >= 0) {
            const merged = { ...prev.participants[idx], ...nextRow }
            const next = prev.participants.slice()
            next[idx] = merged
            return { ...prev, participants: next }
          }
          return { ...prev, participants: [...prev.participants, nextRow] }
        })
        return
      }

      if (ev.table === "orders") {
        const row = (ev.newRow ?? ev.oldRow) as Record<string, unknown> | null
        const id = typeof row?.id === "string" ? row.id : null
        if (!id) {
          fetchFocusData(focusRoomId, focusSessionId, focusData.started_at)
          return
        }
        setFocusData((prev) => {
          if (!prev || prev.sessionId !== focusSessionId) return prev
          if (eventType === "DELETE") {
            return { ...prev, orders: prev.orders.filter((o) => o.id !== id) }
          }
          const nextRow = ev.newRow as unknown as Order | null
          if (!nextRow || typeof nextRow.id !== "string") {
            fetchFocusData(focusRoomId, focusSessionId, focusData.started_at)
            return prev
          }
          const idx = prev.orders.findIndex((o) => o.id === id)
          if (idx >= 0) {
            const merged = { ...prev.orders[idx], ...nextRow }
            const next = prev.orders.slice()
            next[idx] = merged
            return { ...prev, orders: next }
          }
          return { ...prev, orders: [...prev.orders, nextRow] }
        })
      }
    })
    return () => setOnRealtimeEvent(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRoomId, focusData?.sessionId, focusData?.started_at])
}
