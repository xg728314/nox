"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { useCurrentProfile } from "@/lib/auth/useCurrentProfile"
import WorkLogModal from "./components/WorkLogModal"
import DailyOpsCheckGate from "@/components/DailyOpsCheckGate"
import VisibilityControl from "./components/VisibilityControl"
import HostessCard from "./components/HostessCard"
import ManagerPermissionsModal from "./components/ManagerPermissionsModal"
// 2026-05-03: 최근 근무 로그 리스트 분할.
import RecentWorkLogList from "./components/RecentWorkLogList"
import {
  STATUS_STYLES,
  type StaffStatus,
  type StaffAnalytics,
  type Criteria,
} from "./components/staffTypes"
import { useAttendance } from "./hooks/useAttendance"
import {
  useRecentLogs,
  type WorkLogRow,
  type LifecycleAction,
} from "./hooks/useRecentLogs"

// ─── Types / style maps moved to components/staffTypes.ts (ROUND-CLEANUP-002) ─

type StaffMember = {
  id: string
  membership_id: string
  name: string
  role: string
  status: string
}

// ─── Page-local constants ───────────────────────────────────────────────────

const STATUS_ORDER: Record<StaffStatus, number> = {
  "집중관리": 0,
  "출근관리 필요": 1,
  "갯수관리 필요": 2,
  "양호": 3,
}

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

  // 2026-05-01 R-Manager-Permissions: 사장이 실장 클릭 시 권한 modal.
  const [permModalFor, setPermModalFor] = useState<{ membership_id: string; name: string } | null>(null)

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

  // Phase 1 — work log modal state (1 hostess at a time)
  const [workLogTarget, setWorkLogTarget] = useState<{
    membership_id: string
    name: string
  } | null>(null)

  // Round 5 (2026-04-24): Phase 1 로그 + lifecycle 을 hook 으로 분리.
  //   WorkLogRow / LifecycleAction 타입은 hooks/useRecentLogs.ts 로 이관.

  // 담당 실장 없음 로그 접기/펼치기. 기본 숨김.
  //   key: nox.staff.show_unassigned_logs ("1" | "0")
  //   localStorage 사용 실패해도 기본값 (false) 으로 동작.
  const UNASSIGNED_LOGS_PREF_KEY = "nox.staff.show_unassigned_logs"
  const [showUnassignedLogs, setShowUnassignedLogs] = useState<boolean>(false)
  useEffect(() => {
    try {
      if (typeof window === "undefined") return
      const v = window.localStorage.getItem(UNASSIGNED_LOGS_PREF_KEY)
      if (v === "1") setShowUnassignedLogs(true)
    } catch {
      /* ignore (private mode, SSR, 등) */
    }
  }, [])
  const toggleUnassignedLogs = () => {
    setShowUnassignedLogs((prev) => {
      const next = !prev
      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(UNASSIGNED_LOGS_PREF_KEY, next ? "1" : "0")
        }
      } catch {
        /* ignore */
      }
      return next
    })
  }

  // Role — from server-authenticated /api/auth/me (not localStorage)
  const profile = useCurrentProfile()
  const userRole = profile?.role ?? null

  // Caller identity — created_by 비교 및 manager 자기 담당 판정에 사용.
  const myUserId = profile?.user_id ?? ""
  const myMembershipId = profile?.membership_id ?? ""

  // ROUND-STAFF-1/3: 출근 상태 + BLE live presence.
  //   Round 5 (2026-04-24): useAttendance 훅으로 분리. 로직 불변.
  const {
    attendanceMap,
    bleLiveIds,
    attendanceBusyId,
    attendanceToast,
    load: loadAttendance,
    toggle: toggleAttendance,
  } = useAttendance()

  // Round 5: 최근 근무 로그 + lifecycle 액션 훅. 로직 불변.
  const {
    recentLogs,
    recentLogsLoading,
    lifecycleBusyId,
    lifecycleToast,
    reasonModal,
    reasonInput,
    setReasonInput,
    load: loadRecentLogs,
    start: startLifecycle,
    cancelReason: cancelReasonModal,
    submitReason: submitReasonModal,
    availableActions,
  } = useRecentLogs(userRole)

  // ROUND-STAFF-2: 출근 조회 가시성 모드
  type VisibilityMode = "mine_only" | "store_shared"
  const [visibilityMode, setVisibilityMode] = useState<VisibilityMode>("mine_only")
  const [visibilityBusy, setVisibilityBusy] = useState(false)

  async function loadVisibilityPreference() {
    try {
      const res = await apiFetch("/api/me/preferences?scope=attendance_visibility")
      if (!res.ok) return
      const data = await res.json().catch(() => ({}))
      const cfg = (data?.global ?? null) as { mode?: string } | null
      const perStore = (data?.per_store ?? {}) as Record<string, { mode?: string }>
      const myStore = profile?.store_uuid ? perStore[profile.store_uuid] : null
      const picked = (myStore?.mode ?? cfg?.mode) as VisibilityMode | undefined
      if (picked === "store_shared" || picked === "mine_only") {
        setVisibilityMode(picked)
      }
    } catch { /* default */ }
  }

  async function setVisibilityPreference(mode: VisibilityMode) {
    setVisibilityBusy(true)
    try {
      const res = await apiFetch("/api/me/preferences", {
        method: "PUT",
        body: JSON.stringify({
          scope: "attendance_visibility",
          store_uuid: profile?.store_uuid ?? null,
          layout_config: { mode },
        }),
      })
      if (res.ok) {
        setVisibilityMode(mode)
        // 저장 후 동일 visibility 규칙을 쓰는 analytics + attendance 재조회
        await Promise.all([loadAnalytics(), loadAttendance()])
      }
    } catch { /* ignore */ }
    finally {
      setVisibilityBusy(false)
    }
  }

  // Round 5: loadAttendance / toggleAttendance 는 useAttendance 훅으로 이관됨.

  // ── Load data ──

  useEffect(() => {
    loadSettings()
    loadManagers()
    loadRecentLogs()
    loadAttendance()
    loadVisibilityPreference()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load analytics whenever criteria changes
  useEffect(() => {
    loadAnalytics()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodDays, minDays, perfUnit, perfMinCount])

  // Round 5: sendLifecycle / startLifecycle / cancelReasonModal / submitReasonModal
  //   / availableActions / reasonModal state — 전부 useRecentLogs 훅으로 이관됨.
  //   (WorkLogRow / LifecycleAction 타입은 export 되어 있어 재사용 가능)

  // suppress unused var warning (snapshot comparisons no longer needed)
  void myUserId
  void myMembershipId

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

  // ── Derived data ──

  const [searchQuery, setSearchQuery] = useState("")
  const normalizedQuery = searchQuery.trim().toLowerCase()

  const filteredAnalytics = analytics
    .filter(a => statusFilter === "전체" || a.status === statusFilter)
    .filter(a => {
      if (!normalizedQuery) return true
      return (a.name || "").toLowerCase().includes(normalizedQuery)
    })
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])

  const statusCounts = analytics.reduce((acc, a) => {
    acc[a.status] = (acc[a.status] || 0) + 1
    return acc
  }, {} as Record<StaffStatus, number>)

  // 출근/근무기록 등 스태프 조작 권한 (등급 UI 는 제거됨).
  const canManageStaff = userRole === "owner" || userRole === "manager"
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
    <div className="min-h-screen bg-[#030814] text-white pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,173,255,0.1),transparent_30%)] pointer-events-none" />
      <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:42px_42px] pointer-events-none" />

      <div className="relative z-10">
        {/* ─── Header ─── */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
          <button
            onClick={() => router.push("/counter")}
            className="text-cyan-400 text-sm"
          >&larr; 뒤로</button>
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

        {/* ROUND-STAFF-1/2: 이름 검색 + 공유 옵션 + 출근 토스트 */}
        {tab === "hostesses" && (
          <div className="px-4 mb-2 space-y-1.5">
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="스태프 이름 검색..."
              className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-white/25"
            />
            {/* ROUND-STAFF-2 + ROUND-CLEANUP-002: 분리된 VisibilityControl */}
            <VisibilityControl
              userRole={userRole}
              mode={visibilityMode}
              busy={visibilityBusy}
              onChange={setVisibilityPreference}
            />
            {attendanceToast && (
              <div className="text-[11px] text-emerald-300 px-1">{attendanceToast}</div>
            )}
          </div>
        )}

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

            {/* ROUND-CLEANUP-002: HostessCard 로 분리. 로직 동일. */}
            {filteredAnalytics.map((a) => (
              <HostessCard
                key={a.membership_id}
                a={a}
                criteria={criteria}
                canManageStaff={canManageStaff}
                attendanceOn={attendanceMap.has(a.membership_id)}
                attendanceBusy={attendanceBusyId === a.membership_id}
                bleLive={bleLiveIds.has(a.membership_id)}
                userRole={userRole}
                myMembershipId={myMembershipId}
                onToggleAttendance={toggleAttendance}
                onOpenWorkLog={(membership_id, name) =>
                  setWorkLogTarget({ membership_id, name })
                }
              />
            ))}
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
            {managers.map(m => {
              const isOwnerView = userRole === "owner"
              const isApproved = m.status === "approved"
              const canEditPerms = isOwnerView && isApproved
              return (
                <button
                  key={m.membership_id}
                  type="button"
                  disabled={!canEditPerms}
                  onClick={() => {
                    if (canEditPerms) {
                      setPermModalFor({ membership_id: m.membership_id, name: m.name })
                    }
                  }}
                  className={`w-full text-left rounded-xl border border-purple-500/10 bg-white/[0.03] p-3 transition-colors ${
                    canEditPerms ? "hover:bg-purple-500/5 hover:border-purple-500/30 cursor-pointer" : "cursor-default"
                  }`}
                  title={canEditPerms ? "메뉴 권한 설정" : undefined}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-300 text-sm font-semibold">
                        {(m.name || "?").charAt(0)}
                      </div>
                      <div>
                        <div className="text-sm font-medium">{m.name}</div>
                        <div className="text-[10px] text-slate-500">
                          실장
                          {canEditPerms && <span className="ml-1.5 text-cyan-400/70">· 권한 설정</span>}
                        </div>
                      </div>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                      m.status === "approved" ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20" : "bg-white/10 text-slate-500 border border-white/10"
                    }`}>
                      {m.status === "approved" ? "승인" : m.status}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ─── Bottom nav ───
          z-40 으로 본문(z-10) 위. pb-safe 로 iOS home-indicator 겹침 방지.
          배경은 기존 staff 스타일 유지. */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[#030814]/95 backdrop-blur-sm"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
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

        {/* ─── Phase 1: 최근 근무 로그 — extracted to RecentWorkLogList ─── */}
        <RecentWorkLogList
          recentLogs={recentLogs}
          loading={recentLogsLoading}
          showUnassignedLogs={showUnassignedLogs}
          toggleUnassignedLogs={toggleUnassignedLogs}
          loadRecentLogs={loadRecentLogs}
          lifecycleToast={lifecycleToast}
          lifecycleBusyId={lifecycleBusyId}
          availableActions={availableActions}
          startLifecycle={startLifecycle}
        />
      </div>

      {/* Phase 1 work log modal — hostess 1명 draft 기록. */}
      <WorkLogModal
        open={!!workLogTarget}
        onClose={() => setWorkLogTarget(null)}
        hostessMembershipId={workLogTarget?.membership_id ?? ""}
        hostessName={workLogTarget?.name ?? ""}
        callerStoreUuid={profile?.store_uuid ?? ""}
        onSuccess={loadRecentLogs}
      />

      {/* Phase 2/3-A reason modal — void/dispute 필수, resolve 선택. */}
      {reasonModal && (() => {
        const isResolve = reasonModal.action === "resolve"
        const isVoid = reasonModal.action === "void"
        const title =
          isVoid ? "무효화 사유"
          : isResolve ? "해결 사유 (선택)"
          : "이의 제기 사유"
        const desc =
          isVoid ? "이 근무 로그를 무효화합니다. 사유를 입력하세요."
          : isResolve ? "분쟁을 해결하고 confirmed 로 되돌립니다. 필요하면 사유/메모를 남겨주세요."
          : "이 근무 로그에 이의를 제기합니다. 사유를 입력하세요."
        const cta =
          isVoid ? "무효화"
          : isResolve ? "해결"
          : "이의 제기"
        const ctaColor =
          isVoid ? "bg-red-500/20 text-red-200 border-red-500/30"
          : isResolve ? "bg-emerald-500/20 text-emerald-200 border-emerald-500/30"
          : "bg-amber-500/20 text-amber-200 border-amber-500/30"
        const disableSubmit =
          (!isResolve && !reasonInput.trim()) ||
          lifecycleBusyId === reasonModal.logId
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4">
            <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-[#0A1222] p-5 space-y-3">
              <div>
                <div className="text-xs text-slate-400">{title}</div>
                <div className="text-sm text-slate-300 mt-0.5">{desc}</div>
              </div>
              <textarea
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
                rows={3}
                placeholder={isResolve ? "사유/메모 (선택)" : "사유를 입력하세요 (필수)"}
                className="w-full bg-[#030814] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none resize-none"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={cancelReasonModal}
                  disabled={lifecycleBusyId === reasonModal.logId}
                  className="flex-1 h-10 rounded-xl bg-white/5 text-slate-300 text-sm border border-white/10 disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  onClick={submitReasonModal}
                  disabled={disableSubmit}
                  className={`flex-1 h-10 rounded-xl text-sm font-medium border disabled:opacity-50 ${ctaColor}`}
                >
                  {lifecycleBusyId === reasonModal.logId ? "처리 중..." : cta}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ROUND-OPS-2: 하루 1회 운영 체크 강제 모달 */}
      <DailyOpsCheckGate />

      {/* R-Manager-Permissions: 실장 권한 modal */}
      {permModalFor && (
        <ManagerPermissionsModal
          membership_id={permModalFor.membership_id}
          manager_name={permModalFor.name}
          onClose={() => setPermModalFor(null)}
        />
      )}
    </div>
  )
}
