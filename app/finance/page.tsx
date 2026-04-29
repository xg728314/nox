"use client"

/**
 * /finance — 사장 재무 허브.
 *
 * 화면 구성:
 *   1. 월 P&L 카드 (수익 / 변동비 / 고정비 / 순이익)
 *   2. 손익분기점 (BEP) 카드
 *      - 남은 매출 / 양주 잔여 판매량 / 일별 목표 / 추세
 *   3. 빠른 진입: 매입 / 지출 / 매장 정산 / 정산 이력 / 지급 관리
 *
 * 데이터: GET /api/finance/pnl?year_month=YYYY-MM
 *
 * 권한: owner only — middleware + API 양쪽 가드.
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { fmtMan, fmtWon, fmtNumber } from "@/lib/format"

type Pnl = {
  store_uuid: string
  year_month: string
  month_start: string
  month_end: string
  revenue: { total: number; by_source: { receipts: number } }
  cost: {
    total: number
    variable: { total: number; purchases: number; expenses: number }
    fixed: { total: number; rent: number; utilities: number; misc: number }
  }
  net_profit: number
  break_even_analysis: {
    break_even_revenue: number
    remaining_to_break_even: number
    avg_margin_per_bottle: number
    remaining_bottles: number
    days_left: number
    daily_target_won: number
    daily_target_bottles: number
    trend: "ahead" | "on_track" | "behind"
  }
}

function currentYearMonthKst(): string {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 3600 * 1000)
  return kst.toISOString().slice(0, 7)
}

const TREND_LABEL: Record<Pnl["break_even_analysis"]["trend"], { text: string; color: string }> = {
  ahead: { text: "초과 달성 중", color: "text-emerald-300 bg-emerald-500/15 border-emerald-500/40" },
  on_track: { text: "목표대로 진행", color: "text-cyan-300 bg-cyan-500/15 border-cyan-500/40" },
  behind: { text: "목표 미달", color: "text-amber-300 bg-amber-500/15 border-amber-500/40" },
}

export default function FinanceHubPage() {
  const router = useRouter()
  const [yearMonth, setYearMonth] = useState(currentYearMonthKst())
  const [pnl, setPnl] = useState<Pnl | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    fetchPnl(yearMonth)
  }, [yearMonth])

  async function fetchPnl(ym: string) {
    setLoading(true)
    setError("")
    try {
      const res = await apiFetch(`/api/finance/pnl?year_month=${encodeURIComponent(ym)}`)
      if (res.status === 401 || res.status === 403) {
        router.push("/login")
        return
      }
      if (!res.ok) {
        setError("재무 데이터를 불러올 수 없습니다.")
        return
      }
      const data = (await res.json()) as Pnl
      setPnl(data)
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#030814] text-slate-200">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-cyan-300">재무</h1>
            <p className="text-xs text-slate-500 mt-1">월 P&amp;L · 손익분기점 · 매입/지출 등록</p>
          </div>
          <input
            type="month"
            value={yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm"
          />
        </header>

        {loading && (
          <div className="text-center text-cyan-400 text-sm py-12">로딩 중...</div>
        )}
        {error && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-300 text-sm">
            {error}
          </div>
        )}

        {pnl && !loading && (
          <>
            {/* 1. P&L 요약 */}
            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <h2 className="text-sm text-slate-400 mb-4">월 손익 ({pnl.month_start} ~ {pnl.month_end})</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <PnlTile label="수익" value={pnl.revenue.total} accent="text-emerald-300" />
                <PnlTile label="변동비" value={-pnl.cost.variable.total} accent="text-amber-300" />
                <PnlTile label="고정비" value={-pnl.cost.fixed.total} accent="text-orange-300" />
                <PnlTile
                  label="순이익"
                  value={pnl.net_profit}
                  accent={pnl.net_profit >= 0 ? "text-cyan-300" : "text-red-300"}
                  big
                />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-5 text-xs">
                <DetailRow label="영수증" value={pnl.revenue.by_source.receipts} />
                <DetailRow label="매입(박스)" value={pnl.cost.variable.purchases} />
                <DetailRow label="일반 지출" value={pnl.cost.variable.expenses} />
                <DetailRow label="월세" value={pnl.cost.fixed.rent} />
                <DetailRow label="공과금" value={pnl.cost.fixed.utilities} />
                <DetailRow label="잡비" value={pnl.cost.fixed.misc} />
              </div>
            </section>

            {/* 2. BEP 카드 */}
            <section className="rounded-2xl border border-cyan-500/30 bg-cyan-500/[0.04] p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm text-cyan-300">손익분기점 (BEP)</h2>
                <span
                  className={`text-xs px-2 py-1 rounded-full border ${TREND_LABEL[pnl.break_even_analysis.trend].color}`}
                >
                  {TREND_LABEL[pnl.break_even_analysis.trend].text}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <BepTile
                  label="BEP 매출"
                  value={fmtMan(pnl.break_even_analysis.break_even_revenue)}
                />
                <BepTile
                  label="남은 매출"
                  value={fmtMan(pnl.break_even_analysis.remaining_to_break_even)}
                  accent="text-amber-300"
                />
                <BepTile
                  label="양주 잔여"
                  value={`${fmtNumber(pnl.break_even_analysis.remaining_bottles)} 병`}
                  accent="text-emerald-300"
                />
                <BepTile
                  label="남은 영업일"
                  value={`${pnl.break_even_analysis.days_left} 일`}
                />
              </div>
              <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
                <DetailRow
                  label="평균 양주 마진"
                  value={pnl.break_even_analysis.avg_margin_per_bottle}
                  hint="(store_price − unit_price) × qty / 30일"
                />
                <DetailRow
                  label="일별 목표 매출"
                  value={pnl.break_even_analysis.daily_target_won}
                  hint={`= ${fmtNumber(pnl.break_even_analysis.daily_target_bottles)} 병/일`}
                />
              </div>
            </section>

            {/* 3. 빠른 진입 */}
            <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <NavTile icon="📦" label="매입 등록" path="/finance/purchases" router={router} />
              <NavTile icon="💸" label="지출 등록" path="/finance/expenses" router={router} />
              <NavTile icon="📊" label="매장 정산 (오늘)" path="/owner/settlement" router={router} />
              <NavTile icon="📒" label="정산 이력" path="/settlement/history" router={router} />
              <NavTile icon="💰" label="지급 관리" path="/payouts" router={router} />
              <NavTile icon="⚙️" label="고정비 설정" path="/store/settings" router={router} />
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function PnlTile({
  label, value, accent, big,
}: { label: string; value: number; accent: string; big?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-4">
      <div className="text-[11px] text-slate-500 mb-1">{label}</div>
      <div className={`${big ? "text-2xl" : "text-lg"} font-semibold tabular-nums ${accent}`}>
        {fmtMan(value)}
      </div>
    </div>
  )
}

function BepTile({
  label, value, accent,
}: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-cyan-500/20 bg-black/30 p-4">
      <div className="text-[11px] text-slate-500 mb-1">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${accent ?? "text-slate-200"}`}>{value}</div>
    </div>
  )
}

function DetailRow({
  label, value, hint,
}: { label: string; value: number; hint?: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/5 bg-black/20 px-3 py-2">
      <div>
        <div className="text-slate-400">{label}</div>
        {hint && <div className="text-[10px] text-slate-600">{hint}</div>}
      </div>
      <div className="text-slate-200 tabular-nums">{fmtWon(value)}</div>
    </div>
  )
}

function NavTile({
  icon, label, path, router,
}: { icon: string; label: string; path: string; router: ReturnType<typeof useRouter> }) {
  return (
    <button
      onClick={() => router.push(path)}
      className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left hover:bg-white/[0.08]"
    >
      <div className="text-xl mb-2">{icon}</div>
      <div className="text-sm font-medium text-slate-200">{label}</div>
    </button>
  )
}
