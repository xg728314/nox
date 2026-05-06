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
  fetchOrders: (sessionId: string, opts?: { force?: boolean }) => Promise<Order[]>
  fetchRooms: (opts?: { force?: boolean }) => Promise<void>
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
      // 2026-05-06: force:true — browser cache (max-age=6) 우회 → optimistic update
      //   덮어씀 방지 (방금 추가한 주문이 stale 응답에 의해 사라지는 race).
      void Promise.all([fetchOrders(sessionId, { force: true }), fetchRooms({ force: true }), fetchInventory()])
        .then(([orders]) => {
          setFocusData(prev => prev ? { ...prev, orders } : null)
        })
        .catch(() => { /* polling 이 catch up */ })
    } catch { setError("요청 오류") }
    finally { setBusy(false) }
  }

  // Quick repeat — clone an existing liquor order with qty=1 at its original prices.
  // Server re-validates sale_price >= store_price via the normal POST /api/sessions/orders path.
  //
  // 2026-05-06 R-NoBottleneck: BUSY 상태 + await 응답 대기 → 사용자가 +5병 빠르게
  //   클릭하면 첫 클릭만 fire 되고 나머지는 disabled. 응답 후 disabled 해제되면
  //   이미 사용자는 5번 더 누른 상태 → 지연된 한 번에 다 fire (+5병으로 보임).
  //
  //   현재: setBusy 안 함 (다른 mutation 차단 안 함) + Optimistic temp order 즉시
  //   추가 + 백그라운드 POST. 사용자는 매 클릭마다 즉각 +1병 보임. 빠른 연타 OK.
  async function handleQuickRepeatOrder(o: Order) {
    const { focusData, fetchOrders, fetchRooms, fetchInventory, setFocusData, setError } = deps
    if (!focusData) return
    setError("")

    // 1) 즉각 optimistic temp order — 사용자 인지 즉시 +1병.
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const customerAmt = (o.sale_price ?? o.unit_price ?? 0)
    const storeAmt = (o.store_price ?? o.unit_price ?? 0)
    const tempOrder = {
      id: tempId,
      session_id: focusData.sessionId,
      item_name: o.item_name,
      order_type: o.order_type,
      qty: 1,
      unit_price: customerAmt,
      store_price: storeAmt,
      sale_price: customerAmt,
      amount: customerAmt,
      manager_amount: customerAmt - storeAmt,
      customer_amount: customerAmt,
      ordered_by: null,
      created_at: new Date().toISOString(),
    } as unknown as Order
    setFocusData(prev => prev ? { ...prev, orders: [...prev.orders, tempOrder] } : null)

    // 2) 백그라운드 POST. await 안 함 — 다음 클릭 즉시 받기.
    void (async () => {
      try {
        const res = await apiFetch("/api/sessions/orders", {
          method: "POST",
          body: JSON.stringify({
            session_id: focusData.sessionId,
            item_name: o.item_name,
            order_type: o.order_type,
            qty: 1,
            unit_price: storeAmt,
            sale_price: customerAmt,
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          // 실패 — temp 제거 + 에러 표시.
          setFocusData(prev => prev ? { ...prev, orders: prev.orders.filter(x => x.id !== tempId) } : null)
          setError(data.message || "추가 실패")
          return
        }
        // 성공 — temp 를 real 로 치환 (real id, 정확한 amount).
        if (data?.order) {
          const real = data.order as Order
          setFocusData(prev => prev
            ? { ...prev, orders: prev.orders.map(x => x.id === tempId ? real : x) }
            : null)
        }
        // 백그라운드 동기화 (rooms/inventory 만 — orders 는 이미 patch 됨).
        void Promise.all([fetchRooms({ force: true }), fetchInventory()]).catch(() => { /* polling */ })
      } catch {
        setFocusData(prev => prev ? { ...prev, orders: prev.orders.filter(x => x.id !== tempId) } : null)
        setError("요청 오류")
      }
    })()
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
      // 2026-05-06: force:true — 삭제한 주문이 stale 응답에 의해 다시 나타남 race 방지.
      void Promise.all([fetchOrders(focusData.sessionId, { force: true }), fetchRooms({ force: true })])
        .then(([orders]) => {
          setFocusData(prev => prev ? { ...prev, orders } : null)
        })
        .catch(() => { /* polling 이 catch up */ })
    } catch { setError("요청 오류") }
    finally { setBusy(false) }
  }

  return { orderForm, setOrderForm, handleAddOrder, handleQuickRepeatOrder, handleDeleteOrder }
}
