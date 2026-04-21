"use client"

import { useCallback, useState, type Dispatch, type SetStateAction } from "react"
import { apiFetch } from "@/lib/apiFetch"
import type { FocusData, Order, Participant } from "../types"

/**
 * useFocusedSession — owns focusRoomId / focusData / focusCache and the two
 * fetchers that populate them (fetchOrders / fetchFocusData).
 *
 * Behavior preserved verbatim from CounterPageV2.
 * enterFocus / exitFocus stay in the page because they coordinate with
 * orderOpen / selectedIds state that lives elsewhere — but they consume the
 * setters exposed here.
 */

type UseFocusedSessionReturn = {
  focusRoomId: string | null
  setFocusRoomId: Dispatch<SetStateAction<string | null>>
  focusData: FocusData | null
  setFocusData: Dispatch<SetStateAction<FocusData | null>>
  focusCache: Record<string, FocusData>
  setFocusCache: Dispatch<SetStateAction<Record<string, FocusData>>>
  fetchOrders: (sessionId: string) => Promise<Order[]>
  fetchFocusData: (roomId: string, sessionId: string, startedAt: string) => Promise<void>
}

export function useFocusedSession(): UseFocusedSessionReturn {
  const [focusRoomId, setFocusRoomId] = useState<string | null>(null)
  const [focusData, setFocusData] = useState<FocusData | null>(null)
  const [focusCache, setFocusCache] = useState<Record<string, FocusData>>({})

  const fetchOrders = useCallback(async (sessionId: string): Promise<Order[]> => {
    if (!sessionId) return []
    try {
      const res = await apiFetch(`/api/sessions/orders?session_id=${sessionId}`)
      const data = await res.json()
      return res.ok ? (data.orders ?? []) : []
    } catch { return [] }
  }, [])

  const fetchFocusData = useCallback(async (roomId: string, sessionId: string, startedAt: string) => {
    if (!sessionId) return
    try {
      const [pRes, orders] = await Promise.all([
        apiFetch(`/api/rooms/${roomId}/participants`),
        fetchOrders(sessionId),
      ])
      const pData = await pRes.json()
      const participants: Participant[] = Array.isArray(pData?.participants) ? pData.participants : []
      const fd: FocusData = {
        roomId, sessionId, started_at: startedAt,
        session_status: "active", participants, orders, loading: false,
      }
      setFocusData(fd)
      setFocusCache(prev => ({ ...prev, [roomId]: fd }))
    } catch {
      setFocusData(prev => prev ? { ...prev, loading: false } : null)
    }
  }, [fetchOrders])

  return {
    focusRoomId, setFocusRoomId,
    focusData, setFocusData,
    focusCache, setFocusCache,
    fetchOrders,
    fetchFocusData,
  }
}
