"use client"

/**
 * R29-refactor: 손님 검색 / 등록 / 세션 저장 흐름을 별도 훅으로 분리.
 *   CounterPageV2 의 useState / handler 표면을 줄임.
 *
 * 동작:
 *   - searchCustomers(q): /api/customers?q=
 *   - createCustomer(data): /api/customers POST → 신규 row 반환
 *   - handleSaveCustomer({customer_id, customer_name_snapshot, customer_party_size}):
 *       세션 patch + 모달 닫기 + 방 목록 갱신
 */

import * as counterApi from "../services/counterApi"
import type { useFocusedSession } from "./useFocusedSession"

export type CustomerItem = {
  id: string
  name: string
  phone: string | null
  memo: string | null
}

type FocusData = ReturnType<typeof useFocusedSession>["focusData"]

export type UseCustomerFlowDeps = {
  focusData: FocusData
  ensureSession: (roomId: string) => Promise<string | null>
  fetchRooms: () => Promise<void>
  setCustomerModalOpen: (open: boolean) => void
  setBusy: (b: boolean) => void
  setError: (s: string) => void
}

export function useCustomerFlow(deps: UseCustomerFlowDeps) {
  async function searchCustomers(q: string): Promise<CustomerItem[]> {
    try {
      return await counterApi.searchCustomers<CustomerItem>(q)
    } catch { return [] }
  }

  async function createCustomer(data: { name: string; phone?: string }): Promise<CustomerItem | null> {
    try {
      const result = await counterApi.createCustomer(data)
      if (!result.ok) {
        const d = result.data as { message?: string }
        deps.setError(d?.message || "손님 등록 실패")
        return null
      }
      const d = result.data as { customer?: CustomerItem; message?: string } & CustomerItem
      // /api/customers 응답이 { customer: {...} } 또는 flat 양쪽 — 기존 동작 유지.
      return (d?.customer ?? (d as unknown as CustomerItem)) ?? null
    } catch {
      deps.setError("요청 오류")
      return null
    }
  }

  async function handleSaveCustomer(data: {
    customer_id: string | null
    customer_name_snapshot: string
    customer_party_size: number
  }) {
    if (!deps.focusData) return
    deps.setBusy(true)
    deps.setError("")
    try {
      const sessionId = await deps.ensureSession(deps.focusData.roomId)
      if (!sessionId) return
      const result = await counterApi.patchSession(sessionId, data as unknown as Record<string, unknown>)
      if (!result.ok) {
        const d = result.data as { message?: string }
        deps.setError(d?.message || "손님 정보 저장 실패")
        return
      }
      deps.setCustomerModalOpen(false)
      await deps.fetchRooms()
    } catch {
      deps.setError("요청 오류")
    } finally {
      deps.setBusy(false)
    }
  }

  return { searchCustomers, createCustomer, handleSaveCustomer }
}
