"use client"

/**
 * 카페 owner 주문 받기 inbox.
 * 5초마다 polling, 상태 변경 버튼으로 흐름 진행.
 */

import { useCallback, useEffect, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import { useServerClock } from "@/lib/time/serverClock"
import type { CafeOrder, CafeOrderInboxRow, CafeOrderStatus } from "@/lib/cafe/types"

const STATUSES: { v: CafeOrderStatus; label: string; next: CafeOrderStatus | null }[] = [
  { v: "pending", label: "주문", next: "preparing" },
  { v: "preparing", label: "준비중", next: "delivering" },
  { v: "delivering", label: "배달중", next: "delivered" },
  { v: "delivered", label: "완료", next: null },
  { v: "cancelled", label: "취소", next: null },
  { v: "credited", label: "외상", next: null },
]

function fmt(n: number) { return "₩" + n.toLocaleString() }
// 2026-05-03: 카운터 PC 시계 어긋남 대응 — server-adjusted now 사용.
//   주문 들어온 지 얼마나 됐는지 표시는 모든 매장에서 일관돼야 함.
function timeAgoFrom(now: number, iso: string) {
  const ms = now - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1) return "방금"
  if (m < 60) return `${m}분`
  return `${Math.floor(m / 60)}시간`
}

export default function CafeInboxPage() {
  const [orders, setOrders] = useState<CafeOrderInboxRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  // 2026-05-03: 30초 tick 으로 충분 — "n분 전" 만 표시하므로.
  const now = useServerClock(30_000)

  const load = useCallback(async () => {
    try {
      const r = await apiFetch("/api/cafe/orders/inbox")
      if (r.status === 401 || r.status === 403) { setError("권한 없음 (카페 owner/staff 만)"); return }
      const d = await r.json()
      if (!r.ok) { setError(d.message || "로드 실패"); return }
      setOrders(d.orders ?? [])
    } catch { setError("네트워크 오류") }
    finally { setLoading(false) }
  }, [])

  // Inbox 는 5초 polling 유지 — 주문 받기는 가장 즉각성 중요. CafeShell context 와 별개.
  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])

  async function setStatus(id: string, status: CafeOrderStatus) {
    await apiFetch(`/api/cafe/orders/${id}`, { method: "PATCH", body: JSON.stringify({ status }) })
    await load()
  }
  async function markPaid(id: string) {
    await apiFetch(`/api/cafe/orders/${id}`, { method: "PATCH", body: JSON.stringify({ mark_paid: true }) })
    await load()
  }

  async function makeCredit(orderId: string) {
    const customer = window.prompt("외상 손님 이름 (선택)") ?? ""
    const phone = window.prompt("연락처 (선택)") ?? ""
    const memo = window.prompt("외상 사유 / 메모 (선택)") ?? ""
    const r = await apiFetch("/api/cafe/credits", {
      method: "POST",
      body: JSON.stringify({
        order_id: orderId,
        customer_name: customer || null,
        customer_phone: phone || null,
        memo: memo || null,
      }),
    })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      alert(d.message || d.error || "외상 전환 실패")
      return
    }
    await load()
  }

  return (
    <div className="min-h-screen bg-[#0a0c14] text-white p-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-lg font-semibold mb-3">☕ 카페 주문 받기</h1>
        {error && (
          <div className="mb-3 p-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-xs">{error}</div>
        )}
        {loading ? (
          <div className="p-10 text-center text-cyan-400 animate-pulse">불러오는 중…</div>
        ) : orders.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm">진행 중인 주문이 없습니다</div>
        ) : (
          <div className="space-y-3">
            {orders.map((o) => {
              const stEntry = STATUSES.find((s) => s.v === o.status)
              const next = stEntry?.next
              return (
                <div key={o.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                        o.status === "pending" ? "bg-amber-500/30 text-amber-200"
                          : o.status === "preparing" ? "bg-cyan-500/30 text-cyan-200"
                          : o.status === "delivering" ? "bg-blue-500/30 text-blue-200"
                          : o.status === "delivered" ? "bg-emerald-500/30 text-emerald-200"
                          : "bg-red-500/30 text-red-200"
                      }`}>{stEntry?.label}</span>
                      <span className="text-xs text-slate-400">{timeAgoFrom(now, o.created_at)} 전</span>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10">
                      {o.payment_method === "account" ? "계좌" : "카드(수령시)"}
                    </span>
                  </div>

                  <div className="text-xs text-slate-300">
                    📍 {o.delivery_room_uuid
                      ? `${o.customer_store_name ?? "?"} · ${o.delivery_room_name ?? "룸"}`
                      : (o.delivery_text ?? "위치 없음")}
                    {o.customer_name && <span className="ml-2 text-slate-500">({o.customer_name})</span>}
                  </div>

                  <div className="space-y-0.5">
                    {(o.items as Array<{name: string; price: number; qty: number}>).map((it, i) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span>{it.name} × {it.qty}</span>
                        <span className="tabular-nums">{fmt(it.price * it.qty)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-sm font-semibold pt-1 border-t border-white/5">
                    <span>합계</span>
                    <span>{fmt(o.subtotal_amount)}</span>
                  </div>

                  {o.notes && <div className="text-[11px] text-amber-200 italic">📝 {o.notes}</div>}

                  <div className="flex gap-2 pt-1">
                    {o.payment_method === "account" && !o.paid_at && (
                      <button
                        onClick={() => markPaid(o.id)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-xs font-semibold"
                      >입금 확인</button>
                    )}
                    {o.payment_method === "account" && o.paid_at && (
                      <span className="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-300 text-xs">✓ 입금완료</span>
                    )}
                    {next && (
                      <button
                        onClick={() => setStatus(o.id, next)}
                        className="px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 text-xs font-semibold"
                      >→ {STATUSES.find((s) => s.v === next)?.label}</button>
                    )}
                    {o.status === "delivered" && (
                      <button
                        onClick={() => makeCredit(o.id)}
                        className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-200 text-xs font-semibold"
                      >📒 외상 전환</button>
                    )}
                    {o.status !== "cancelled" && o.status !== "delivered" && o.status !== "credited" && (
                      <button
                        onClick={() => { if (confirm("주문 취소?")) setStatus(o.id, "cancelled") }}
                        className="px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-200 text-xs"
                      >취소</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
