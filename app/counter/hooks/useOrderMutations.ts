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
      const [orders] = await Promise.all([fetchOrders(sessionId), fetchRooms(), fetchInventory()])
      setFocusData(prev => prev ? { ...prev, orders } : null)
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
      const [orders] = await Promise.all([fetchOrders(focusData.sessionId), fetchRooms(), fetchInventory()])
      setFocusData(prev => prev ? { ...prev, orders } : null)
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
      const [orders] = await Promise.all([fetchOrders(focusData.sessionId), fetchRooms()])
      setFocusData(prev => prev ? { ...prev, orders } : null)
    } catch { setError("요청 오류") }
    finally { setBusy(false) }
  }

  return { orderForm, setOrderForm, handleAddOrder, handleQuickRepeatOrder, handleDeleteOrder }
}
