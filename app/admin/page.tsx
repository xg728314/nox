"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type RoomStatus = { room_uuid: string; room_no: string; room_name: string; status: string }
type AuditEntry = { id: string; action: string; entity_table: string; actor_role: string; created_at: string }
type DashboardData = {
  business_day: { id: string; business_date: string; status: string } | null
  rooms: { total: number; occupied: number; empty: number; list: RoomStatus[] }
  sessions: { active: number; today_settled: number }
  attendance: { total: number; managers: number; hostesses: number }
  revenue: { today_gross: number }
  recent_audit: AuditEntry[]
}

const ACTION_LABELS: Record<string, string> = {
  session_created: "세션 생성", session_closed: "세션 종료", participant_registered: "참여자 등록",
  order_created: "주문", settlement_created: "정산", staff_checkin: "출근", staff_checkout: "퇴근",
  operating_day_closed: "마감", operating_day_reopened: "재개", membership_approved: "승인",
}

export default function AdminPage() {
  const router = useRouter()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    // Auth + role gate is enforced by middleware.ts. Client-side
    // role gating (if needed for UI) reads via useCurrentProfile.
    fetchData()
  }, [])

  async function fetchData() {
    try {
      const res = await apiFetch("/api/admin/dashboard")
      if (res.status === 401 || res.status === 403) { router.push("/login"); return }
      if (res.ok) { setData(await res.json()); setError("") }
      else setError("관제 데이터를 불러올 수 없습니다.")
    } catch { setError("서버 오류") }
    finally { setLoading(false) }
  }

  if (loading) return <div className="min-h-screen bg-[#030814] flex items-center justify-center"><div className="text-cyan-400 text-sm">로딩 중...</div></div>

  return (
    <div className="min-h-screen bg-[#030814] text-white pb-20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.1),transparent_30%)] pointer-events-none" />
      <div className="relative z-10">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <button onClick={() => router.push("/owner")} className="text-cyan-400 text-sm">← 사장</button>
          <span className="font-semibold">관제 대시보드</span>
          <button onClick={() => fetchData()} className="text-xs text-slate-400 hover:text-white">새로고침</button>
        </div>

        {error && <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>}

        {data && (
          <div className="px-4 py-4 space-y-4">
            {/* 영업일 상태 */}
            <div className={`rounded-2xl border p-4 flex items-center justify-between ${data.business_day?.status === "open" ? "border-emerald-500/20 bg-emerald-500/5" : "border-white/10 bg-white/[0.04]"}`}>
              <div>
                <div className="text-xs text-slate-400">영업일</div>
                <div className="text-sm font-semibold mt-1">{data.business_day?.business_date || "없음"}</div>
              </div>
              <span className={`text-xs px-3 py-1 rounded-full ${data.business_day?.status === "open" ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-500/20 text-slate-400"}`}>
                {data.business_day?.status === "open" ? "영업 중" : data.business_day?.status === "closed" ? "마감" : "없음"}
              </span>
            </div>

            {/* 핵심 지표 4카드 */}
            <div className="grid grid-cols-4 gap-2">
              <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 text-center">
                <div className="text-[10px] text-slate-400">활성 세션</div>
                <div className="text-xl font-bold text-cyan-300 mt-1">{data.sessions.active}</div>
              </div>
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-center">
                <div className="text-[10px] text-slate-400">출근</div>
                <div className="text-xl font-bold text-emerald-300 mt-1">{data.attendance.total}</div>
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-center">
                <div className="text-[10px] text-slate-400">정산</div>
                <div className="text-xl font-bold text-amber-300 mt-1">{data.sessions.today_settled}</div>
              </div>
              <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3 text-center">
                <div className="text-[10px] text-slate-400">매출</div>
                <div className="text-lg font-bold text-purple-300 mt-1">{(data.revenue.today_gross / 10000).toFixed(0)}<span className="text-[10px] text-slate-400">만</span></div>
              </div>
            </div>

            {/* 출근 상세 */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="text-xs text-slate-400 mb-2">출근 상세</div>
              <div className="flex gap-6">
                <div><span className="text-blue-300 font-semibold">{data.attendance.managers}</span><span className="text-xs text-slate-500 ml-1">실장</span></div>
                <div><span className="text-purple-300 font-semibold">{data.attendance.hostesses}</span><span className="text-xs text-slate-500 ml-1">스태프</span></div>
              </div>
            </div>

            {/* 방 현황 그리드 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">방 현황</span>
                <span className="text-xs text-slate-500">{data.rooms.occupied}/{data.rooms.total} 사용 중</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {data.rooms.list.map((r) => (
                  <button
                    key={r.room_uuid}
                    onClick={() => router.push(`/counter/${r.room_uuid}`)}
                    className={`rounded-xl p-3 text-center border transition-colors ${
                      r.status === "occupied"
                        ? "border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20"
                        : "border-white/10 bg-white/[0.04] hover:bg-white/[0.08]"
                    }`}
                  >
                    <div className={`text-sm font-semibold ${r.status === "occupied" ? "text-cyan-300" : "text-slate-500"}`}>
                      {r.room_no}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5 truncate">{r.room_name}</div>
                    <div className={`w-2 h-2 rounded-full mx-auto mt-1 ${r.status === "occupied" ? "bg-cyan-400 shadow-[0_0_6px_rgba(0,200,255,0.8)]" : "bg-slate-600"}`} />
                  </button>
                ))}
              </div>
            </div>

            {/* 최근 감사 로그 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">최근 활동</span>
                <button onClick={() => router.push("/audit")} className="text-xs text-cyan-400 hover:text-cyan-300">전체 보기</button>
              </div>
              {data.recent_audit.length === 0 && (
                <div className="text-xs text-slate-600 text-center py-4">활동 기록 없음</div>
              )}
              {data.recent_audit.map((a) => (
                <div key={a.id} className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-emerald-300/80">{ACTION_LABELS[a.action] || a.action}</span>
                    <span className="text-[10px] text-slate-600">{a.actor_role}</span>
                  </div>
                  <span className="text-[10px] text-slate-600">
                    {new Date(a.created_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
