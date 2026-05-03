"use client"

/**
 * CafeCartModal — 배민 스타일 장바구니 + 주문.
 *   - 라인별 수량 +/- / 삭제
 *   - 결제수단 (계좌 입금 / 수령시 카드)
 *   - 수령 위치 (free 모드: 자유 텍스트)
 *   - 주문하기 → /api/cafe/orders POST
 */

import { useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import type { CafePaymentMethod } from "@/lib/cafe/types"

type CartLine = {
  key: string
  menu_id: string
  name: string
  price: number
  unit_price: number
  qty: number
  thumbnail_url: string | null
  options: Array<{ option_id: string; name: string; price_delta: number }>
}

type Props = {
  cafeStoreUuid: string
  cafeStoreName: string
  cart: CartLine[]
  onChangeQty: (key: string, delta: number) => void
  onRemoveLine: (key: string) => void
  onClear: () => void
  onClose: () => void
  /** 룸 배달 모드일 때 외부에서 주입. */
  delivery?: { mode: "room"; room_uuid: string; session_id: string } | { mode: "free" }
}

function fmt(n: number) { return n.toLocaleString() + "원" }

export default function CafeCartModal({
  cafeStoreUuid, cafeStoreName, cart, onChangeQty, onRemoveLine, onClear, onClose, delivery
}: Props) {
  const [paymentMethod, setPaymentMethod] = useState<CafePaymentMethod>("card_on_delivery")
  const [deliveryText, setDeliveryText] = useState("")
  const [notes, setNotes] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [account, setAccount] = useState<{ bank_name: string | null; account_number: string | null; account_holder: string | null } | null>(null)
  const [orderId, setOrderId] = useState<string | null>(null)

  const subtotal = cart.reduce((s, l) => s + l.unit_price * l.qty, 0)
  const cartCount = cart.reduce((s, l) => s + l.qty, 0)

  const isRoom = delivery?.mode === "room"

  async function submit() {
    if (cart.length === 0) { setError("장바구니가 비었습니다"); return }
    if (!isRoom && deliveryText.trim().length < 2) { setError("수령 위치를 입력하세요"); return }
    setSubmitting(true); setError("")
    try {
      const items = cart.flatMap((l) =>
        Array.from({ length: l.qty }, () => ({
          menu_id: l.menu_id,
          qty: 1,
          option_ids: l.options.map((o) => o.option_id),
        })),
      )
      // 같은 (menu_id, optionsKey) 는 qty 로 묶음
      const merged = new Map<string, { menu_id: string; qty: number; option_ids: string[] }>()
      for (const it of items) {
        const k = `${it.menu_id}::${[...it.option_ids].sort().join(",")}`
        const cur = merged.get(k)
        if (cur) cur.qty += 1
        else merged.set(k, { ...it })
      }
      const body: Record<string, unknown> = {
        cafe_store_uuid: cafeStoreUuid,
        items: Array.from(merged.values()),
        payment_method: paymentMethod,
        notes: notes.trim() || null,
      }
      if (isRoom && delivery?.mode === "room") {
        body.delivery_room_uuid = delivery.room_uuid
        body.delivery_session_id = delivery.session_id
      } else {
        body.delivery_text = deliveryText.trim()
      }
      const r = await apiFetch("/api/cafe/orders", { method: "POST", body: JSON.stringify(body) })
      const d = await r.json()
      if (!r.ok) { setError(d.message || d.error || "주문 실패"); return }
      setOrderId(d.order?.id ?? null)
      setAccount(d.account ?? null)
      onClear()
    } catch { setError("네트워크 오류") }
    finally { setSubmitting(false) }
  }

  // 주문 완료 화면
  if (orderId) {
    return (
      <div className="fixed inset-0 z-[200] bg-black/40 flex items-end sm:items-center justify-center">
        <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-6 space-y-4">
          <div className="text-center">
            <div className="text-5xl mb-2">✅</div>
            <div className="text-xl font-bold">주문 완료</div>
            <div className="text-sm text-gray-500 mt-1">{cafeStoreName} 가 곧 준비합니다</div>
          </div>
          <div className="text-sm text-gray-700 text-center">
            결제: <b>{paymentMethod === "account" ? "계좌 입금" : "수령 시 카드"}</b>
          </div>
          {paymentMethod === "account" && account && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 space-y-1 text-sm">
              <div className="font-bold text-yellow-700 mb-1">📌 입금 계좌</div>
              {account.bank_name && <div>{account.bank_name}</div>}
              {account.account_number && <div className="font-mono">{account.account_number}</div>}
              {account.account_holder && <div className="text-gray-500">예금주 {account.account_holder}</div>}
              <div className="text-base font-bold pt-1">{fmt(subtotal)}</div>
            </div>
          )}
          <button onClick={onClose} className="w-full bg-gray-900 text-white rounded-xl py-3 font-bold">확인</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[200] bg-black/40 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full sm:max-w-md max-h-[92vh] rounded-t-2xl sm:rounded-2xl flex flex-col">
        <header className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <span className="text-base font-bold">장바구니 ({cartCount})</span>
          <button onClick={onClose} className="text-gray-700 text-xl">✕</button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {cart.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">장바구니가 비었습니다</div>
          ) : (
            cart.map((l) => (
              <div key={l.key} className="flex gap-3 items-start py-2 border-b border-gray-50">
                <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0 flex items-center justify-center text-xl text-gray-300">
                  {l.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.thumbnail_url} alt={l.name} className="w-full h-full object-cover" />
                  ) : "🍴"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm">{l.name}</div>
                  {l.options.length > 0 && (
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      {l.options.map((o) => o.name).join(", ")}
                    </div>
                  )}
                  <div className="text-sm font-bold mt-1 tabular-nums">{fmt(l.unit_price * l.qty)}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <button onClick={() => onRemoveLine(l.key)} className="text-gray-400 text-xs">삭제</button>
                  <div className="flex items-center gap-1.5 mt-1">
                    <button onClick={() => onChangeQty(l.key, -1)} className="w-7 h-7 rounded-full border border-gray-300">−</button>
                    <span className="w-5 text-center text-sm tabular-nums">{l.qty}</span>
                    <button onClick={() => onChangeQty(l.key, 1)} className="w-7 h-7 rounded-full border border-gray-300">＋</button>
                  </div>
                </div>
              </div>
            ))
          )}

          {cart.length > 0 && (
            <>
              {/* 결제 수단 */}
              <div className="border-t border-gray-100 pt-4">
                <div className="font-bold mb-2 text-sm">결제 수단</div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setPaymentMethod("card_on_delivery")}
                    className={`py-3 rounded-xl border text-sm font-bold ${
                      paymentMethod === "card_on_delivery" ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 text-gray-700"
                    }`}>💳 수령 시 카드</button>
                  <button onClick={() => setPaymentMethod("account")}
                    className={`py-3 rounded-xl border text-sm font-bold ${
                      paymentMethod === "account" ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 text-gray-700"
                    }`}>🏦 계좌 입금</button>
                </div>
              </div>

              {/* 위치 */}
              {!isRoom && (
                <div>
                  <div className="font-bold mb-2 text-sm">수령 위치</div>
                  <input
                    value={deliveryText}
                    onChange={(e) => setDeliveryText(e.target.value)}
                    placeholder="예: 5층 마블 카운터"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                  />
                </div>
              )}

              {/* 메모 */}
              <div>
                <div className="font-bold mb-2 text-sm">요청사항</div>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="얼음 적게 / 시럽 빼주세요 등"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                />
              </div>
            </>
          )}

          {error && <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}
        </div>

        {/* 주문하기 */}
        {cart.length > 0 && (
          <div className="border-t border-gray-100 p-4">
            <button
              onClick={submit}
              disabled={submitting || (paymentMethod === "account" && false /* placeholder */)}
              className="w-full bg-gray-900 disabled:bg-gray-300 text-white rounded-xl py-4 font-bold flex items-center justify-between px-5"
            >
              <span>{submitting ? "주문 중…" : "주문하기"}</span>
              <span>{fmt(subtotal)}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
