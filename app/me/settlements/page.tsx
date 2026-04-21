"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type Settlement = {
  participant_id: string
  session_id: string
  category: string
  time_minutes: number
  hostess_payout: number
  status: string
  entered_at: string
  room_name: string | null
  business_date: string | null
  session_status: string | null
  receipt_status: string | null
}

type DailySummary = {
  date: string
  total_payout: number
  count: number
  finalized: number
}

export default function MySettlementsPage() {
  const router = useRouter()
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [dailySummary, setDailySummary] = useState<DailySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    try {
      const res = await apiFetch("/api/me/settlements")

      if (res.status === 401 || res.status === 403) {
        router.push("/login")
        return
      }

      if (res.ok) {
        const data = await res.json()
        setSettlements(data.settlements ?? [])
        setDailySummary(data.daily_summary ?? [])
      } else {
        setError("정산 내역을 불러올 수 없습니다.")
      }
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  function fmt(amount: number): string {
    if (amount >= 10000) {
      const man = Math.floor(amount / 10000)
      const remainder = amount % 10000
      if (remainder === 0) return `${man}만원`
      return `${man}만${remainder.toLocaleString()}원`
    }
    return amount.toLocaleString() + "원"
  }

  // 일별로 그룹핑
  const grouped = settlements.reduce<Record<string, Settlement[]>>((acc, s) => {
    const date = s.business_date || "미지정"
    if (!acc[date]) acc[date] = []
    acc[date].push(s)
    return acc
  }, {})

  const totalPayout = settlements.reduce((sum, s) => sum + s.hostess_payout, 0)

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
          <button onClick={() => router.push("/me")} className="text-cyan-400 text-sm">
            ← 마이페이지
          </button>
          <span className="font-semibold">내 정산 내역</span>
          <div className="w-16" />
        </div>

        {error && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="px-4 py-4 space-y-4">
          {/* 총 합계 */}
          <div className="rounded-2xl border border-pink-500/20 bg-pink-500/5 p-4 text-center">
            <div className="text-xs text-slate-400">총 지급액</div>
            <div className="mt-1 text-3xl font-bold text-pink-300">{fmt(totalPayout)}</div>
            <div className="mt-1 text-xs text-slate-500">{settlements.length}건</div>
          </div>

          {/* 일별 요약 카드 */}
          {dailySummary.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-slate-400">일별 요약</div>
              <div className="grid grid-cols-2 gap-2">
                {dailySummary.map((d) => (
                  <div
                    key={d.date}
                    className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"
                  >
                    <div className="text-xs text-slate-500">{d.date}</div>
                    <div className="mt-1 text-lg font-semibold text-pink-300">{fmt(d.total_payout)}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-slate-500">{d.count}건</span>
                      {d.finalized > 0 && (
                        <span className="text-xs text-emerald-400">{d.finalized}건 확정</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 세션별 상세 */}
          {settlements.length === 0 && !error && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
              <p className="text-slate-500 text-sm">정산 내역이 없습니다.</p>
            </div>
          )}

          {Object.entries(grouped)
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([date, items]) => (
              <div key={date} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-300">{date}</span>
                  <span className="text-xs text-slate-500">{items.length}건</span>
                </div>

                {items.map((s) => (
                  <div
                    key={s.participant_id}
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
                      <span className="text-sm font-semibold text-pink-300">{fmt(s.hostess_payout)}</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs text-slate-400">
                      <div>
                        <span className="block text-slate-500">종목</span>
                        <span className="text-white">{s.category || "−"}</span>
                      </div>
                      <div>
                        <span className="block text-slate-500">시간</span>
                        <span className="text-white">{s.time_minutes}분</span>
                      </div>
                      <div>
                        <span className="block text-slate-500">입장</span>
                        <span className="text-white">
                          {new Date(s.entered_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
