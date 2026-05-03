"use client"

import { useState, type Dispatch, type SetStateAction } from "react"
import { apiFetch } from "@/lib/apiFetch"
import { ORDER_FORM_INIT } from "../types"
import type { FocusData, Order, OrderFormState } from "../types"

/**
 * useOrderMutations — owns orderForm + the three order mutation handlers
 * (handleAddOrder / handleQuickRepeatOrder / handleDeleteOrder) extracted
 * verbatim from CounterPageV2.
 *
 * Cross-hook dependencies are injected via a single deps object so the page
 * stays the one place that wires fetchers + state setters together.
 */

type Deps = {
  focusData: FocusData | null
  setFocusData: Dispatch<SetStateAction<FocusData | null>>
  fetchOrders: (sessionId: string) => Promise<Order[]>
  fetchRooms: () => Promise<void>
  fetchInventory: () => Promise<void>
  ensureSession: (roomId: string) => Promise<string | null>
  setBusy: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string>>
  setOrderOpen: Dispatch<SetStateAction<boolean>>
}

type UseOrderMutationsReturn = {
  orderForm: OrderFormState
  setOrderForm: Dispatch<SetStateAction<OrderFormState>>
  handleAddOrder: () => Promise<void>
  handleQuickRepeatOrder: (o: Order) => Promise<void>
  handleDeleteOrder: (orderId: string) => Promise<void>
}

export function useOrderMutations(deps: Deps): UseOrderMutationsReturn {
  const [orderForm, setOrderForm] = useState<OrderFormState>(ORDER_FORM_INIT)

  // 2026-05-03 R-Speed-x10: 주문 추가 후 fetchOrders/fetchRooms/fetchInventory 를
  //   await 하면 사용자 체감 latency = POST + 3개 GET 합계 (1.5~3초).
  //   POST 응답에 신규 order 가 포함되므로 그걸 즉시 focusData 에 박고 (optimistic)
  //   백그라운드 fetch 만 fire — 사용자는 POST 응답 즉시 busy 해제.
  async function handleAddOrder() {
    const { focusData, ensureSession, fetchOrders, fetchRooms, fetchInventory, setFocusData, setBusy, setError, setOrderOpen } = deps
    if (!focusData || !orderForm.item_name) return
    setBusy(true); setError("")
    try {
      const sessionId = await ensureSession(focusData.roomId)
      if (!sessionId) return
      const res = await apiFetch("/api/sessions/orders", {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId, ...orderForm }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.message || "주문 실패"); return }
      setOrderForm(ORDER_FORM_INIT)
      setOrderOpen(false)
      // Optimistic: POST 응답 데이터를 그대로 focusData.orders 에 prepend.
      if (data?.order) {
        setFocusData(prev => prev ? { ...prev, orders: [...prev.orders, data.order as Order] } : null)
      }
      // 백그라운드 refresh — 응답 latency 에 합산되지 않음.
      void Promise.all([fetchOrders(sessionId), fetchRooms(), fetchInventory()])
        .then(([orders]) => {
          setFocusData(prev => prev ? { ...prev, orders } : null)
        })
        .catch(() => { /* polling 이 catch up */ })
    } catch { setError("요청 오류") }
    finally { setBusy(false) }
  }

  // Quick repeat — clone an existing liquor order with qty=1 at its original prices.
  // Server re-validates sale_price >= store_price via the normal POST /api/sessions/orders path.
  async function handleQuickRepeatOrder(o: Order) {
    const { focusData, fetchOrders, fetchRooms, fetchInventory, setFocusData, setBusy, setError } = deps
    if (!focusData) return
    setBusy(true); setError("")
    try {
      const res = await apiFetch("/api/sessions/orders", {
        method: "POST",
        body: JSON.stringify({
          session_id: focusData.sessionId,
          item_name: o.item_name,
          order_type: o.order_type,
          qty: 1,
          unit_price: o.store_price ?? o.unit_price,
          sale_price: o.sale_price ?? o.unit_price,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.message || "추가 실패"); return }
      // Optimistic: 신규 order 즉시 표시.
      if (data?.order) {
        setFocusData(prev => prev ? { ...prev, orders: [...prev.orders, data.order as Order] } : null)
      }
      void Promise.all([fetchOrders(focusData.sessionId), fetchRooms(), fetchInventory()])
        .then(([orders]) => {
          setFocusData(prev => prev ? { ...prev, orders } : null)
        })
        .catch(() => { /* polling 이 catch up */ })
    } catch { setError("요청 오류") }
    finally { setBusy(false) }
  }

  async function handleDeleteOrder(orderId: string) {
    const { focusData, fetchOrders, fetchRooms, setFocusData, setBusy, setError } = deps
    if (!focusData) return
    if (!confirm("주문을 삭제하시겠습니까?")) return
    setBusy(true)
    try {
      const res = await apiFetch(`/api/sessions/orders/${orderId}`, { method: "DELETE" })
      if (!res.ok) { const d = await res.json(); setError(d.message || "삭제 실패"); return }
      // Optimistic: 즉시 list 에서 제거.
      setFocusData(prev => prev ? { ...prev, orders: prev.orders.filter(x => x.id !== orderId) } : null)
      void Promise.all([fetchOrders(focusData.sessionId), fetchRooms()])
        .then(([orders]) => {
          setFocusData(prev => prev ? { ...prev, orders } : null)
        })
        .catch(() => { /* polling 이 catch up */ })
    } catch { setError("요청 오류") }
    finally { setBusy(false) }
  }

  return { orderForm, setOrderForm, handleAddOrder, handleQuickRepeatOrder, handleDeleteOrder }
}
