"use client"

/**
 * /cafe/manage/finance — 카페 재무 (매출/결제수단/메뉴 top).
 *   기본 30일. 일별 차트는 단순 bar.
 */

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { apiFetch } from "@/lib/apiFetch"

type Finance = {
  days: number
  totals: { orders: number; delivered: number; cancelled: number; gross: number; unpaid_account: number }
  by_method: Record<string, { count: number; gross: number; paid: number }>
  daily: Array<{ date: string; count: number; gross: number; delivered: number }>
  top_menu: Array<{ name: string; qty: number; gross: number }>
}

function fmt(n: number) { return "₩" + n.toLocaleString() }

export default function CafeFinancePage() {
  const [data, setData] = useState<Finance | null>(null)
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true); setError("")
    try {
      const r = await apiFetch(`/api/cafe/finance?days=${days}`)
      const d = await r.json()
      if (!r.ok) { setError(d.message || "로드 실패"); return }
      setData(d as Finance)
    } catch { setError("네트워크 오류") }
    finally { setLoading(false) }
  }, [days])

  useEffect(() => { load() }, [load])

  const maxDailyGross = data ? Math.max(1, ...data.daily.map((d) => d.gross)) : 1

  return (
    <div className="min-h-screen bg-[#0a0c14] text-white p-4">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/cafe/manage" className="text-xs text-cyan-400">← 홈</Link>
            <h1 className="text-lg font-semibold mt-1">💰 재무</h1>
          </div>
          <div className="flex gap-1 text-xs">
            {[7, 30, 90].map((d) => (
              <button key={d}
                onClick={() => setDays(d)}
                className={`px-2.5 py-1 rounded ${days === d ? "bg-cyan-500/30 text-cyan-200" : "bg-white/[0.04] text-slate-400"}`}>
                {d}일
              </button>
            ))}
          </div>
        </div>

        {error && <div className="p-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-xs">{error}</div>}

        {loading ? (
          <div className="p-10 text-center text-cyan-400 animate-pulse">불러오는 중…</div>
        ) : !data ? null : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Card label="총 매출 (배달완료)" v={fmt(data.totals.gross)} accent="emerald" />
              <Card label="배달 완료" v={`${data.totals.delivered}건`} accent="cyan" />
              <Card label="취소" v={`${data.totals.cancelled}건`} accent="slate" />
              <Card label="입금 미확인" v={fmt(data.totals.unpaid_account)} accent="amber" />
            </div>

            {/* 결제 수단 */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-2">
              <div className="text-sm font-semibold mb-2">결제 수단별</div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg bg-cyan-500/5 border border-cyan-500/15 p-3">
                  <div className="text-cyan-300 font-semibold mb-1">계좌 입금</div>
                  <div>주문 {data.by_method.account?.count ?? 0}건</div>
                  <div>매출 {fmt(data.by_method.account?.gross ?? 0)}</div>
                  <div className="text-emerald-300">입금 확인 {fmt(data.by_method.account?.paid ?? 0)}</div>
                </div>
                <div className="rounded-lg bg-purple-500/5 border border-purple-500/15 p-3">
                  <div className="text-purple-300 font-semibold mb-1">카드 (수령시)</div>
                  <div>주문 {data.by_method.card_on_delivery?.count ?? 0}건</div>
                  <div>매출 {fmt(data.by_method.card_on_delivery?.gross ?? 0)}</div>
                </div>
              </div>
            </div>

            {/* 일별 매출 */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-2">
              <div className="text-sm font-semibold mb-2">일별 매출</div>
              {data.daily.length === 0 ? (
                <div className="text-center py-6 text-slate-500 text-sm">데이터 없음</div>
              ) : (
                <div className="space-y-1">
                  {data.daily.map((d) => (
                    <div key={d.date} className="flex items-center gap-2 text-xs">
                      <span className="w-20 text-slate-400 tabular-nums">{d.date.slice(5)}</span>
                      <div className="flex-1 bg-white/[0.04] rounded h-5 overflow-hidden relative">
                        <div className="bg-emerald-500/30 h-full" style={{ width: `${(d.gross / maxDailyGross) * 100}%` }} />
                      </div>
                      <span className="w-24 text-right text-emerald-300 tabular-nums">{fmt(d.gross)}</span>
                      <span className="w-12 text-right text-slate-500 tabular-nums">{d.delivered}건</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 메뉴 top */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-2">
              <div className="text-sm font-semibold mb-2">베스트 메뉴 TOP {data.top_menu.length}</div>
              {data.top_menu.length === 0 ? (
                <div className="text-center py-6 text-slate-500 text-sm">데이터 없음</div>
              ) : (
                <div className="space-y-1">
                  {data.top_menu.map((m, i) => (
                    <div key={i} className="flex justify-between items-center text-xs py-1.5 border-t border-white/5">
                      <span className="flex items-center gap-2">
                        <span className="w-5 text-slate-500">{i + 1}</span>
                        <span>{m.name}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="text-slate-400 tabular-nums">{m.qty}개</span>
                        <span className="text-emerald-300 tabular-nums">{fmt(m.gross)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Card({ label, v, accent }: { label: string; v: string; accent: "emerald"|"cyan"|"slate"|"amber" }) {
  const cls =
    accent === "emerald" ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300"
    : accent === "cyan" ? "border-cyan-500/20 bg-cyan-500/5 text-cyan-300"
    : accent === "amber" ? "border-amber-500/20 bg-amber-500/5 text-amber-300"
    : "border-white/10 bg-white/[0.04] text-slate-300"
  return (
    <div className={`rounded-xl border ${cls} p-3`}>
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="text-lg font-bold mt-0.5 tabular-nums">{v}</div>
    </div>
  )
}
