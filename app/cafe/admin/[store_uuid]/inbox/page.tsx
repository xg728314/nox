"use client"

/**
 * /cafe/admin/[store_uuid]/inbox — super_admin 이 임의 카페의 inbox 조회.
 *   ?store_uuid=X 쿼리 파라미터로 inbox API 가 super_admin 에게 허용.
 *   읽기 전용 — 상태 변경 / 입금 확인 버튼 비활성 (실제 카페 staff 가 처리).
 */

import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { apiFetch } from "@/lib/apiFetch"
import { useServerClock } from "@/lib/time/serverClock"
import type { CafeOrderInboxRow, CafeOrderStatus } from "@/lib/cafe/types"

const STATUS_LABEL: Record<CafeOrderStatus, string> = {
  pending: "주문", preparing: "준비중", delivering: "배달중", delivered: "완료", cancelled: "취소", credited: "외상",
}
function fmt(n: number) { return "₩" + n.toLocaleString() }
// 2026-05-03: server-adjusted now 인자로 받음 (PC 시계 어긋남 무시).
function timeAgoFrom(now: number, iso: string) {
  const ms = now - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1) return "방금"
  if (m < 60) return `${m}분`
  return `${Math.floor(m / 60)}시간`
}

export default function CafeAdminInboxPage() {
  const params = useParams()
  const storeId = params.store_uuid as string
  const [orders, setOrders] = useState<CafeOrderInboxRow[]>([])
  const [storeName, setStoreName] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [filter, setFilter] = useState<CafeOrderStatus | "active" | "all">("active")
  const now = useServerClock(30_000)

  const load = useCallback(async () => {
    setLoading(true); setError("")
    try {
      const statusParam = filter === "active" || filter === "all" ? "" : `&status=${filter}`
      const r = await apiFetch(`/api/cafe/orders/inbox?store_uuid=${storeId}${statusParam}`)
      const d = await r.json()
      if (!r.ok) { setError(d.message || "로드 실패"); return }
      let list = (d.orders ?? []) as CafeOrderInboxRow[]
      if (filter === "all") {
        // active 외에도 보려면 별도 호출 필요. 여기선 active 기본값 + 필터별 호출.
      }
      setOrders(list)

      // 매장 이름 fetch
      const sR = await apiFetch("/api/cafe/stores")
      const sD = await sR.json()
      if (sR.ok) {
        const st = (sD.stores ?? []).find((x: { id: string }) => x.id === storeId)
        if (st) setStoreName(st.store_name)
      }
    } catch { setError("네트워크 오류") }
    finally { setLoading(false) }
  }, [storeId, filter])

  useEffect(() => {
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [load])

  return (
    <div className="min-h-screen bg-[#0a0c14] text-white p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-3">
          <div>
            <Link href="/cafe/admin" className="text-xs text-cyan-400">← 카페 목록</Link>
            <h1 className="text-lg font-semibold mt-1">
              ☕ {storeName} <span className="text-[10px] text-amber-300 ml-2">super_admin 읽기전용</span>
            </h1>
          </div>
          <div className="flex gap-1 text-xs">
            {(["active","pending","preparing","delivering","delivered","cancelled"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2 py-1 rounded ${filter === f ? "bg-cyan-500/30 text-cyan-200" : "bg-white/[0.04] text-slate-400"}`}
              >{f === "active" ? "진행중" : STATUS_LABEL[f]}</button>
            ))}
          </div>
        </div>

        {error && <div className="p-2 mb-3 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-xs">{error}</div>}

        {loading && orders.length === 0 ? (
          <div className="p-10 text-center text-cyan-400 animate-pulse">불러오는 중…</div>
        ) : orders.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm">주문 없음</div>
        ) : (
          <div className="space-y-2">
            {orders.map((o) => (
              <div key={o.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                      o.status === "pending" ? "bg-amber-500/30 text-amber-200"
                        : o.status === "preparing" ? "bg-cyan-500/30 text-cyan-200"
                        : o.status === "delivering" ? "bg-blue-500/30 text-blue-200"
                        : o.status === "delivered" ? "bg-emerald-500/30 text-emerald-200"
                        : "bg-red-500/30 text-red-200"
                    }`}>{STATUS_LABEL[o.status]}</span>
                    <span className="text-xs text-slate-400">{timeAgoFrom(now, o.created_at)} 전</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span className="px-2 py-0.5 rounded-full bg-white/10">
                      {o.payment_method === "account" ? (o.paid_at ? "계좌✓" : "계좌대기") : "카드(수령시)"}
                    </span>
                    {o.delivered_at && <span className="text-emerald-300">배달완료</span>}
                  </div>
                </div>

                <div className="text-xs text-slate-300">
                  📍 {o.delivery_room_uuid
                    ? `${o.customer_store_name ?? "?"} · ${o.delivery_room_name ?? "룸"}`
                    : (o.delivery_text ?? "위치 없음")}
                  {o.customer_name && <span className="ml-2 text-slate-500">({o.customer_name})</span>}
                </div>

                <div className="space-y-0.5 text-xs">
                  {(o.items as Array<{name: string; price: number; qty: number}>).map((it, i) => (
                    <div key={i} className="flex justify-between">
                      <span>{it.name} × {it.qty}</span>
                      <span className="tabular-nums">{fmt(it.price * it.qty)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-sm font-semibold pt-1 border-t border-white/5">
                  <span>합계</span>
                  <span className="tabular-nums">{fmt(o.subtotal_amount)}</span>
                </div>
                {o.notes && <div className="text-[11px] text-amber-200 italic">📝 {o.notes}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
