"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type AuditEvent = {
  id: string
  actor_name: string
  actor_role: string
  action: string
  entity_table: string
  entity_id: string
  session_id: string | null
  before: unknown
  after: unknown
  reason: string | null
  created_at: string
}

const ACTION_LABELS: Record<string, string> = {
  session_created: "세션 생성",
  session_closed: "세션 종료",
  participant_registered: "참여자 등록",
  order_created: "주문 추가",
  settlement_created: "정산 생성",
  settlement_recalculated: "정산 재계산",
  staff_checkin: "출근",
  staff_checkout: "퇴근",
  staff_assigned: "배정",
  staff_unassigned: "배정 해제",
  operating_day_closed: "영업일 마감",
  operating_day_reopened: "영업일 재개",
  membership_approved: "가입 승인",
  membership_rejected: "가입 거부",
}

export default function AuditPage() {
  const router = useRouter()
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [actionFilter, setActionFilter] = useState("")

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData(action?: string) {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "100" })
      if (action) params.set("action", action)
      const res = await apiFetch(`/api/audit?${params}`)
      if (res.status === 401 || res.status === 403) { router.push("/login"); return }
      if (res.ok) {
        const data = await res.json()
        setEvents(data.events ?? [])
        setError("")
      }
    } catch {
      setError("서버 오류")
    } finally {
      setLoading(false)
    }
  }

  function handleFilter(action: string) {
    setActionFilter(action)
    fetchData(action || undefined)
  }

  const uniqueActions = [...new Set(events.map((e) => e.action))]

  return (
    <div className="min-h-screen bg-[#030814] text-white pb-20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.1),transparent_30%)] pointer-events-none" />
      <div className="relative z-10">
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <button onClick={() => router.back()} className="text-cyan-400 text-sm">← 뒤로</button>
          <span className="font-semibold">감사 로그</span>
          <button onClick={() => fetchData()} className="text-xs text-slate-400 hover:text-white">새로고침</button>
        </div>

        {/* 필터 */}
        <div className="px-4 py-3 flex gap-2 overflow-x-auto">
          <button
            onClick={() => handleFilter("")}
            className={`shrink-0 px-3 py-1 rounded-full text-xs ${!actionFilter ? "bg-cyan-500/20 text-cyan-300" : "bg-white/10 text-slate-400"}`}
          >전체</button>
          {Object.entries(ACTION_LABELS).map(([key, label]) => (
            <button
              key={key}
              onClick={() => handleFilter(key)}
              className={`shrink-0 px-3 py-1 rounded-full text-xs whitespace-nowrap ${actionFilter === key ? "bg-cyan-500/20 text-cyan-300" : "bg-white/10 text-slate-400"}`}
            >{label}</button>
          ))}
        </div>

        {error && <div className="mx-4 mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>}

        <div className="px-4 space-y-2">
          <div className="text-xs text-slate-500 mb-2">{events.length}건</div>

          {loading && <div className="text-center text-cyan-400 text-sm py-8">로딩 중...</div>}

          {!loading && events.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
              <div className="text-3xl mb-3">📜</div>
              <p className="text-slate-500 text-sm">감사 로그가 없습니다.</p>
            </div>
          )}

          {events.map((e) => (
            <div key={e.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-3 space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    e.action.includes("closed") || e.action.includes("rejected") ? "bg-red-500/20 text-red-300" :
                    e.action.includes("reopened") ? "bg-amber-500/20 text-amber-300" :
                    "bg-emerald-500/20 text-emerald-300"
                  }`}>
                    {ACTION_LABELS[e.action] || e.action}
                  </span>
                  <span className="text-xs text-slate-500">{e.entity_table}</span>
                </div>
                <span className="text-[10px] text-slate-600">
                  {new Date(e.created_at).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <div className="text-xs text-slate-400">
                {e.actor_name} ({e.actor_role})
                {e.session_id && <span className="ml-2 text-slate-600">세션 {e.session_id.slice(0, 8)}</span>}
              </div>
              {e.reason && (
                <div className="text-xs text-amber-300/80">사유: {e.reason}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
