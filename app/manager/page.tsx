"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { usePagePerf } from "@/lib/debug/usePagePerf"
import DailyOpsCheckGate from "@/components/DailyOpsCheckGate"
import { fmtMan } from "@/lib/format"
import ManagerBottomNav from "./components/ManagerBottomNav"

type DashboardData = {
  assigned_hostess_count: number
  assigned_hostesses_preview: { hostess_id: string; hostess_name: string }[]
  visible_sections: string[]
}

type Hostess = {
  hostess_id: string
  hostess_name: string
}

type SettlementSummary = {
  total_sessions: number
  total_gross: number
  total_manager_amount: number
}

type AttendanceRecord = {
  id: string
  membership_id: string
  role: string
  status: string
  name: string
  room_name: string | null
}

type ManagedParticipant = {
  id: string
  session_id: string
  external_name: string | null
  category: string | null
  time_minutes: number | null
  entered_at: string
  match_status: "matched" | "unmatched"
  name_edited: boolean
  room_name: string | null
  working_store_name: string | null
}

export default function ManagerPage() {
  const router = useRouter()
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [hostesses, setHostesses] = useState<Hostess[]>([])
  const [settlement, setSettlement] = useState<SettlementSummary | null>(null)
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])
  const [managedParticipants, setManagedParticipants] = useState<ManagedParticipant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [chatUnread, setChatUnread] = useState(0)
  const [showProfitToOwner, setShowProfitToOwner] = useState(false)
  const [showHostessProfitToOwner, setShowHostessProfitToOwner] = useState(false)
  const [visibilityLoading, setVisibilityLoading] = useState(false)

  // T3: 담당 해제 state.
  const [unassignBusyId, setUnassignBusyId] = useState<string | null>(null)
  const [unassignToast, setUnassignToast] = useState<string>("")

  usePagePerf("manager")

  useEffect(() => {
    // Bootstrap-first: fan-in via /api/manager/bootstrap, fall back per slot.
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch("/api/manager/bootstrap")
        if (cancelled) return
        if (res.status === 401 || res.status === 403) { router.push("/login"); return }
        if (!res.ok) {
          fetchData()
          fetchChatUnread()
          fetchManagedParticipants()
          fetchVisibility()
          return
        }
        const data = await res.json()
        const missing: string[] = []

        if (data.dashboard) {
          const d = data.dashboard as Record<string, unknown>
          setDashboard({
            assigned_hostess_count: (d.assigned_hostess_count as number) ?? 0,
            assigned_hostesses_preview: (d.assigned_hostesses_preview as DashboardData["assigned_hostesses_preview"]) ?? [],
            visible_sections: (d.visible_sections as string[]) ?? [],
          })
        } else missing.push("dashboard")

        if (Array.isArray(data.hostesses)) setHostesses(data.hostesses as Hostess[])
        else missing.push("hostesses")

        if (data.settlement) {
          const s = data.settlement as Record<string, unknown>
          setSettlement({
            total_sessions: (s.total_sessions as number) ?? 0,
            total_gross: (s.gross_total as number) ?? 0,
            total_manager_amount: (s.manager_amount as number) ?? 0,
          })
        } else missing.push("settlement")

        if (Array.isArray(data.attendance)) {
          setAttendance((data.attendance as AttendanceRecord[]).filter((a) => a.status !== "off_duty"))
        } else missing.push("attendance")

        if (typeof data.chat_unread === "number") setChatUnread(data.chat_unread)
        else missing.push("chat_unread")

        if (Array.isArray(data.participants)) setManagedParticipants(data.participants as ManagedParticipant[])
        else missing.push("participants")

        if (data.visibility) {
          const v = data.visibility as Record<string, unknown>
          setShowProfitToOwner((v.show_profit_to_owner as boolean) ?? false)
          setShowHostessProfitToOwner((v.show_hostess_profit_to_owner as boolean) ?? false)
        } else missing.push("visibility")

        const needData = missing.includes("dashboard") || missing.includes("hostesses") || missing.includes("settlement") || missing.includes("attendance")
        if (needData) fetchData()
        else setLoading(false)
        if (missing.includes("chat_unread")) fetchChatUnread()
        if (missing.includes("participants")) fetchManagedParticipants()
        if (missing.includes("visibility")) fetchVisibility()
      } catch {
        if (cancelled) return
        fetchData()
        fetchChatUnread()
        fetchManagedParticipants()
        fetchVisibility()
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchVisibility() {
    try {
      const res = await apiFetch("/api/manager/visibility")
      if (res.ok) {
        const data = await res.json()
        setShowProfitToOwner(data.show_profit_to_owner ?? false)
        setShowHostessProfitToOwner(data.show_hostess_profit_to_owner ?? false)
      }
    } catch { /* ignore */ }
  }

  async function toggleVisibility(field: "show_profit_to_owner" | "show_hostess_profit_to_owner", value: boolean) {
    setVisibilityLoading(true)
    try {
      const res = await apiFetch("/api/manager/visibility", {
        method: "PATCH",
        body: JSON.stringify({ [field]: value }),
      })
      if (res.ok) {
        const data = await res.json()
        setShowProfitToOwner(data.show_profit_to_owner)
        setShowHostessProfitToOwner(data.show_hostess_profit_to_owner)
      }
    } catch { /* ignore */ }
    setVisibilityLoading(false)
  }

  async function fetchManagedParticipants() {
    try {
      const res = await apiFetch("/api/manager/participants")
      if (res.ok) {
        const data = await res.json()
        setManagedParticipants(data.participants ?? [])
      }
    } catch { /* ignore */ }
  }

  async function handleParticipantNameEdit(participantId: string, currentName: string | null, newName: string) {
    const val = newName.trim()
    if (val === (currentName ?? "").trim()) return
    try {
      const res = await apiFetch(`/api/sessions/participants/${participantId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "update_external_name", external_name: val }),
      })
      if (res.ok) {
        // 갱신
        await fetchManagedParticipants()
      }
    } catch { /* ignore */ }
  }

  // T3: 본인 담당 hostess 를 스스로 해제. PATCH /api/hostesses/:id/assign
  //   { manager_membership_id: null } — 서버가 self-assign 권한 (본인에게만)
  //   재검증 후 null 로 업데이트. 성공 시 담당 목록에서 사라지고 미배정
  //   섹션으로 이동. 기존 assign route 재사용 — 신규 API 없음.
  async function unassignSelf(hostessId: string) {
    setUnassignBusyId(hostessId)
    try {
      const res = await apiFetch(
        `/api/hostesses/${hostessId}/assign`,
        {
          method: "PATCH",
          body: JSON.stringify({ manager_membership_id: null }),
        },
      )
      if (res.ok) {
        setUnassignToast("담당 해제 완료")
        // 담당 목록 optimistic 제거 + bootstrap re-fetch 로 정합성 확정.
        setHostesses((prev) => prev.filter((h) => h.hostess_id !== hostessId))
        fetchData()
        setTimeout(() => setUnassignToast(""), 2000)
      } else {
        const body = await res.json().catch(() => ({}))
        setUnassignToast(body.message || "해제 실패")
        setTimeout(() => setUnassignToast(""), 3000)
      }
    } catch {
      setUnassignToast("서버 오류")
      setTimeout(() => setUnassignToast(""), 3000)
    } finally {
      setUnassignBusyId(null)
    }
  }

  async function fetchChatUnread() {
    try {
      const res = await apiFetch("/api/chat/unread")
      if (res.ok) {
        const data = await res.json()
        setChatUnread(data.unread_count ?? 0)
      }
    } catch { /* ignore */ }
  }

  async function fetchData() {
    // 2026-04-25: Promise.all → allSettled 로 교체. 이전엔 1개 실패 시 전체
    //   catch → 대시보드 blank. 이제 각 fetch 개별 성공/실패 처리.
    const endpoints = [
      apiFetch("/api/manager/dashboard").catch(() => null),
      apiFetch("/api/manager/hostesses").catch(() => null),
      apiFetch("/api/manager/settlement/summary").catch(() => null),
      apiFetch("/api/attendance").catch(() => null),
    ]
    const [dashRes, hostessRes, settleRes, attendRes] = await Promise.all(endpoints)

    // 401/403 만 공통 처리 — 어느 fetch 라도 감지되면 로그인 페이지로.
    const anyAuthFail = [dashRes, hostessRes, settleRes, attendRes]
      .some(r => r && (r.status === 401 || r.status === 403))
    if (anyAuthFail) {
      router.push("/login")
      return
    }

    const failures: string[] = []

    if (dashRes?.ok) {
      try {
        const data = await dashRes.json()
        setDashboard({
          assigned_hostess_count: data.assigned_hostess_count ?? 0,
          assigned_hostesses_preview: data.assigned_hostesses_preview ?? [],
          visible_sections: data.visible_sections ?? [],
        })
      } catch { failures.push("대시보드") }
    } else {
      failures.push("대시보드")
    }

    if (hostessRes?.ok) {
      try {
        const data = await hostessRes.json()
        setHostesses(data.hostesses ?? [])
      } catch { failures.push("스태프 목록") }
    } else {
      failures.push("스태프 목록")
    }

    if (settleRes?.ok) {
      try {
        const data = await settleRes.json()
        setSettlement({
          total_sessions: data.total_sessions ?? 0,
          total_gross: data.gross_total ?? 0,
          total_manager_amount: data.manager_amount ?? 0,
        })
      } catch { failures.push("정산") }
    } else {
      failures.push("정산")
    }

    if (attendRes?.ok) {
      try {
        const data = await attendRes.json()
        setAttendance((data.attendance ?? []).filter((a: AttendanceRecord) => a.status !== "off_duty"))
      } catch { failures.push("출근") }
    } else {
      failures.push("출근")
    }

    if (failures.length > 0) {
      setError(`일부 정보 로드 실패: ${failures.join(", ")}. 새로고침하면 재시도됩니다.`)
    }
    setLoading(false)
  }

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
          <span className="text-lg font-semibold">매니저 대시보드</span>
          <button
            onClick={async () => {
              try { await apiFetch("/api/auth/logout", { method: "POST" }) } catch { /* ignore */ }
              // Defence-in-depth: clear any residual client-side auth keys
              // from prior (pre-R-1-fix) sessions. Real auth lives in the
              // HttpOnly cookie which the logout endpoint already cleared.
              try {
                localStorage.removeItem("access_token")
                localStorage.removeItem("role")
                localStorage.removeItem("store_uuid")
                localStorage.removeItem("user_id")
                localStorage.removeItem("membership_id")
              } catch { /* ignore */ }
              router.push("/login")
            }}
            className="text-xs text-slate-400 hover:text-white"
          >
            로그아웃
          </button>
        </div>

        {/* 에러 */}
        {error && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        {/* 스태프 등록 버튼 — manager 전용 내부 생성 경로 바로가기 */}
        <div className="px-4 pt-4">
          <button
            onClick={() => router.push("/admin/members/create")}
            className="w-full rounded-2xl border border-pink-400/25 bg-pink-400/5 p-4 flex items-center justify-between hover:bg-pink-400/10 transition-colors"
          >
            <div className="text-left">
              <div className="text-sm font-medium text-pink-200">➕ 스태프 등록</div>
              <div className="text-[11px] text-slate-400 mt-1">
                내 담당 스태프를 직접 등록합니다. 등록 즉시 내 담당으로 배정됩니다.
              </div>
            </div>
            <span className="text-pink-300">›</span>
          </button>
        </div>

        {/* 미배정 스태프 — "내가 맡기" (T2 round).
            owner 가 만든 미배정 hostess 를 manager 본인이 직접 클릭으로
            담당 등록. PATCH /api/hostesses/:id/assign 이 본인(=manager)
            한정 self-assign 을 서버에서 재검증. */}
        <UnassignedClaimSection />


        {/* 요약 카드 */}
        <div className="px-4 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
              <div className="text-xs text-slate-400">담당 스태프</div>
              <div className="mt-1 text-3xl font-semibold text-cyan-300">
                {dashboard?.assigned_hostess_count ?? 0}
                <span className="text-base text-slate-400">명</span>
              </div>
            </div>
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <div className="text-xs text-slate-400">출근 현황</div>
              <div className="mt-1 text-3xl font-semibold text-emerald-300">
                {attendance.length}
                <span className="text-base text-slate-400">명</span>
              </div>
            </div>
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
              <div className="text-xs text-slate-400">오늘 세션</div>
              <div className="mt-1 text-3xl font-semibold text-amber-300">
                {settlement?.total_sessions ?? 0}
                <span className="text-base text-slate-400">건</span>
              </div>
            </div>
            <div className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-4">
              <div className="text-xs text-slate-400">실장 수익</div>
              <div className="mt-1 text-xl font-semibold text-purple-300">
                {fmtMan(settlement?.total_manager_amount ?? 0)}
              </div>
            </div>
          </div>
        </div>

        {/* 사장 열람 권한 설정 */}
        <div className="px-4 mb-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-sm font-medium text-slate-300 mb-3">사장 열람 권한</div>
            <div className="space-y-3">
              <label className="flex items-center justify-between">
                <span className="text-sm text-slate-400">실장 수익 공개</span>
                <button
                  disabled={visibilityLoading}
                  onClick={() => toggleVisibility("show_profit_to_owner", !showProfitToOwner)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${showProfitToOwner ? "bg-cyan-500" : "bg-slate-600"} ${visibilityLoading ? "opacity-50" : ""}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${showProfitToOwner ? "translate-x-5" : ""}`} />
                </button>
              </label>
              <label className="flex items-center justify-between">
                <span className="text-sm text-slate-400">스태프 수익 공개</span>
                <button
                  disabled={visibilityLoading}
                  onClick={() => toggleVisibility("show_hostess_profit_to_owner", !showHostessProfitToOwner)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${showHostessProfitToOwner ? "bg-cyan-500" : "bg-slate-600"} ${visibilityLoading ? "opacity-50" : ""}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${showHostessProfitToOwner ? "translate-x-5" : ""}`} />
                </button>
              </label>
            </div>
            <p className="text-[11px] text-slate-600 mt-2">ON 시 사장님이 해당 수익을 볼 수 있습니다.</p>
          </div>
        </div>

        {/* 진행 중 참여자 — 매칭 상태 */}
        {managedParticipants.length > 0 && (
          <div className="px-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-slate-300">진행 중 참여자</span>
              <span className="text-xs text-slate-500">{managedParticipants.length}명</span>
            </div>

            {(() => {
              const unmatched = managedParticipants.filter(p => p.match_status === "unmatched")
              const matched = managedParticipants.filter(p => p.match_status === "matched")
              return (
                <>
                  {unmatched.length > 0 && (
                    <div className="mb-3">
                      <div className="text-[11px] text-red-400 font-semibold mb-2">매칭 실패 · 수정 바람 ({unmatched.length})</div>
                      <div className="space-y-1.5">
                        {unmatched.map(p => (
                          <div key={p.id} className="rounded-xl border border-red-500/30 bg-red-500/5 p-3">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[8px] bg-red-500/80 text-white px-1 rounded font-bold">매칭실패</span>
                              {p.name_edited && <span className="text-[8px] bg-slate-500/60 text-slate-200 px-1 rounded">수정됨</span>}
                              <span className="text-[10px] text-slate-500 ml-auto">{p.working_store_name} · {p.room_name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                key={`mgr-name-${p.id}-${p.external_name ?? ""}`}
                                type="text"
                                defaultValue={p.external_name ?? ""}
                                placeholder="이름 입력"
                                onBlur={e => handleParticipantNameEdit(p.id, p.external_name, e.target.value)}
                                className="flex-1 bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/40"
                              />
                              <span className="text-[10px] text-slate-500 flex-shrink-0">{p.category}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {matched.length > 0 && (
                    <div>
                      <div className="text-[11px] text-emerald-400 font-semibold mb-2">매칭 완료 ({matched.length})</div>
                      <div className="space-y-1">
                        {matched.map(p => (
                          <div key={p.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 flex items-center gap-2">
                            <span className="text-sm text-white font-medium flex-1">{p.external_name || "?"}</span>
                            {p.name_edited && <span className="text-[8px] bg-slate-500/60 text-slate-200 px-1 rounded">수정됨</span>}
                            <span className="text-[10px] text-slate-500">{p.working_store_name} · {p.room_name}</span>
                            <span className="text-[10px] text-slate-500">{p.category}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        )}

        {/* 스태프 목록 */}
        <div className="px-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-slate-300">담당 스태프 목록</span>
            <span className="text-xs text-slate-500">{hostesses.length}명</span>
          </div>

          {hostesses.length === 0 && !error && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
              <div className="text-3xl mb-3">👤</div>
              <p className="text-slate-500 text-sm">담당 스태프가 없습니다.</p>
            </div>
          )}

          <div className="space-y-2">
            {hostesses.map((h) => (
              <div key={h.hostess_id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-purple-500/20 flex items-center justify-center text-sm text-purple-300 flex-shrink-0">
                  {(h.hostess_name || "?").slice(0, 1)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{h.hostess_name || h.hostess_id.slice(0, 8)}</div>
                  <div className="text-xs text-slate-500">{h.hostess_id.slice(0, 8)}</div>
                </div>
                <button
                  onClick={() => unassignSelf(h.hostess_id)}
                  disabled={unassignBusyId === h.hostess_id}
                  className="text-xs px-3 py-1.5 rounded-lg bg-white/5 text-slate-300 border border-white/10 hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/30 disabled:opacity-50 flex-shrink-0"
                >
                  {unassignBusyId === h.hostess_id ? "해제 중..." : "해제"}
                </button>
              </div>
            ))}
          </div>
          {unassignToast && (
            <div className="mt-3 text-[11px] text-emerald-300">{unassignToast}</div>
          )}
        </div>
      </div>

      {/* R28-refactor: ManagerBottomNav 로 분리 */}
      <ManagerBottomNav chatUnread={chatUnread} />
    </div>
  )
}

/**
 * 미배정 스태프 목록 + "내가 맡기" 버튼. manager 만 사용하는 컴포넌트로
 * 분리해 ManagerPage 의 상태 증가를 피한다. GET /api/hostesses/unassigned
 * 는 owner/manager/super_admin 모두 접근 가능하지만, PATCH assign 은
 * manager 가 self-assign 만 가능하도록 서버가 재검증한다.
 */
function UnassignedClaimSection() {
  type UnassignedHostess = {
    membership_id: string
    name: string
    stage_name: string | null
    phone: string | null
    created_at: string
  }
  const [list, setList] = useState<UnassignedHostess[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [toast, setToast] = useState<string>("")

  async function fetchList() {
    setLoading(true)
    try {
      const res = await apiFetch("/api/hostesses/unassigned")
      if (res.ok) {
        const d = await res.json()
        setList((d.hostesses ?? []) as UnassignedHostess[])
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  useEffect(() => {
    fetchList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function claim(h: UnassignedHostess) {
    setBusyId(h.membership_id)
    try {
      // manager_membership_id: null 를 보내면 서버가 auth.membership_id
      // 와 비교해 self-assign 만 허용. 대신 명시적으로 마커를 전달하고자
      // 빈 값 "" 을 보내 서버에서 string 아닌 값으로 거부당하지 않도록
      // 주의. 여기서는 null 을 보내서 자가지정 의도를 표현하되 서버는
      // string 이 아니면 400 으로 거절하므로, 대신 자신의 membership_id
      // 를 동봉해야 함 → useCurrentProfile 에서 가져오거나 별도 endpoint
      // 가 필요. 간단화를 위해 현재는 서버에 null 보내기보다, 클라이언트
      // 가 auth.membership_id 를 알 수 있는 경로를 이용한다.
      // useCurrentProfile 사용:
      const meRes = await apiFetch("/api/auth/me")
      if (!meRes.ok) {
        setToast("인증 정보를 불러오지 못했습니다.")
        setTimeout(() => setToast(""), 2500)
        return
      }
      const me = await meRes.json().catch(() => ({})) as { membership_id?: string }
      if (!me.membership_id) {
        setToast("membership_id 조회 실패")
        setTimeout(() => setToast(""), 2500)
        return
      }
      const res = await apiFetch(
        `/api/hostesses/${h.membership_id}/assign`,
        {
          method: "PATCH",
          body: JSON.stringify({ manager_membership_id: me.membership_id }),
        },
      )
      if (res.ok) {
        setToast("내 담당으로 등록")
        fetchList()
        setTimeout(() => setToast(""), 2000)
      } else {
        const body = await res.json().catch(() => ({}))
        setToast(body.message || "배정 실패")
        setTimeout(() => setToast(""), 3000)
      }
    } catch {
      setToast("서버 오류")
      setTimeout(() => setToast(""), 3000)
    } finally {
      setBusyId(null)
    }
  }

  if (!loading && list.length === 0) return null

  return (
    <div className="px-4 pt-3">
      <div className="rounded-2xl border border-pink-400/20 bg-pink-500/5 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium text-pink-200">미배정 스태프</div>
          <div className="text-[11px] text-slate-500">{list.length}명</div>
        </div>
        {loading && <div className="text-[11px] text-slate-500">로딩 중...</div>}
        <div className="space-y-2">
          {list.map((h) => (
            <div
              key={h.membership_id}
              className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-100 truncate">
                  {h.name}
                  {h.stage_name && (
                    <span className="ml-2 text-xs text-pink-300">@{h.stage_name}</span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500">
                  {h.phone ? `📞 ${h.phone} · ` : ""}
                  {new Date(h.created_at).toLocaleDateString("ko-KR")}
                </div>
              </div>
              <button
                onClick={() => claim(h)}
                disabled={busyId === h.membership_id}
                className="text-xs px-3 py-1.5 rounded-lg bg-pink-500/20 text-pink-200 border border-pink-500/30 hover:bg-pink-500/30 disabled:opacity-50"
              >
                {busyId === h.membership_id ? "처리 중..." : "내가 맡기"}
              </button>
            </div>
          ))}
        </div>
        {toast && (
          <div className="mt-3 text-[11px] text-emerald-300">{toast}</div>
        )}
      </div>

      {/* ROUND-CLEANUP-002: daily ops check gate */}
      <DailyOpsCheckGate />
    </div>
  )
}
