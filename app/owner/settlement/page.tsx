"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { fmtMan } from "@/lib/format"

type Summary = {
  total_sessions: number
  tc_count: number
  liquor_sales: number
  waiter_tips: number
  purchases: number
  gross_total: number
  owner_margin: number
  finalized_count: number
  draft_count: number
  unsettled_count: number
}

type SessionItem = {
  session_id: string
  room_name: string | null
  session_status: string
  tc_count: number
  liquor_sales: number
  waiter_tips: number
  purchases: number
  gross_total: number | null
  owner_margin: number | null
  receipt_status: string | null
}

export default function OwnerSettlementPage() {
  const router = useRouter()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [businessDate, setBusinessDate] = useState<string | null>(null)
  const [businessDayStatus, setBusinessDayStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    try {
      const res = await apiFetch("/api/owner/settlement")

      if (res.status === 401 || res.status === 403) {
        router.push("/login")
        return
      }

      if (res.ok) {
        const data = await res.json()
        setSummary(data.summary)
        setSessions(data.sessions ?? [])
        setBusinessDate(data.business_date)
        setBusinessDayStatus(data.business_day_status)
      } else {
        setError("정산 데이터를 불러올 수 없습니다.")
      }
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  // 2026-04-24: 공용 lib/format.fmtMan 으로 교체. 동일 로직 + null/NaN 안전.
  const fmt = fmtMan

  if (loading) {
    return (
      <div className="min-h-screen bg-[#030814] flex items-center justify-center">
        <div className="text-cyan-400 text-sm">로딩 중...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#030814] text-white pb-20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.1),transparent_30%)] pointer-events-none" />
      <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:42px_42px] pointer-events-none" />

      <div className="relative z-10">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <button onClick={() => router.push("/owner")} className="text-cyan-400 text-sm">
            ← 대시보드
          </button>
          <span className="font-semibold">사장 정산 현황</span>
          <div className="w-16" />
        </div>

        {/* 영업일 정보 */}
        {businessDate && (
          <div className="px-4 pt-4">
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <span>{businessDate}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                businessDayStatus === "open"
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "bg-slate-500/20 text-slate-400"
              }`}>
                {businessDayStatus === "open" ? "영업중" : "마감"}
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* 총 요약 카드 */}
        {summary && (
          <div className="px-4 py-4 space-y-3">
            {/* 총매출 + 사장마진 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                <div className="text-xs text-slate-400">총매출</div>
                <div className="mt-1 text-2xl font-bold text-cyan-300">{fmt(summary.gross_total)}</div>
              </div>
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                <div className="text-xs text-slate-400">사장마진</div>
                <div className="mt-1 text-2xl font-bold text-emerald-300">{fmt(summary.owner_margin)}</div>
              </div>
            </div>

            {/* 세부 항목 */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <div className="text-xs text-slate-500">양주판매</div>
                <div className="mt-1 text-lg font-semibold text-white">{fmt(summary.liquor_sales)}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <div className="text-xs text-slate-500">웨이터봉사비</div>
                <div className="mt-1 text-lg font-semibold text-white">{fmt(summary.waiter_tips)}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <div className="text-xs text-slate-500">사입</div>
                <div className="mt-1 text-lg font-semibold text-white">{fmt(summary.purchases)}</div>
              </div>
            </div>

            {/* TC + 정산 상태 */}
            <div className="grid grid-cols-4 gap-3">
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3">
                <div className="text-xs text-slate-500">TC</div>
                <div className="mt-1 text-lg font-semibold text-amber-300">{summary.tc_count}건</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <div className="text-xs text-slate-500">세션</div>
                <div className="mt-1 text-lg font-semibold text-white">{summary.total_sessions}</div>
              </div>
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                <div className="text-xs text-slate-500">확정</div>
                <div className="mt-1 text-lg font-semibold text-emerald-300">{summary.finalized_count}</div>
              </div>
              <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-3">
                <div className="text-xs text-slate-500">미정산</div>
                <div className="mt-1 text-lg font-semibold text-red-300">
                  {summary.draft_count + summary.unsettled_count}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 세션별 목록 */}
        <div className="px-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-slate-300">세션별 내역</span>
            <span className="text-xs text-slate-500">{sessions.length}건</span>
          </div>

          {sessions.length === 0 && !error && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
              <p className="text-slate-500 text-sm">세션 내역이 없습니다.</p>
            </div>
          )}

          <div className="space-y-2">
            {sessions.map((s) => (
              <div
                key={s.session_id}
                className={`rounded-2xl border p-4 ${
                  s.receipt_status === "finalized"
                    ? "border-emerald-500/20 bg-emerald-500/5"
                    : "border-white/10 bg-white/[0.04]"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{s.room_name || "방"}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      s.receipt_status === "finalized"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : s.receipt_status === "draft"
                          ? "bg-amber-500/20 text-amber-300"
                          : "bg-white/10 text-slate-500"
                    }`}>
                      {s.receipt_status === "finalized" ? "확정" : s.receipt_status === "draft" ? "대기" : "미정산"}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500">TC {s.tc_count}건</span>
                </div>

                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div>
                    <span className="block text-slate-500">양주</span>
                    <span className="text-white">{fmt(s.liquor_sales)}</span>
                  </div>
                  <div>
                    <span className="block text-slate-500">봉사비</span>
                    <span className="text-white">{fmt(s.waiter_tips)}</span>
                  </div>
                  <div>
                    <span className="block text-slate-500">총매출</span>
                    <span className="text-cyan-300 font-medium">{fmt(s.gross_total)}</span>
                  </div>
                  <div>
                    <span className="block text-slate-500">마진</span>
                    <span className="text-emerald-300 font-medium">{fmt(s.owner_margin)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
