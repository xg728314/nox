"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

type AttendanceRecord = {
  id: string
  membership_id: string
  role: string
  status: string
  checked_in_at: string
  checked_out_at: string | null
  assigned_room_uuid: string | null
  notes: string | null
  name: string
  room_name: string | null
}

export default function AttendancePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])
  const [businessDayId, setBusinessDayId] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    try {
      const res = await apiFetch("/api/attendance")
      if (res.status === 401 || res.status === 403) { router.push("/login"); return }
      if (res.ok) {
        const data = await res.json()
        setAttendance(data.attendance ?? [])
        setBusinessDayId(data.business_day_id)
        setError("")
      } else {
        setError("출근 현황을 불러올 수 없습니다.")
      }
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  async function handleAction(membershipId: string, action: string, roomUuid?: string) {
    setActionLoading(membershipId)
    setError("")
    try {
      const body: Record<string, string> = { membership_id: membershipId, action }
      if (roomUuid) body.room_uuid = roomUuid
      const res = await apiFetch("/api/attendance", {
        method: "POST",
        body: JSON.stringify(body),
      })
      if (res.ok || res.status === 201) {
        fetchData()
      } else {
        const data = await res.json()
        setError(data.message || "처리 실패")
      }
    } catch {
      setError("서버 오류")
    } finally {
      setActionLoading(null)
    }
  }

  function getStatusLabel(status: string) {
    switch (status) {
      case "available": return "대기"
      case "assigned": return "배정"
      case "in_room": return "입실"
      case "off_duty": return "퇴근"
      default: return status
    }
  }

  function getStatusStyle(status: string) {
    switch (status) {
      case "available": return "bg-emerald-500/20 text-emerald-300"
      case "assigned": return "bg-blue-500/20 text-blue-300"
      case "in_room": return "bg-cyan-500/20 text-cyan-300"
      case "off_duty": return "bg-white/10 text-slate-500"
      default: return "bg-white/10 text-slate-400"
    }
  }

  const activeCount = attendance.filter((a) => a.status !== "off_duty").length
  const managers = attendance.filter((a) => a.role === "manager")
  const hostesses = attendance.filter((a) => a.role === "hostess")

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
          <button
            onClick={() => {
              if (typeof window !== "undefined" && window.history.length > 1) router.back()
              else router.push("/counter")
            }}
            className="text-cyan-400 text-sm"
          >← 뒤로</button>
          <span className="font-semibold">배정 현황판</span>
          <button onClick={() => fetchData()} className="text-xs text-slate-400 hover:text-white">새로고침</button>
        </div>

        {/* 요약 */}
        <div className="grid grid-cols-3 gap-3 px-4 py-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-center">
            <div className="text-xs text-slate-400">출근</div>
            <div className="mt-1 text-2xl font-semibold text-emerald-300">{activeCount}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-center">
            <div className="text-xs text-slate-400">실장</div>
            <div className="mt-1 text-2xl font-semibold text-blue-300">{managers.filter((m) => m.status !== "off_duty").length}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-center">
            <div className="text-xs text-slate-400">스태프</div>
            <div className="mt-1 text-2xl font-semibold text-purple-300">{hostesses.filter((h) => h.status !== "off_duty").length}</div>
          </div>
        </div>

        {error && (
          <div className="mx-4 mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        <div className="px-4 space-y-4">
          {attendance.length === 0 && !error && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
              <div className="text-3xl mb-3">👥</div>
              <p className="text-slate-500 text-sm">출근 기록이 없습니다.</p>
            </div>
          )}

          {/* 실장 섹션 */}
          {managers.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-slate-400 px-1">실장</div>
              {managers.map((a) => (
                <StaffCard key={a.id} record={a} actionLoading={actionLoading} onAction={handleAction} getStatusLabel={getStatusLabel} getStatusStyle={getStatusStyle} />
              ))}
            </div>
          )}

          {/* 스태프 섹션 */}
          {hostesses.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-slate-400 px-1">스태프</div>
              {hostesses.map((a) => (
                <StaffCard key={a.id} record={a} actionLoading={actionLoading} onAction={handleAction} getStatusLabel={getStatusLabel} getStatusStyle={getStatusStyle} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StaffCard({
  record: a,
  actionLoading,
  onAction,
  getStatusLabel,
  getStatusStyle,
}: {
  record: AttendanceRecord
  actionLoading: string | null
  onAction: (mid: string, action: string) => void
  getStatusLabel: (s: string) => string
  getStatusStyle: (s: string) => string
}) {
  const isActioning = actionLoading === a.membership_id
  const isActive = a.status !== "off_duty"

  return (
    <div className={`rounded-2xl border p-4 space-y-2 ${isActive ? "border-white/10 bg-white/[0.04]" : "border-white/5 bg-white/[0.02] opacity-60"}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs ${a.role === "manager" ? "bg-blue-500/20 text-blue-300" : "bg-purple-500/20 text-purple-300"}`}>
            {(a.name || "?").slice(0, 1)}
          </div>
          <div>
            <div className="text-sm font-medium">{a.name || a.membership_id.slice(0, 8)}</div>
            <div className="text-xs text-slate-500">
              {a.role === "manager" ? "실장" : "스태프"}
              {a.room_name && <span className="ml-2 text-cyan-400">→ {a.room_name}</span>}
            </div>
          </div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${getStatusStyle(a.status)}`}>
          {getStatusLabel(a.status)}
        </span>
      </div>

      {/* 출근 시간 */}
      <div className="text-xs text-slate-500">
        출근: {new Date(a.checked_in_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
        {a.checked_out_at && <span className="ml-3">퇴근: {new Date(a.checked_out_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span>}
      </div>

      {/* 액션 버튼 */}
      {isActive && (
        <div className="flex gap-2 pt-1">
          {a.status === "available" && (
            <button onClick={() => onAction(a.membership_id, "checkout")} disabled={isActioning} className="flex-1 h-9 rounded-xl bg-white/10 text-slate-300 text-xs font-medium hover:bg-white/20 disabled:opacity-50">
              {isActioning ? "..." : "퇴근"}
            </button>
          )}
          {(a.status === "assigned" || a.status === "in_room") && (
            <button onClick={() => onAction(a.membership_id, "unassign")} disabled={isActioning} className="flex-1 h-9 rounded-xl bg-amber-500/20 text-amber-300 text-xs font-medium hover:bg-amber-500/30 disabled:opacity-50">
              {isActioning ? "..." : "배정 해제"}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
