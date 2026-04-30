"use client"

/**
 * /manager/ledger — 실장 전용 수익 장부.
 *
 * 표시:
 *   - 월 합계 (manager_payout_amount 합)
 *   - 일별 (날짜 / 세션수 / TC건수 / 수익)
 *   - 종목별 (퍼블릭/셔츠/하퍼/...)
 *
 * 사장은 못 봄 (R28 visibility 정책).
 *   API: GET /api/manager/ledger?year_month=YYYY-MM (manager only)
 *
 * 권한: middleware MANAGER_ONLY_PREFIXES (/manager).
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { fmtMan, fmtWon, fmtNumber } from "@/lib/format"

type Day = { business_date: string; sessions: number; tc_count: number; total_won: number }
type ByCategory = { category: string; sessions: number; tc_count: number; total_won: number }
type PaperRow = {
  business_date: string
  hostess_name: string
  tc_count: number
  owe_won: number
  source_snapshot_id: string
}
type PaperHostess = {
  hostess_name: string
  tc_count: number
  owe_won: number
  days: number
}
type PaperLedger = {
  total_tc: number
  total_owe_won: number
  rows: PaperRow[]
  by_hostess: PaperHostess[]
}

type Ledger = {
  manager_membership_id: string
  year_month: string
  month_start: string
  month_end: string
  monthly_total: number
  sessions_count: number
  days: Day[]
  by_category: ByCategory[]
  paper_ledger?: PaperLedger
}

function currentYearMonthKst(): string {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 3600 * 1000)
  return kst.toISOString().slice(0, 7)
}

const CATEGORY_LABEL: Record<string, string> = {
  public: "퍼블릭",
  shirt: "셔츠",
  shirts: "셔츠",
  harper: "하퍼",
  unknown: "미분류",
}

export default function ManagerLedgerPage() {
  const router = useRouter()
  const [yearMonth, setYearMonth] = useState(currentYearMonthKst())
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    fetchLedger(yearMonth)
  }, [yearMonth])

  async function fetchLedger(ym: string) {
    setLoading(true)
    setError("")
    try {
      const res = await apiFetch(`/api/manager/ledger?year_month=${encodeURIComponent(ym)}`)
      if (res.status === 401 || res.status === 403) {
        router.push("/login")
        return
      }
      if (!res.ok) {
        setError("내 수익 장부를 불러올 수 없습니다.")
        return
      }
      const data = (await res.json()) as Ledger
      setLedger(data)
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#030814] text-slate-200 pb-24">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-cyan-300">내 수익 장부</h1>
            <p className="text-xs text-slate-500 mt-1">
              본인 attribution 만 표시. 사장에게는 노출되지 않습니다.
            </p>
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

        {ledger && !loading && (
          <>
            {/* 월 합계 */}
            <section className="rounded-2xl border border-cyan-500/30 bg-cyan-500/[0.04] p-5">
              <div className="text-xs text-cyan-400 mb-2">
                {ledger.month_start} ~ {ledger.month_end}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">월 수익</div>
                  <div className="text-3xl font-semibold text-cyan-300 tabular-nums">
                    {fmtMan(ledger.monthly_total)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500 mb-1">참여 TC</div>
                  <div className="text-3xl font-semibold text-emerald-300 tabular-nums">
                    {fmtNumber(ledger.sessions_count)} 건
                  </div>
                </div>
              </div>
            </section>

            {/* 종목별 */}
            <section className="rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden">
              <div className="px-5 py-3 border-b border-white/5">
                <div className="text-sm text-slate-400">종목별 합계</div>
              </div>
              {ledger.by_category.length === 0 ? (
                <div className="text-center text-slate-500 text-sm py-6">데이터 없음</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] text-slate-500 border-b border-white/5">
                      <th className="px-4 py-2 text-left">종목</th>
                      <th className="px-4 py-2 text-right">세션</th>
                      <th className="px-4 py-2 text-right">TC</th>
                      <th className="px-4 py-2 text-right">수익</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.by_category.map((c) => (
                      <tr key={c.category} className="border-b border-white/5">
                        <td className="px-4 py-2">{CATEGORY_LABEL[c.category] ?? c.category}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{c.sessions}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{c.tc_count}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-cyan-300">
                          {fmtWon(c.total_won)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* 일별 */}
            <section className="rounded-2xl border border-white/10 bg-white/[0.04] overflow-hidden">
              <div className="px-5 py-3 border-b border-white/5">
                <div className="text-sm text-slate-400">일별 내역</div>
              </div>
              {ledger.days.length === 0 ? (
                <div className="text-center text-slate-500 text-sm py-6">데이터 없음</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] text-slate-500 border-b border-white/5">
                      <th className="px-4 py-2 text-left">영업일</th>
                      <th className="px-4 py-2 text-right">세션</th>
                      <th className="px-4 py-2 text-right">TC</th>
                      <th className="px-4 py-2 text-right">수익</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.days.map((d) => (
                      <tr key={d.business_date} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="px-4 py-2 text-slate-400">{d.business_date}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{d.sessions}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{d.tc_count}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-cyan-300">
                          {fmtWon(d.total_won)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* 2026-04-30 (R-paper-to-manager): 종이장부 기반 추가 수익 */}
            {ledger.paper_ledger && (ledger.paper_ledger.rows.length > 0) && (
              <section className="rounded-2xl border border-fuchsia-500/30 bg-fuchsia-500/[0.04] overflow-hidden">
                <div className="px-5 py-3 border-b border-fuchsia-500/20 flex items-center justify-between">
                  <div>
                    <div className="text-sm text-fuchsia-200">📑 종이장부 기반 (담당 매핑 후 합산)</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      운영자가 스태프 장부에서 본인을 담당실장으로 매핑한 결과. DB 세션과 별도 표시.
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-slate-500">월 TC / 줄돈 합</div>
                    <div className="text-sm font-semibold text-fuchsia-300 tabular-nums">
                      {fmtNumber(ledger.paper_ledger.total_tc)} 건 / {fmtWon(ledger.paper_ledger.total_owe_won)}
                    </div>
                  </div>
                </div>

                {/* 스태프별 합계 */}
                {ledger.paper_ledger.by_hostess.length > 0 && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] text-slate-500 border-b border-white/5">
                        <th className="px-4 py-2 text-left">스태프</th>
                        <th className="px-4 py-2 text-right">근무일</th>
                        <th className="px-4 py-2 text-right">TC</th>
                        <th className="px-4 py-2 text-right">줄돈</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.paper_ledger.by_hostess.map((h) => (
                        <tr key={h.hostess_name} className="border-b border-white/5">
                          <td className="px-4 py-2 text-fuchsia-200">{h.hostess_name}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{h.days} 일</td>
                          <td className="px-4 py-2 text-right tabular-nums">{h.tc_count}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-amber-300">
                            {fmtWon(h.owe_won)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
