"use client"

/**
 * CafeOrderModal — 카페 메뉴 보고 장바구니에 담아 주문하는 통합 모달.
 *
 * Props 로 다음 받음:
 *   - cafeStoreUuid: 어느 카페에 주문?
 *   - delivery: { mode: "room", room_uuid, session_id } | { mode: "free" }
 *
 * 룸 모드: 호스티스가 룸채팅에서 클릭. 배달 위치 자동.
 * 자유 모드: 매장 직원/실장/사장 등. 자유 텍스트로 위치 입력.
 *
 * 흐름: 메뉴 fetch → 장바구니 (qty 증감) → 결제 방식 (계좌/카드) → 주문 → 결과 표시.
 */

import { useEffect, useMemo, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import type { CafeMenuItem, CafePaymentMethod } from "@/lib/cafe/types"

type DeliveryRoom = { mode: "room"; room_uuid: string; session_id: string; room_label?: string }
type DeliveryFree = { mode: "free" }
export type CafeOrderDelivery = DeliveryRoom | DeliveryFree

type Props = {
  cafeStoreUuid: string
  cafeStoreName?: string
  delivery: CafeOrderDelivery
  onClose: () => void
  onSuccess?: (orderId: string) => void
}

type AccountInfo = {
  bank_name: string | null
  account_number: string | null
  account_holder: string | null
}

function fmt(n: number) { return "₩" + n.toLocaleString() }

export default function CafeOrderModal({ cafeStoreUuid, cafeStoreName, delivery, onClose, onSuccess }: Props) {
  const [menu, setMenu] = useState<CafeMenuItem[]>([])
  const [cart, setCart] = useState<Record<string, number>>({}) // menu_id -> qty
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [paymentMethod, setPaymentMethod] = useState<CafePaymentMethod>("card_on_delivery")
  const [deliveryText, setDeliveryText] = useState("")
  const [notes, setNotes] = useState("")
  const [resultOrderId, setResultOrderId] = useState<string | null>(null)
  const [resultAccount, setResultAccount] = useState<AccountInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const r = await apiFetch(`/api/cafe/menu?store_uuid=${cafeStoreUuid}`)
        if (cancelled) return
        if (!r.ok) { setError("메뉴 로드 실패"); return }
        const d = await r.json()
        setMenu((d.menu ?? []) as CafeMenuItem[])
      } catch { if (!cancelled) setError("네트워크 오류") }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [cafeStoreUuid])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const m of menu) set.add(m.category)
    return Array.from(set)
  }, [menu])

  const subtotal = useMemo(() => {
    return menu.reduce((s, m) => s + (cart[m.id] ?? 0) * m.price, 0)
  }, [cart, menu])
  const cartCount = useMemo(() => Object.values(cart).reduce((a, b) => a + b, 0), [cart])

  function inc(id: string) { setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 })) }
  function dec(id: string) {
    setCart((c) => {
      const next = { ...c }
      const v = (next[id] ?? 0) - 1
      if (v <= 0) delete next[id]
      else next[id] = v
      return next
    })
  }

  async function submitOrder() {
    if (cartCount === 0) { setError("장바구니가 비어있습니다"); return }
    if (delivery.mode === "free" && deliveryText.trim().length < 2) {
      setError("수령 위치를 입력하세요"); return
    }
    setSubmitting(true); setError("")
    try {
      const items = Object.entries(cart).map(([menu_id, qty]) => ({ menu_id, qty }))
      const body: Record<string, unknown> = {
        cafe_store_uuid: cafeStoreUuid,
        items,
        payment_method: paymentMethod,
        notes: notes.trim() || null,
      }
      if (delivery.mode === "room") {
        body.delivery_room_uuid = delivery.room_uuid
        body.delivery_session_id = delivery.session_id
      } else {
        body.delivery_text = deliveryText.trim()
      }
      const r = await apiFetch("/api/cafe/orders", { method: "POST", body: JSON.stringify(body) })
      const d = await r.json()
      if (!r.ok) { setError(d.message || d.error || "주문 실패"); return }
      setResultOrderId(d.order?.id ?? null)
      setResultAccount(d.account ?? null)
      if (onSuccess && d.order?.id) onSuccess(d.order.id)
    } catch { setError("네트워크 오류") }
    finally { setSubmitting(false) }
  }

  // 주문 완료 화면
  if (resultOrderId) {
    return (
      <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal>
        <div className="bg-[#0a0c14] border border-emerald-500/30 rounded-2xl p-5 w-full max-w-md space-y-4 text-white">
          <div className="text-lg font-semibold text-emerald-300">✓ 주문 완료</div>
          <div className="text-sm text-slate-300">
            주문이 카페로 전달됐습니다.<br/>
            결제 방식: {paymentMethod === "account" ? "계좌 입금" : "수령 시 카드결제"}
          </div>
          {paymentMethod === "account" && resultAccount && (
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm space-y-1">
              <div className="font-semibold text-emerald-200">📌 입금 계좌</div>
              {resultAccount.bank_name && <div>은행: {resultAccount.bank_name}</div>}
              {resultAccount.account_number && (
                <div className="font-mono">계좌: {resultAccount.account_number}</div>
              )}
              {resultAccount.account_holder && <div>예금주: {resultAccount.account_holder}</div>}
              <div className="text-xs text-slate-400 mt-2">
                금액: {fmt(subtotal)} 입금 후 카페 측이 확인합니다.
              </div>
            </div>
          )}
          {paymentMethod === "account" && !resultAccount && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-200">
              계좌 정보 등록 안 된 카페입니다. 카페에 직접 문의하세요.
            </div>
          )}
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 text-sm font-semibold"
          >닫기</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal>
      <div className="bg-[#0a0c14] border border-cyan-500/30 rounded-2xl p-4 w-full max-w-2xl max-h-[92vh] overflow-y-auto text-white">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-base font-semibold">☕ 카페 주문{cafeStoreName ? ` — ${cafeStoreName}` : ""}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {delivery.mode === "room"
                ? `배달: ${delivery.room_label ?? "이 룸"}`
                : "수령 위치를 직접 입력해주세요"}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 text-sm">✕</button>
        </div>

        {error && (
          <div className="mb-3 p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">{error}</div>
        )}

        {loading ? (
          <div className="p-8 text-center text-cyan-400 text-sm animate-pulse">메뉴 불러오는 중…</div>
        ) : menu.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">등록된 메뉴가 없습니다</div>
        ) : (
          <>
            <div className="space-y-3 mb-4">
              {categories.map((cat) => (
                <div key={cat}>
                  <div className="text-xs font-semibold text-slate-400 mb-1.5">{cat}</div>
                  <div className="grid grid-cols-1 gap-1.5">
                    {menu.filter((m) => m.category === cat).map((m) => {
                      const qty = cart[m.id] ?? 0
                      return (
                        <div key={m.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] p-2.5">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium">{m.name}</div>
                            {m.description && (
                              <div className="text-[10px] text-slate-500 truncate">{m.description}</div>
                            )}
                            <div className="text-xs text-cyan-300 tabular-nums mt-0.5">{fmt(m.price)}</div>
                          </div>
                          <div className="flex items-center gap-1 ml-2">
                            <button
                              onClick={() => dec(m.id)}
                              disabled={qty === 0}
                              className="w-7 h-7 rounded-full bg-white/10 disabled:opacity-30 text-base"
                            >−</button>
                            <span className="w-6 text-center text-sm tabular-nums">{qty}</span>
                            <button
                              onClick={() => inc(m.id)}
                              className="w-7 h-7 rounded-full bg-cyan-500/30 text-base"
                            >＋</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* 자유 위치 입력 (room 모드 아닐 때) */}
            {delivery.mode === "free" && (
              <div className="mb-3">
                <label className="block text-[11px] text-slate-400 mb-1">수령 위치</label>
                <input
                  value={deliveryText}
                  onChange={(e) => setDeliveryText(e.target.value)}
                  placeholder="예: 5층 마블 카운터 / 6층 사장실"
                  className="w-full rounded-lg bg-[#030814] border border-white/10 px-3 py-2 text-sm"
                />
              </div>
            )}

            {/* 메모 */}
            <div className="mb-3">
              <label className="block text-[11px] text-slate-400 mb-1">메모 (선택)</label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="얼음 적게 / 설탕 빼고 등"
                className="w-full rounded-lg bg-[#030814] border border-white/10 px-3 py-2 text-sm"
              />
            </div>

            {/* 결제 방식 */}
            <div className="mb-4">
              <label className="block text-[11px] text-slate-400 mb-1.5">결제 방식</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setPaymentMethod("account")}
                  className={`py-2.5 rounded-lg border text-sm font-medium ${
                    paymentMethod === "account"
                      ? "border-cyan-500 bg-cyan-500/15 text-cyan-200"
                      : "border-white/15 bg-white/[0.03] text-slate-300"
                  }`}
                >💳 계좌 입금</button>
                <button
                  onClick={() => setPaymentMethod("card_on_delivery")}
                  className={`py-2.5 rounded-lg border text-sm font-medium ${
                    paymentMethod === "card_on_delivery"
                      ? "border-cyan-500 bg-cyan-500/15 text-cyan-200"
                      : "border-white/15 bg-white/[0.03] text-slate-300"
                  }`}
                >💳 수령 시 카드</button>
              </div>
              {paymentMethod === "account" && (
                <div className="text-[10px] text-slate-500 mt-1">
                  주문 후 카페 계좌번호 표시됩니다.
                </div>
              )}
            </div>

            {/* 합계 + 주문 */}
            <div className="sticky bottom-0 bg-[#0a0c14] pt-2 border-t border-white/10">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-400">합계 ({cartCount}개)</span>
                <span className="text-lg font-bold text-emerald-300">{fmt(subtotal)}</span>
              </div>
              <button
                onClick={submitOrder}
                disabled={submitting || cartCount === 0 || (delivery.mode === "free" && !deliveryText.trim())}
                className="w-full h-12 rounded-xl bg-[linear-gradient(90deg,#0ea5e9,#2563eb)] text-base font-semibold disabled:opacity-50"
              >{submitting ? "주문 중…" : "주문하기"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
