"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { useCurrentProfile } from "@/lib/auth/useCurrentProfile"

// ─── Types ──────────────────────────────────────────────────────────────────

type StaffStatus = "양호" | "출근관리 필요" | "갯수관리 필요" | "집중관리"
type Grade = "S" | "A" | "B" | "C" | null

type StaffAnalytics = {
  membership_id: string
  name: string
  grade: Grade
  grade_updated_at: string | null
  manager_membership_id: string | null
  status: StaffStatus
  attendance: {
    days: number
    rate: number
    consecutive_absent: number
  }
  performance: {
    total_sessions: number
    avg_per_day: number
    threshold: number
  }
}

type Criteria = {
  periodDays: number
  minDays: number
  perfUnit: string
  perfMinCount: number
  perfThreshold: number
}

type StaffMember = {
  id: string
  membership_id: string
  name: string
  role: string
  status: string
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STATUS_ORDER: Record<StaffStatus, number> = {
  "집중관리": 0,
  "출근관리 필요": 1,
  "갯수관리 필요": 2,
  "양호": 3,
}

const STATUS_STYLES: Record<StaffStatus, { bg: string; text: string; border: string }> = {
  "집중관리": { bg: "bg-red-500/15", text: "text-red-400", border: "border-red-500/25" },
  "출근관리 필요": { bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/25" },
  "갯수관리 필요": { bg: "bg-orange-500/15", text: "text-orange-400", border: "border-orange-500/25" },
  "양호": { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/25" },
}

const GRADE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  S: { bg: "bg-amber-400/20", text: "text-amber-300", border: "border-amber-400/40" },
  A: { bg: "bg-cyan-500/20", text: "text-cyan-300", border: "border-cyan-500/40" },
  B: { bg: "bg-slate-400/20", text: "text-slate-400", border: "border-slate-400/40" },
  C: { bg: "bg-red-500/20", text: "text-red-400", border: "border-red-500/40" },
}

const GRADES: Grade[] = ["S", "A", "B", "C"]
const STATUS_FILTERS: (StaffStatus | "전체")[] = ["전체", "집중관리", "출근관리 필요", "갯수관리 필요", "양호"]
const PERIOD_OPTIONS = [7, 14, 30]
const PERF_UNIT_OPTIONS = [
  { value: "daily", label: "하루" },
  { value: "weekly", label: "주간" },
  { value: "monthly", label: "월간" },
]

// ─── Component ──────────────────────────────────────────────────────────────

export default function StaffPage() {
  const router = useRouter()

  // Tab
  const [tab, setTab] = useState<"managers" | "hostesses">("hostesses")

  // Data
  const [managers, setManagers] = useState<StaffMember[]>([])
  const [analytics, setAnalytics] = useState<StaffAnalytics[]>([])
  const [criteria, setCriteria] = useState<Criteria | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // Settings panel
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [periodDays, setPeriodDays] = useState(7)
  const [minDays, setMinDays] = useState(3)
  const [perfUnit, setPerfUnit] = useState("weekly")
  const [perfMinCount, setPerfMinCount] = useState(5)
  const [savingSettings, setSavingSettings] = useState(false)

  // Filter
  const [statusFilter, setStatusFilter] = useState<StaffStatus | "전체">("전체")

  // Grade editing
  const [gradeBusy, setGradeBusy] = useState<string | null>(null)

  // Role — from server-authenticated /api/auth/me (not localStorage)
  const profile = useCurrentProfile()
  const userRole = profile?.role ?? null

  // ── Load data ──

  useEffect(() => {
    loadSettings()
    loadManagers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load analytics whenever criteria changes
  useEffect(() => {
    loadAnalytics()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodDays, minDays, perfUnit, perfMinCount])

  async function loadSettings() {
    try {
      const res = await apiFetch("/api/store/settings")
      if (res.ok) {
        const data = await res.json()
        const s = data.settings
        if (s) {
          setPeriodDays(s.attendance_period_days ?? 7)
          setMinDays(s.attendance_min_days ?? 3)
          setPerfUnit(s.performance_unit ?? "weekly")
          setPerfMinCount(s.performance_min_count ?? 5)
        }
      }
    } catch { /* use defaults */ }
  }

  async function loadManagers() {
    try {
      const res = await apiFetch("/api/store/staff?role=manager")
      if (res.ok) {
        const data = await res.json()
        setManagers(data.staff ?? [])
      }
    } catch { /* ignore */ }
  }

  async function loadAnalytics() {
    try {
      const params = new URLSearchParams({
        attendance_period_days: String(periodDays),
        attendance_min_days: String(minDays),
        performance_unit: perfUnit,
        performance_min_count: String(perfMinCount),
      })
      const res = await apiFetch(`/api/store/staff/analytics?${params}`)
      if (res.ok) {
        const data = await res.json()
        setAnalytics(data.analytics ?? [])
        setCriteria(data.criteria ?? null)
      } else {
        setError("분석 데이터를 불러올 수 없습니다.")
      }
    } catch {
      setError("서버 오류")
    } finally {
      setLoading(false)
    }
  }

  // ── Save settings ──

  async function handleSaveSettings() {
    setSavingSettings(true)
    setError("")
    try {
      const res = await apiFetch("/api/store/settings", {
        method: "PATCH",
        body: JSON.stringify({
          attendance_period_days: periodDays,
          attendance_min_days: minDays,
          performance_unit: perfUnit,
          performance_min_count: perfMinCount,
        }),
      })
      if (res.ok) {
        setSettingsOpen(false)
        await loadAnalytics()
      } else {
        const data = await res.json()
        setError(data.message || "설정 저장 실패")
      }
    } catch {
      setError("설정 저장 실패")
    } finally {
      setSavingSettings(false)
    }
  }

  // ── Grade change ──

  async function handleGradeChange(membershipId: string, newGrade: Grade) {
    setGradeBusy(membershipId)
    try {
      const res = await apiFetch("/api/store/staff/grade", {
        method: "PATCH",
        body: JSON.stringify({ membership_id: membershipId, grade: newGrade }),
      })
      if (res.ok) {
        setAnalytics(prev =>
          prev.map(a => a.membership_id === membershipId ? { ...a, grade: newGrade } : a)
        )
      } else {
        const data = await res.json()
        setError(data.message || "등급 변경 실패")
      }
    } catch {
      setError("등급 변경 실패")
    } finally {
      setGradeBusy(null)
    }
  }

  // ── Derived data ──

  const filteredAnalytics = analytics
    .filter(a => statusFilter === "전체" || a.status === statusFilter)
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])

  const statusCounts = analytics.reduce((acc, a) => {
    acc[a.status] = (acc[a.status] || 0) + 1
    return acc
  }, {} as Record<StaffStatus, number>)

  const canEditGrade = userRole === "owner" || userRole === "manager"
  const perfUnitLabel = PERF_UNIT_OPTIONS.find(o => o.value === perfUnit)?.label ?? perfUnit

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-[#030814] flex items-center justify-center">
        <div className="text-cyan-400 text-sm animate-pulse">로딩 중...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#030814] text-white pb-20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.1),transparent_30%)] pointer-events-none" />
      <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:42px_42px] pointer-events-none" />

      <div className="relative z-10">
        {/* ─── Header ─── */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <button onClick={() => router.push("/counter")} className="text-cyan-400 text-sm">&larr; 카운터</button>
          <span className="font-semibold">스태프 관리</span>
          <button
            onClick={() => setSettingsOpen(v => !v)}
            className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"
          >
            기준설정
          </button>
        </div>

        {/* ─── Settings Panel ─── */}
        {settingsOpen && (
          <div className="mx-4 mt-3 p-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 space-y-4">
            <div className="text-sm font-semibold text-cyan-300">관리 기준 설정</div>

            {/* Attendance criteria */}
            <div className="space-y-2">
              <div className="text-[11px] text-slate-400 font-medium">출근 기준</div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500 shrink-0">기간:</span>
                <div className="flex gap-1">
                  {PERIOD_OPTIONS.map(d => (
                    <button
                      key={d}
                      onClick={() => setPeriodDays(d)}
                      className={`text-[11px] px-2.5 py-1 rounded-lg border transition-all ${
                        periodDays === d
                          ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                          : "bg-white/5 text-slate-500 border-white/10 hover:bg-white/10"
                      }`}
                    >
                      {d}일
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500 shrink-0">최소 출근:</span>
                <input
                  type="number"
                  min={0}
                  max={periodDays}
                  value={minDays}
                  onChange={e => setMinDays(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-16 bg-transparent border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white outline-none focus:border-cyan-500/40"
                />
                <span className="text-[11px] text-slate-500">일</span>
              </div>
            </div>

            {/* Performance criteria */}
            <div className="space-y-2">
              <div className="text-[11px] text-slate-400 font-medium">갯수 기준</div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500 shrink-0">단위:</span>
                <div className="flex gap-1">
                  {PERF_UNIT_OPTIONS.map(o => (
                    <button
                      key={o.value}
                      onClick={() => setPerfUnit(o.value)}
                      className={`text-[11px] px-2.5 py-1 rounded-lg border transition-all ${
                        perfUnit === o.value
                          ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                          : "bg-white/5 text-slate-500 border-white/10 hover:bg-white/10"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500 shrink-0">최소 갯수:</span>
                <input
                  type="number"
                  min={0}
                  value={perfMinCount}
                  onChange={e => setPerfMinCount(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-16 bg-transparent border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white outline-none focus:border-cyan-500/40"
                />
                <span className="text-[11px] text-slate-500">건/{perfUnitLabel}</span>
              </div>
            </div>

            {/* Apply button — owner only saves to DB, manager applies locally */}
            <div className="flex gap-2">
              {userRole === "owner" ? (
                <button
                  onClick={handleSaveSettings}
                  disabled={savingSettings}
                  className="flex-1 text-[12px] py-2 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30 disabled:opacity-50 transition-all"
                >
                  {savingSettings ? "저장 중..." : "기준 저장 및 적용"}
                </button>
              ) : (
                <button
                  onClick={() => { setSettingsOpen(false); loadAnalytics() }}
                  className="flex-1 text-[12px] py-2 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30 transition-all"
                >
                  기준 적용
                </button>
              )}
              <button
                onClick={() => setSettingsOpen(false)}
                className="text-[12px] px-4 py-2 rounded-lg bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10 transition-all"
              >
                닫기
              </button>
            </div>
          </div>
        )}

        {/* ─── Summary Cards ─── */}
        <div className="grid grid-cols-4 gap-2 px-4 py-3">
          {(Object.entries(statusCounts) as [StaffStatus, number][])
            .sort(([a], [b]) => STATUS_ORDER[a] - STATUS_ORDER[b])
            .map(([st, count]) => {
              const style = STATUS_STYLES[st]
              return (
                <button
                  key={st}
                  onClick={() => setStatusFilter(f => f === st ? "전체" : st)}
                  className={`rounded-xl p-2.5 border text-center transition-all ${style.bg} ${style.border} ${
                    statusFilter === st ? "ring-1 ring-white/20 scale-[1.02]" : ""
                  }`}
                >
                  <div className={`text-lg font-bold ${style.text}`}>{count}</div>
                  <div className="text-[9px] text-slate-400 mt-0.5 leading-tight">{st}</div>
                </button>
              )
            })}
        </div>

        {/* ─── Tabs ─── */}
        <div className="px-4 flex gap-2 mb-2">
          <button
            onClick={() => setTab("hostesses")}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${
              tab === "hostesses"
                ? "bg-pink-500/20 text-pink-300 border border-pink-500/30"
                : "bg-white/[0.04] text-slate-400 border border-white/10"
            }`}
          >
            스태프 ({analytics.length})
          </button>
          <button
            onClick={() => setTab("managers")}
            className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${
              tab === "managers"
                ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                : "bg-white/[0.04] text-slate-400 border border-white/10"
            }`}
          >
            실장 ({managers.length})
          </button>
        </div>

        {/* ─── Filter pills ─── */}
        {tab === "hostesses" && (
          <div className="px-4 mb-3 flex gap-1.5 overflow-x-auto no-scrollbar">
            {STATUS_FILTERS.map(sf => (
              <button
                key={sf}
                onClick={() => setStatusFilter(sf)}
                className={`shrink-0 text-[11px] px-3 py-1.5 rounded-full border transition-all ${
                  statusFilter === sf
                    ? "bg-white/10 text-white border-white/20"
                    : "bg-white/[0.03] text-slate-500 border-white/[0.06] hover:bg-white/[0.06]"
                }`}
              >
                {sf}
                {sf !== "전체" && statusCounts[sf] !== undefined && (
                  <span className="ml-1 text-[10px] opacity-60">{statusCounts[sf]}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* ─── Error ─── */}
        {error && (
          <div className="mx-4 mb-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
            <button onClick={() => setError("")} className="ml-2 text-red-300 underline text-xs">닫기</button>
          </div>
        )}

        {/* ─── Hostesses tab ─── */}
        {tab === "hostesses" && (
          <div className="px-4 space-y-2">
            {/* Current criteria display */}
            {criteria && (
              <div className="text-[10px] text-slate-600 mb-1 px-1">
                기준: 최근 {criteria.periodDays}일 / 출근 {criteria.minDays}일 이상 / 갯수 {criteria.perfMinCount}건/{perfUnitLabel} 이상
              </div>
            )}

            {filteredAnalytics.length === 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
                <p className="text-slate-500 text-sm">
                  {statusFilter !== "전체" ? `${statusFilter} 상태의 스태프가 없습니다.` : "등록된 스태프가 없습니다."}
                </p>
              </div>
            )}

            {filteredAnalytics.map(a => {
              const stStyle = STATUS_STYLES[a.status]
              const gStyle = a.grade ? GRADE_STYLES[a.grade] : null

              return (
                <div
                  key={a.membership_id}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 hover:bg-white/[0.05] transition-all"
                >
                  {/* Row 1: Name + grade + status */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {/* Grade badge */}
                      {gStyle && a.grade && (
                        <span className={`text-[11px] font-bold w-6 h-6 rounded-md flex items-center justify-center border ${gStyle.bg} ${gStyle.text} ${gStyle.border}`}>
                          {a.grade}
                        </span>
                      )}
                      {!a.grade && (
                        <span className="text-[11px] w-6 h-6 rounded-md flex items-center justify-center border border-white/[0.06] bg-white/[0.02] text-slate-600">
                          -
                        </span>
                      )}
                      <span className="text-sm font-medium text-white">{a.name}</span>
                    </div>

                    {/* Status badge */}
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${stStyle.bg} ${stStyle.text} ${stStyle.border}`}>
                      {a.status}
                    </span>
                  </div>

                  {/* Row 2: Mini stats */}
                  <div className="flex gap-3 mb-2">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-slate-600">출근:</span>
                      <span className={`text-[11px] font-medium ${
                        a.attendance.days < (criteria?.minDays ?? 3) ? "text-amber-400" : "text-slate-300"
                      }`}>
                        {a.attendance.days}일
                      </span>
                      <span className="text-[10px] text-slate-600">({a.attendance.rate}%)</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-slate-600">갯수:</span>
                      <span className={`text-[11px] font-medium ${
                        a.performance.total_sessions < (criteria?.perfThreshold ?? 5) ? "text-orange-400" : "text-slate-300"
                      }`}>
                        {a.performance.total_sessions}건
                      </span>
                    </div>
                    {a.attendance.consecutive_absent > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-slate-600">연속결근:</span>
                        <span className={`text-[11px] font-medium ${
                          a.attendance.consecutive_absent >= 3 ? "text-red-400" : "text-slate-400"
                        }`}>
                          {a.attendance.consecutive_absent}일
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Row 3: Grade buttons (manager/owner only) */}
                  {canEditGrade && (
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-slate-600 mr-1">등급:</span>
                      {GRADES.map(g => {
                        const gs = GRADE_STYLES[g!]
                        const isActive = a.grade === g
                        return (
                          <button
                            key={g}
                            onClick={() => handleGradeChange(a.membership_id, isActive ? null : g)}
                            disabled={gradeBusy === a.membership_id}
                            className={`text-[10px] font-bold w-7 h-6 rounded border transition-all disabled:opacity-50 ${
                              isActive
                                ? `${gs.bg} ${gs.text} ${gs.border}`
                                : "bg-white/[0.03] text-slate-600 border-white/[0.06] hover:bg-white/[0.06]"
                            }`}
                          >
                            {g}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ─── Managers tab ─── */}
        {tab === "managers" && (
          <div className="px-4 space-y-2">
            {managers.length === 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
                <p className="text-slate-500 text-sm">등록된 실장이 없습니다.</p>
              </div>
            )}
            {managers.map(m => (
              <div key={m.membership_id} className="rounded-xl border border-purple-500/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-300 text-sm font-semibold">
                      {(m.name || "?").charAt(0)}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{m.name}</div>
                      <div className="text-[10px] text-slate-500">실장</div>
                    </div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                    m.status === "approved" ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20" : "bg-white/10 text-slate-500 border border-white/10"
                  }`}>
                    {m.status === "approved" ? "승인" : m.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Bottom nav ─── */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-white/10 bg-[#030814]/95 backdrop-blur-sm">
        <div className="grid grid-cols-5 py-2">
          {[
            { label: "카운터", icon: "\u229E", path: "/counter" },
            { label: "예약", icon: "\uD83D\uDCCB", path: "#" },
            { label: "정산", icon: "\uD83D\uDCB0", path: "/settlement" },
            { label: "스태프", icon: "\uD83D\uDC64", path: "/staff" },
            { label: "OPS", icon: "\u2699", path: "#" },
          ].map(item => (
            <button
              key={item.label}
              onClick={() => item.path !== "#" && router.push(item.path)}
              className={`flex flex-col items-center py-2 gap-1 text-xs ${item.path === "/staff" ? "text-cyan-400" : "text-slate-500"}`}
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
