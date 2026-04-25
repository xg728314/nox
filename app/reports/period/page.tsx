"use client"

/**
 * 기간 매출 리포트 (월/주/임의 기간).
 *
 * 2026-04-25: 일일 리포트만으로는 세무사 제출 / 월간 분석 불가 → 신설.
 *   owner 전용 (middleware 가드 /reports/*).
 *
 * 기능:
 *   - 프리셋 버튼: 이번 달 / 지난 달 / 최근 7일 / 최근 30일
 *   - 임의 from/to 날짜 선택
 *   - 총계 카드 + 일자별 bar + Top 실장/스태프
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { fmtMan, fmtNumber } from "@/lib/format"

type DailyRow = {
  business_date: string
  session_count: number
  gross_total: number
  order_total: number
  participant_total: number
  manager_total?: number
  hostess_total?: number
}

type StaffRow = {
  membership_id: string
  name: string
  sessions: number
  total_price: number
  total_payout?: number
}

type PeriodReport = {
  from: string
  to: string
  day_count: number
  totals: {
    session_count: number
    gross_total: number
    order_total: number
    participant_total: number
    tc_total: number
    margin_total: number
    manager_total?: number
    hostess_total?: number
  }
  daily: DailyRow[]
  top_managers: StaffRow[]
  top_hostesses: StaffRow[]
}

function todayStr() {
  const d = new Date()
  return d.toISOString().split("T")[0]
}
function daysAgoStr(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split("T")[0]
}
function monthStartStr(offset = 0) {
  const d = new Date()
  d.setMonth(d.getMonth() + offset)
  d.setDate(1)
  return d.toISOString().split("T")[0]
}
function monthEndStr(offset = 0) {
  const d = new Date()
  d.setMonth(d.getMonth() + offset + 1)
  d.setDate(0)
  return d.toISOString().split("T")[0]
}

export default function PeriodReportPage() {
  const router = useRouter()
  const [from, setFrom] = useState(monthStartStr())
  const [to, setTo] = useState(todayStr())
  const [report, setReport] = useState<PeriodReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  async function fetchReport(f: string, t: string) {
    setLoading(true)
    setError("")
    try {
      const res = await apiFetch(`/api/reports/period?from=${f}&to=${t}`)
      if (res.status === 401 || res.status === 403) {
        router.push("/login")
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.message || "리포트 조회 실패")
        return
      }
      setReport(await res.json())
    } catch (e) {
      console.error("[reports/period] fetch error", e)
      setError("네트워크 오류. 다시 시도해주세요.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchReport(from, to)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function applyPreset(f: string, t: string) {
    setFrom(f)
    setTo(t)
    fetchReport(f, t)
  }

  const maxGross = Math.max(1, ...(report?.daily ?? []).map(d => d.gross_total))

  return (
    <div className="min-h-screen bg-[#030814] text-white pb-20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.1),transparent_30%)] pointer-events-none" />
      <div className="relative z-10">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <button
            onClick={() => router.push("/reports")}
            className="text-cyan-400 text-sm"
          >← 일일 리포트</button>
          <span className="font-semibold">기간 매출</span>
          <div className="w-20" />
        </div>

        {/* 프리셋 */}
        <div className="px-4 py-3 flex flex-wrap gap-2 border-b border-white/10">
          {[
            { label: "이번 달", from: monthStartStr(), to: todayStr() },
            { label: "지난 달", from: monthStartStr(-1), to: monthEndStr(-1) },
            { label: "최근 7일", from: daysAgoStr(6), to: todayStr() },
            { label: "최근 30일", from: daysAgoStr(29), to: todayStr() },
          ].map(p => (
            <button
              key={p.label}
              onClick={() => applyPreset(p.from, p.to)}
              className="px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/10 text-xs text-slate-300 hover:bg-white/[0.08]"
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* 날짜 입력 */}
        <div className="px-4 py-3 flex items-center gap-2 text-sm border-b border-white/10">
          <input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            className="bg-white/[0.03] border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs"
          />
          <span className="text-slate-500">~</span>
          <input
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            className="bg-white/[0.03] border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs"
          />
          <button
            onClick={() => fetchReport(from, to)}
            disabled={loading}
            className="ml-auto px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-200 text-xs font-semibold disabled:opacity-50"
          >
            {loading ? "조회 중..." : "조회"}
          </button>
        </div>

        {error && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {report && !loading && (
          <div className="px-4 py-4 space-y-4">
            {/* 총계 카드 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { label: "영업일", value: fmtNumber(report.day_count) + "일", cls: "text-slate-200" },
                { label: "세션", value: fmtNumber(report.totals.session_count) + "건", cls: "text-slate-200" },
                { label: "총 매출", value: fmtMan(report.totals.gross_total), cls: "text-emerald-300" },
                { label: "타임 매출", value: fmtMan(report.totals.participant_total), cls: "text-cyan-300" },
                { label: "주문 매출", value: fmtMan(report.totals.order_total), cls: "text-amber-300" },
                { label: "사장 마진", value: fmtMan(report.totals.margin_total), cls: "text-purple-300" },
                report.totals.manager_total !== undefined
                  ? { label: "실장 수익", value: fmtMan(report.totals.manager_total ?? 0), cls: "text-pink-300" }
                  : null,
                report.totals.hostess_total !== undefined
                  ? { label: "스태프 지급", value: fmtMan(report.totals.hostess_total ?? 0), cls: "text-rose-300" }
                  : null,
              ].filter((x): x is NonNullable<typeof x> => !!x).map(card => (
                <div key={card.label} className="rounded-xl bg-white/[0.04] border border-white/[0.06] px-3 py-2">
                  <div className="text-[10px] text-slate-500">{card.label}</div>
                  <div className={`text-base font-bold mt-0.5 ${card.cls}`}>{card.value}</div>
                </div>
              ))}
            </div>

            {/* 일자별 bar */}
            {report.daily.length > 0 && (
              <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3">
                <div className="text-xs text-slate-400 mb-3">일자별 매출</div>
                <div className="space-y-1.5">
                  {report.daily.map(d => (
                    <div key={d.business_date} className="flex items-center gap-2 text-[11px]">
                      <span className="w-20 text-slate-400 tabular-nums">{d.business_date.slice(5)}</span>
                      <div className="flex-1 h-5 bg-white/[0.03] rounded overflow-hidden relative">
                        <div
                          className="h-full bg-emerald-500/40"
                          style={{ width: `${(d.gross_total / maxGross) * 100}%` }}
                        />
                        <span className="absolute left-2 top-0 h-full flex items-center text-[10px] text-slate-300">
                          {d.session_count > 0 && `${d.session_count}건`}
                        </span>
                      </div>
                      <span className="w-24 text-right text-slate-200 tabular-nums">{fmtMan(d.gross_total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top 실장 */}
            {report.top_managers.length > 0 && (
              <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3">
                <div className="text-xs text-slate-400 mb-2">Top 실장</div>
                <div className="space-y-1">
                  {report.top_managers.map((m, i) => (
                    <div key={m.membership_id} className="flex items-center justify-between text-xs py-1 border-b border-white/[0.04] last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 w-5">{i + 1}.</span>
                        <span className="text-slate-200">{m.name || "-"}</span>
                      </div>
                      <div className="flex items-center gap-3 text-slate-400">
                        <span>{m.sessions}건</span>
                        <span className="text-cyan-300">{fmtMan(m.total_price)}</span>
                        {m.total_payout !== undefined && <span className="text-pink-300">{fmtMan(m.total_payout)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top 스태프 */}
            {report.top_hostesses.length > 0 && (
              <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3">
                <div className="text-xs text-slate-400 mb-2">Top 스태프</div>
                <div className="space-y-1">
                  {report.top_hostesses.map((h, i) => (
                    <div key={h.membership_id} className="flex items-center justify-between text-xs py-1 border-b border-white/[0.04] last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 w-5">{i + 1}.</span>
                        <span className="text-slate-200">{h.name || "-"}</span>
                      </div>
                      <div className="flex items-center gap-3 text-slate-400">
                        <span>{h.sessions}건</span>
                        <span className="text-cyan-300">{fmtMan(h.total_price)}</span>
                        {h.total_payout !== undefined && <span className="text-rose-300">{fmtMan(h.total_payout)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {report.daily.length === 0 && (
              <div className="rounded-xl bg-white/[0.03] border border-white/10 p-6 text-center text-slate-500 text-sm">
                이 기간에 데이터가 없습니다.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
