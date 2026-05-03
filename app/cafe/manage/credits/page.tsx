"use client"

/**
 * /cafe/manage/credits — 카페 외상 관리 (배달 후 미결제 추적 + 회수).
 */

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { apiFetch } from "@/lib/apiFetch"

type CreditRow = {
  id: string
  order_id: string
  amount: number
  customer_name: string | null
  customer_phone: string | null
  memo: string | null
  credited_at: string
  paid_at: string | null
  paid_method: string | null
  paid_notes: string | null
  order: {
    items: Array<{ name: string; qty: number; price: number; unit_price?: number }>
    delivery_room_uuid: string | null
    delivery_text: string | null
    customer_store_uuid: string
    created_at: string
  } | null
}

function fmt(n: number) { return "₩" + n.toLocaleString() }
function dt(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}`
}

export default function CafeCreditsPage() {
  const [credits, setCredits] = useState<CreditRow[]>([])
  const [unpaidOnly, setUnpaidOnly] = useState(true)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [payFor, setPayFor] = useState<string | null>(null)
  const [payMethod, setPayMethod] = useState<"cash"|"card"|"account"|"other">("cash")
  const [payNotes, setPayNotes] = useState("")

  const load = useCallback(async () => {
    setLoading(true); setError("")
    try {
      const r = await apiFetch(`/api/cafe/credits${unpaidOnly ? "?unpaid_only=1" : ""}`)
      const d = await r.json()
      if (!r.ok) { setError(d.message || "로드 실패"); return }
      setCredits(d.credits ?? [])
    } finally { setLoading(false) }
  }, [unpaidOnly])
  useEffect(() => { load() }, [load])

  async function pay(id: string) {
    await apiFetch(`/api/cafe/credits/${id}/pay`, {
      method: "POST",
      body: JSON.stringify({ paid_method: payMethod, paid_notes: payNotes || null }),
    })
    setPayFor(null); setPayNotes(""); setPayMethod("cash")
    await load()
  }

  const unpaid = credits.filter((c) => !c.paid_at)
  const totalUnpaid = unpaid.reduce((s, c) => s + c.amount, 0)

  return (
    <div className="p-4">
      <div className="max-w-3xl mx-auto space-y-3">
        <div>
          <Link href="/cafe/manage" className="text-xs text-cyan-400">← 홈</Link>
          <h1 className="text-lg font-semibold mt-1">📒 외상 관리</h1>
        </div>

        {error && <div className="p-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-xs">{error}</div>}

        {/* 미결제 합계 */}
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400">미결제 외상</div>
            <div className="text-xl font-bold text-amber-200 tabular-nums">{fmt(totalUnpaid)}</div>
          </div>
          <div className="text-sm text-amber-300">{unpaid.length} 건</div>
        </div>

        <div className="flex gap-2 text-xs">
          <button onClick={() => setUnpaidOnly(true)}
            className={`px-3 py-1.5 rounded ${unpaidOnly ? "bg-amber-500/30 text-amber-200" : "bg-white/[0.04] text-slate-400"}`}>
            미결제만
          </button>
          <button onClick={() => setUnpaidOnly(false)}
            className={`px-3 py-1.5 rounded ${!unpaidOnly ? "bg-cyan-500/30 text-cyan-200" : "bg-white/[0.04] text-slate-400"}`}>
            전체 (결제 완료 포함)
          </button>
        </div>

        {loading ? (
          <div className="p-10 text-center text-cyan-400 animate-pulse">불러오는 중…</div>
        ) : credits.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm">
            {unpaidOnly ? "미결제 외상 없음 ✓" : "외상 이력 없음"}
          </div>
        ) : (
          <div className="space-y-2">
            {credits.map((c) => (
              <div key={c.id} className={`rounded-xl border p-3 space-y-2 ${
                c.paid_at ? "border-emerald-500/20 bg-emerald-500/[0.04]" : "border-amber-500/30 bg-amber-500/[0.04]"
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                      c.paid_at ? "bg-emerald-500/30 text-emerald-200" : "bg-amber-500/30 text-amber-200"
                    }`}>
                      {c.paid_at ? `✓ 회수완료 (${c.paid_method})` : "미결제"}
                    </span>
                    <span className="text-[11px] text-slate-400">외상 {dt(c.credited_at)}</span>
                  </div>
                  <span className="text-base font-bold tabular-nums">{fmt(c.amount)}</span>
                </div>

                {/* 고객 */}
                <div className="text-xs text-slate-300">
                  {c.customer_name && <span className="font-semibold">{c.customer_name}</span>}
                  {c.customer_phone && <span className="ml-2 text-slate-400">📞 {c.customer_phone}</span>}
                  {!c.customer_name && !c.customer_phone && <span className="text-slate-500">고객 정보 없음</span>}
                </div>

                {/* 배달 위치 */}
                {c.order && (
                  <div className="text-xs text-slate-400">
                    📍 {c.order.delivery_room_uuid ? "룸 배달" : (c.order.delivery_text ?? "위치 X")}
                  </div>
                )}

                {/* 메뉴 list */}
                {c.order?.items && (
                  <div className="text-xs space-y-0.5 bg-black/30 rounded p-2">
                    {c.order.items.map((it, i) => (
                      <div key={i} className="flex justify-between">
                        <span>{it.name} × {it.qty}</span>
                        <span className="tabular-nums text-slate-400">{fmt((it.unit_price ?? it.price) * it.qty)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {c.memo && <div className="text-[11px] italic text-amber-200">📝 {c.memo}</div>}

                {!c.paid_at && (
                  <div className="pt-1">
                    {payFor === c.id ? (
                      <div className="flex gap-1.5 flex-wrap items-center">
                        <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as "cash"|"card"|"account"|"other")}
                          className="rounded bg-[#030814] border border-white/10 px-2 py-1 text-xs">
                          <option value="cash">현금</option>
                          <option value="card">카드</option>
                          <option value="account">계좌이체</option>
                          <option value="other">기타</option>
                        </select>
                        <input value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="메모"
                          className="flex-1 rounded bg-[#030814] border border-white/10 px-2 py-1 text-xs" />
                        <button onClick={() => pay(c.id)}
                          className="text-xs px-3 py-1 rounded bg-emerald-500/30 text-emerald-200 font-semibold">회수</button>
                        <button onClick={() => setPayFor(null)} className="text-xs text-slate-400 px-2">취소</button>
                      </div>
                    ) : (
                      <button onClick={() => setPayFor(c.id)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-xs font-semibold">
                        💰 회수 처리
                      </button>
                    )}
                  </div>
                )}

                {c.paid_at && (
                  <div className="text-[11px] text-emerald-300 pt-1 border-t border-white/5">
                    회수일: {dt(c.paid_at)}
                    {c.paid_notes && <span className="ml-2 text-slate-400">— {c.paid_notes}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
