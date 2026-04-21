"use client"

import type { MyDailyRow, MySalesTotals } from "../hooks/useMySalesSummary"

/**
 * MySalesSummaryCard — renders the self-scope sales summary.
 * Pure UI.
 */

type Props = {
  dailySummary: MyDailyRow[]
  totals: MySalesTotals
  loading: boolean
  error: string
}

function fmtWon(v: number): string {
  return (v || 0).toLocaleString() + "원"
}

export default function MySalesSummaryCard({ dailySummary, totals, loading, error }: Props) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-white">내 매출 요약</div>
        <span className="text-[10px] text-slate-500">최근 영업일 기준</span>
      </div>

      {error && (
        <div className="mb-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[11px]">{error}</div>
      )}

      {loading && (
        <div className="py-4 text-center text-slate-500 text-xs animate-pulse">불러오는 중...</div>
      )}

      {!loading && !error && (
        <>
          {/* Totals grid */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              <div className="text-[10px] text-slate-500">총 금액</div>
              <div className="text-sm font-bold text-emerald-300 mt-0.5">{fmtWon(totals.total_payout)}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              <div className="text-[10px] text-slate-500">건수</div>
              <div className="text-sm font-bold text-cyan-300 mt-0.5">{totals.count}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              <div className="text-[10px] text-slate-500">영업일</div>
              <div className="text-sm font-bold text-white mt-0.5">{totals.days}</div>
            </div>
          </div>

          {/* Daily rows */}
          {dailySummary.length === 0 ? (
            <div className="py-4 text-center text-slate-500 text-xs">표시할 매출이 없습니다.</div>
          ) : (
            <div className="space-y-1">
              {dailySummary.map(d => (
                <div key={d.date} className="flex items-center justify-between text-[11px] py-1 border-b border-white/5 last:border-0">
                  <span className="text-slate-400">{d.date}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-500">{d.count}건</span>
                    {d.finalized > 0 && (
                      <span className="text-[9px] text-emerald-300">확정 {d.finalized}</span>
                    )}
                    <span className="text-white font-medium w-20 text-right">{fmtWon(d.total_payout)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
