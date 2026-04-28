"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { useCurrentProfile } from "@/lib/auth/useCurrentProfile"
import { usePagePerf } from "@/lib/debug/usePagePerf"
import OwnerQuickNav from "./components/OwnerQuickNav"
import DailyOpsCheckGate from "@/components/DailyOpsCheckGate"

type StoreProfile = {
  store_uuid: string
  store_name: string
  created_at: string
  role: string
  membership_status: string
}

type StaffMember = {
  id: string
  membership_id: string
  name: string
  role: string
  status: string
}

type SettlementOverview = {
  hostess_id: string
  hostess_name: string
  has_settlement: boolean
  status: string | null
}

type StoreMembership = {
  membership_id: string
  store_uuid: string
  store_name: string
  role: string
  is_primary: boolean
}

export default function OwnerPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [profile, setProfile] = useState<StoreProfile | null>(null)
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [overview, setOverview] = useState<SettlementOverview[]>([])
  const [memberships, setMemberships] = useState<StoreMembership[]>([])
  const [showSwitcher, setShowSwitcher] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [chatUnread, setChatUnread] = useState(0)

  // 미배정 스태프 배정 섹션 (T2 round)
  type UnassignedHostess = {
    membership_id: string
    name: string
    stage_name: string | null
    phone: string | null
    created_at: string
  }
  const [unassigned, setUnassigned] = useState<UnassignedHostess[]>([])
  const [unassignedLoading, setUnassignedLoading] = useState(false)
  const [assignModalFor, setAssignModalFor] = useState<UnassignedHostess | null>(null)
  const [selectedManagerId, setSelectedManagerId] = useState<string>("")
  const [assignSubmitting, setAssignSubmitting] = useState(false)
  const [assignToast, setAssignToast] = useState<string>("")

  // T3: 배정된 스태프 list + 배정 해제 state.
  //   /api/store/staff?role=hostess 가 manager_membership_id / manager_name
  //   enrichment 를 포함하므로 기존 API 재사용으로 충분 (신규 API 없음).
  type AssignedHostess = {
    membership_id: string
    name: string
    manager_membership_id: string | null
    manager_name: string | null
  }
  const [assignedHostesses, setAssignedHostesses] = useState<AssignedHostess[]>([])
  const [unassignBusyId, setUnassignBusyId] = useState<string | null>(null)

  // Phase (2026-04-24): 섹션 접기/펼치기. 페이지가 너무 길어서 기본 접힘.
  //   회원 관리 + 빠른 이동 은 자주 쓰는 버튼이라 항상 펼친 상태 유지.
  const [expandAssigned, setExpandAssigned] = useState(false)
  const [expandStaff, setExpandStaff] = useState(false)
  const [expandSettlement, setExpandSettlement] = useState(false)
  // 출근 카운트 (스태프 현황 헤더 요약용). /api/attendance 에서 checked_out_at
  //   가 null 인 row 수.
  const [attendanceOnCount, setAttendanceOnCount] = useState<number | null>(null)

  const me = useCurrentProfile()
  const currentStoreUuid = me?.store_uuid ?? ""

  usePagePerf("owner")

  useEffect(() => {
    // Bootstrap-first: single fan-in call, fall back to legacy fetches per slot.
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch("/api/owner/bootstrap")
        if (cancelled) return
        if (res.status === 401 || res.status === 403) { router.push("/login"); return }
        if (!res.ok) {
          fetchAll()
          fetchMemberships()
          fetchChatUnread()
          return
        }
        const data = await res.json()
        const missing: string[] = []

        if (data.profile) setProfile(data.profile as StoreProfile)
        else missing.push("profile")

        if (Array.isArray(data.staff)) setStaff(data.staff as StaffMember[])
        else missing.push("staff")

        if (Array.isArray(data.overview)) setOverview(data.overview as SettlementOverview[])
        else missing.push("overview")

        if (Array.isArray(data.memberships)) setMemberships(data.memberships as StoreMembership[])
        else missing.push("memberships")

        if (typeof data.chat_unread === "number") setChatUnread(data.chat_unread)
        else missing.push("chat_unread")

        const needAll = missing.includes("profile") || missing.includes("staff") || missing.includes("overview")
        if (needAll) fetchAll()
        else setLoading(false)
        if (missing.includes("memberships")) fetchMemberships()
        if (missing.includes("chat_unread")) fetchChatUnread()
      } catch {
        if (cancelled) return
        fetchAll()
        fetchMemberships()
        fetchChatUnread()
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchChatUnread() {
    try {
      const res = await apiFetch("/api/chat/unread")
      if (res.ok) {
        const data = await res.json()
        setChatUnread(data.unread_count ?? 0)
      }
    } catch { /* ignore */ }
  }

  // 스태프 현황 헤더의 "출근 N" 요약용. /api/attendance 는 이미 /staff 에서도
  //   쓰는 기존 엔드포인트. 실패 시 null 유지 → UI 에서 배지 숨김.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch("/api/attendance")
        if (!res.ok || cancelled) return
        const data = await res.json()
        type A = { id: string; checked_out_at: string | null }
        const items = (data?.attendance ?? []) as A[]
        if (!cancelled) {
          setAttendanceOnCount(items.filter((a) => !a.checked_out_at).length)
        }
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [])

  async function fetchAll() {
    try {
      const [profileRes, staffRes, overviewRes] = await Promise.all([
        apiFetch("/api/store/profile"),
        apiFetch("/api/store/staff"),
        apiFetch("/api/store/settlement/overview"),
      ])

      if (profileRes.status === 401 || profileRes.status === 403) { router.push("/login"); return }

      if (profileRes.ok) {
        const data = await profileRes.json()
        setProfile(data)
      }

      if (staffRes.ok) {
        const data = await staffRes.json()
        setStaff(data.staff ?? [])
      }

      if (overviewRes.ok) {
        const data = await overviewRes.json()
        setOverview(data.overview ?? [])
      }

      if (!profileRes.ok && !staffRes.ok && !overviewRes.ok) {
        setError("데이터를 불러올 수 없습니다.")
      }
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  async function fetchMemberships() {
    try {
      const res = await apiFetch("/api/auth/memberships")
      if (res.ok) {
        const data = await res.json()
        setMemberships(data.memberships ?? [])
      }
    } catch { /* ignore */ }
  }

  // 미배정 스태프 조회 — 대시보드 진입 시 1회 + 배정 직후 재조회.
  async function fetchUnassigned() {
    setUnassignedLoading(true)
    try {
      const res = await apiFetch("/api/hostesses/unassigned")
      if (res.ok) {
        const data = await res.json()
        setUnassigned((data.hostesses ?? []) as UnassignedHostess[])
      }
    } catch { /* ignore */ }
    finally { setUnassignedLoading(false) }
  }

  // T3: 배정된 스태프 목록 — /api/store/staff?role=hostess 의 enrichment
  //   (manager_membership_id / manager_name) 를 활용. manager 가 지정된
  //   row 만 추려 displays.
  async function fetchAssignedHostesses() {
    try {
      const res = await apiFetch("/api/store/staff?role=hostess")
      if (res.ok) {
        const data = await res.json()
        type Row = {
          membership_id: string
          name: string
          manager_membership_id?: string | null
          manager_name?: string | null
        }
        const rows = ((data.staff ?? []) as Row[])
          .filter((r) => !!r.manager_membership_id)
          .map((r) => ({
            membership_id: r.membership_id,
            name: r.name,
            manager_membership_id: r.manager_membership_id ?? null,
            manager_name: r.manager_name ?? null,
          }))
        setAssignedHostesses(rows)
      }
    } catch { /* ignore */ }
  }

  // Mount: 미배정 + 배정됨 목록 1회 로드.
  useEffect(() => {
    fetchUnassigned()
    fetchAssignedHostesses()
  }, [])

  // T3: owner/super_admin 이 배정된 스태프를 해제. PATCH /api/hostesses/:id/assign
  //   { manager_membership_id: null } — 서버가 store scope 재검증 후 null 로 갱신.
  async function unassignHostess(h: AssignedHostess) {
    setUnassignBusyId(h.membership_id)
    try {
      const res = await apiFetch(
        `/api/hostesses/${h.membership_id}/assign`,
        {
          method: "PATCH",
          body: JSON.stringify({ manager_membership_id: null }),
        },
      )
      if (res.ok) {
        setAssignToast(`${h.name} 배정 해제 완료`)
        // 배정됨 목록에서 optimistic 제거 + 양쪽 재조회로 정합성 확정.
        setAssignedHostesses((prev) =>
          prev.filter((x) => x.membership_id !== h.membership_id),
        )
        fetchUnassigned()
        fetchAssignedHostesses()
        setTimeout(() => setAssignToast(""), 2000)
      } else {
        const body = await res.json().catch(() => ({}))
        setAssignToast(body.message || "해제 실패")
        setTimeout(() => setAssignToast(""), 3000)
      }
    } catch {
      setAssignToast("서버 오류")
      setTimeout(() => setAssignToast(""), 3000)
    } finally {
      setUnassignBusyId(null)
    }
  }

  function openAssignModal(h: UnassignedHostess) {
    setAssignModalFor(h)
    setSelectedManagerId("")
  }

  function closeAssignModal() {
    setAssignModalFor(null)
    setSelectedManagerId("")
  }

  async function submitAssign() {
    if (!assignModalFor || !selectedManagerId) return
    setAssignSubmitting(true)
    try {
      const res = await apiFetch(
        `/api/hostesses/${assignModalFor.membership_id}/assign`,
        {
          method: "PATCH",
          body: JSON.stringify({ manager_membership_id: selectedManagerId }),
        },
      )
      if (res.ok) {
        setAssignToast("배정 완료")
        closeAssignModal()
        fetchUnassigned()
        fetchAssignedHostesses()
        setTimeout(() => setAssignToast(""), 2000)
      } else {
        const body = await res.json().catch(() => ({}))
        setAssignToast(body.message || "배정 실패")
        setTimeout(() => setAssignToast(""), 3000)
      }
    } catch {
      setAssignToast("서버 오류")
      setTimeout(() => setAssignToast(""), 3000)
    } finally {
      setAssignSubmitting(false)
    }
  }

  // 현재 store 의 승인된 실장 목록 — 모달 드롭다운 데이터소스.
  const managerOptions = staff.filter(
    (s) => s.role === "manager" && s.status === "approved",
  )

  async function handleSwitchStore(m: StoreMembership) {
    // SECURITY (R-1 remediation): store_uuid/role cannot be stored client-side
    // anymore — they live in the HttpOnly session. The server needs to be
    // told which membership the caller wants to act as; we call a dedicated
    // switch endpoint if it exists, otherwise instruct the operator to
    // re-login with the target membership. (TODO: wire a proper
    // /api/auth/switch-membership endpoint.)
    setSwitching(true)
    try {
      // Fall back to a full logout + login round-trip to change scope.
      await apiFetch("/api/auth/logout", { method: "POST" })
    } finally {
      router.push("/login")
    }
  }

  const otherStores = memberships.filter((m) => m.store_uuid !== currentStoreUuid)

  const managerCount = staff.filter((s) => s.role === "manager").length
  const hostessCount = staff.filter((s) => s.role === "hostess").length
  const finalizedCount = overview.filter((o) => o.status === "finalized").length
  const draftCount = overview.filter((o) => o.status === "draft").length
  const noneCount = overview.filter((o) => !o.has_settlement).length

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
            onClick={() => router.push("/counter")}
            className="text-cyan-400 text-sm"
          >← 뒤로</button>
          <span className="font-semibold">매장관리</span>
          <div className="text-xs text-slate-400">사장</div>
        </div>

        {/* 에러 */}
        {error && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        <div className="px-4 py-4 space-y-4">
          {/* 매장 정보 */}
          {profile ? (
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-2">
              <div className="text-xs text-slate-400">매장 정보</div>
              <div className="text-lg font-semibold text-cyan-300">{profile.store_name}</div>
              <div className="flex items-center gap-4 text-xs text-slate-400">
                <span>UUID: {profile.store_uuid.slice(0, 8)}</span>
                <span>가입: {new Date(profile.created_at).toLocaleDateString("ko-KR")}</span>
              </div>
            </div>
          ) : !error && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
              <p className="text-slate-500 text-sm">매장 정보를 불러올 수 없습니다.</p>
            </div>
          )}

          {/* 매장 전환 */}
          {otherStores.length > 0 && (
            <div className="space-y-2">
              <button
                onClick={() => setShowSwitcher(!showSwitcher)}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-3 flex items-center justify-between hover:bg-white/[0.08] transition-colors"
              >
                <span className="text-sm text-slate-300">다른 매장으로 전환</span>
                <span className="text-xs text-slate-500">{otherStores.length}개 매장 ▾</span>
              </button>
              {showSwitcher && (
                <div className="space-y-2">
                  {otherStores.map((m) => (
                    <button
                      key={m.store_uuid}
                      onClick={() => handleSwitchStore(m)}
                      disabled={switching}
                      className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-4 flex items-center justify-between hover:bg-cyan-500/10 hover:border-cyan-500/20 transition-colors disabled:opacity-50"
                    >
                      <div className="text-left">
                        <div className="text-sm font-medium text-slate-200">{m.store_name}</div>
                        <div className="text-xs text-slate-500">UUID: {m.store_uuid.slice(0, 8)} · {m.role === "owner" ? "사장" : m.role === "manager" ? "실장" : "스태프"}</div>
                      </div>
                      <span className="text-xs text-cyan-400">{switching ? "전환 중..." : "전환 →"}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 미배정 스태프 배정 섹션 — T2 round.
              hostesses.manager_membership_id IS NULL 인 행을 노출하고
              실장 드롭다운으로 즉시 배정. 배정 완료 시 /api/manager/hostesses
              에 바로 나타난다. */}
          {unassigned.length > 0 && (
            <div className="rounded-2xl border border-pink-400/20 bg-pink-500/5 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-medium text-pink-200">미배정 스태프</div>
                <div className="text-[11px] text-slate-500">{unassigned.length}명</div>
              </div>
              <div className="space-y-2">
                {unassigned.map((h) => (
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
                      onClick={() => openAssignModal(h)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-pink-500/20 text-pink-200 border border-pink-500/30 hover:bg-pink-500/30"
                    >
                      실장 배정
                    </button>
                  </div>
                ))}
              </div>
              {unassignedLoading && (
                <div className="mt-2 text-[11px] text-slate-500">로딩 중...</div>
              )}
            </div>
          )}
          {assignToast && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 text-xs px-3 py-2">
              {assignToast}
            </div>
          )}

          {/* 배정된 스태프 — T3 round.
              현재 manager 가 지정된 hostess 를 나열. 각 row 에 "배정 해제"
              버튼으로 기존 PATCH /api/hostesses/:id/assign (manager_membership_id:null)
              재사용. 해제 직후 위 미배정 섹션으로 이동. */}
          {assignedHostesses.length > 0 && (
            <div className="rounded-2xl border border-purple-400/20 bg-purple-500/5 p-4">
              <button
                type="button"
                onClick={() => setExpandAssigned((v) => !v)}
                className="w-full flex items-center justify-between mb-0 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-xs">
                    {expandAssigned ? "▼" : "▶"}
                  </span>
                  <span className="text-sm font-medium text-purple-200">배정된 스태프</span>
                </div>
                <span className="text-[11px] text-slate-500">
                  총 {assignedHostesses.length}명
                </span>
              </button>
              {expandAssigned && (
                <div className="mt-3 space-y-2">
                  {assignedHostesses.map((h) => (
                    <div
                      key={h.membership_id}
                      className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-100 truncate">
                          {h.name}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          담당 실장: <span className="text-purple-300">{h.manager_name || h.manager_membership_id?.slice(0, 8) || "-"}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => unassignHostess(h)}
                        disabled={unassignBusyId === h.membership_id}
                        className="text-xs px-3 py-1.5 rounded-lg bg-white/5 text-slate-300 border border-white/10 hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/30 disabled:opacity-50"
                      >
                        {unassignBusyId === h.membership_id ? "해제 중..." : "배정 해제"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 회원 관리 섹션 — members-UI restructure round에서 분리.
              회원 생성 (privileged role) / 가입 승인 (hostess only) /
              계정 관리 (전체 role) 3개 페이지로 완전히 분할. 각 액션은
              별도 페이지에서 한 화면 한 동작으로 처리. */}
          <div className="mt-4 mb-2 text-xs uppercase tracking-wider text-cyan-300/70">
            회원 관리
          </div>
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: "회원 생성", path: "/admin/members/create", icon: "➕" },
              { label: "가입 승인", path: "/admin/approvals", icon: "✅" },
              { label: "계정 관리", path: "/admin/members", icon: "👥" },
            ].map((item) => (
              <button
                key={item.path}
                onClick={() => router.push(item.path)}
                className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-4 text-left hover:bg-cyan-400/10 transition-colors"
              >
                <div className="text-xl mb-1">{item.icon}</div>
                <div className="text-xs text-slate-300">{item.label}</div>
              </button>
            ))}
          </div>

          {/* 빠른 이동 — R28-refactor: OwnerQuickNav 로 분리 */}
          <OwnerQuickNav chatUnread={chatUnread} />

          {/* 스태프 현황 — 기본 접힘. 헤더에 총/실장/스태프/출근 요약. */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
            <button
              type="button"
              onClick={() => setExpandStaff((v) => !v)}
              className="w-full flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-2">
                <span className="text-slate-400 text-xs">
                  {expandStaff ? "▼" : "▶"}
                </span>
                <span className="text-sm font-medium text-slate-300">직원명단</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-slate-500">총 {staff.length}명</span>
                <span className="text-slate-600">·</span>
                <span className="text-blue-300">실장 {managerCount}</span>
                <span className="text-slate-600">·</span>
                <span className="text-purple-300">스태프 {hostessCount}</span>
                {attendanceOnCount !== null && (
                  <>
                    <span className="text-slate-600">·</span>
                    <span className="text-emerald-300">출근 {attendanceOnCount}</span>
                  </>
                )}
              </div>
            </button>

            {expandStaff && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-blue-500/10 p-3">
                    <div className="text-xs text-slate-400">실장</div>
                    <div className="mt-1 text-2xl font-semibold text-blue-300">{managerCount}</div>
                  </div>
                  <div className="rounded-xl bg-purple-500/10 p-3">
                    <div className="text-xs text-slate-400">스태프</div>
                    <div className="mt-1 text-2xl font-semibold text-purple-300">{hostessCount}</div>
                  </div>
                </div>

                {staff.length === 0 && !error && (
                  <div className="text-center py-4">
                    <p className="text-slate-500 text-sm">등록된 스태프가 없습니다.</p>
                  </div>
                )}

                {staff.length > 0 && (
                  <div className="space-y-2">
                    {staff.map((s) => (
                      <div key={s.membership_id} className="flex items-center justify-between py-2 border-t border-white/5">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs ${
                            s.role === "manager" ? "bg-blue-500/20 text-blue-300" : "bg-purple-500/20 text-purple-300"
                          }`}>
                            {(s.name || "?").slice(0, 1)}
                          </div>
                          <div>
                            <div className="text-sm">{s.name}</div>
                            <div className="text-xs text-slate-500">{s.role === "manager" ? "실장" : "스태프"}</div>
                          </div>
                        </div>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                          {s.status === "approved" ? "승인" : s.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* 정산 개요 — 기본 접힘. 헤더에 총/확정/대기/없음 요약. */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
            <button
              type="button"
              onClick={() => setExpandSettlement((v) => !v)}
              className="w-full flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-2">
                <span className="text-slate-400 text-xs">
                  {expandSettlement ? "▼" : "▶"}
                </span>
                <span className="text-sm font-medium text-slate-300">정산 개요</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-slate-500">총 {overview.length}명</span>
                <span className="text-slate-600">·</span>
                <span className="text-emerald-300">확정 {finalizedCount}</span>
                <span className="text-slate-600">·</span>
                <span className="text-amber-300">대기 {draftCount}</span>
                <span className="text-slate-600">·</span>
                <span className="text-slate-400">없음 {noneCount}</span>
              </div>
            </button>

            {expandSettlement && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl bg-emerald-500/10 p-3">
                    <div className="text-xs text-slate-400">확정</div>
                    <div className="mt-1 text-2xl font-semibold text-emerald-300">{finalizedCount}</div>
                  </div>
                  <div className="rounded-xl bg-amber-500/10 p-3">
                    <div className="text-xs text-slate-400">대기</div>
                    <div className="mt-1 text-2xl font-semibold text-amber-300">{draftCount}</div>
                  </div>
                  <div className="rounded-xl bg-white/[0.04] p-3">
                    <div className="text-xs text-slate-400">없음</div>
                    <div className="mt-1 text-2xl font-semibold text-slate-400">{noneCount}</div>
                  </div>
                </div>

                {overview.length === 0 && !error && (
                  <div className="text-center py-4">
                    <p className="text-slate-500 text-sm">정산 데이터가 없습니다.</p>
                  </div>
                )}

                {overview.length > 0 && (
                  <div className="space-y-2">
                    {overview.map((o) => (
                      <div key={o.hostess_id} className="flex items-center justify-between py-2 border-t border-white/5">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs ${
                            o.has_settlement
                              ? o.status === "finalized"
                                ? "bg-emerald-500/20 text-emerald-300"
                                : "bg-amber-500/20 text-amber-300"
                              : "bg-white/10 text-slate-500"
                          }`}>
                            {o.has_settlement ? (o.status === "finalized" ? "✓" : "◷") : "−"}
                          </div>
                          <div>
                            <div className="text-sm">{o.hostess_name || o.hostess_id.slice(0, 8)}</div>
                            <div className="text-xs text-slate-500">
                              {o.has_settlement
                                ? o.status === "finalized" ? "정산 확정" : "정산 대기"
                                : "정산 없음"}
                            </div>
                          </div>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          o.status === "finalized"
                            ? "bg-emerald-500/20 text-emerald-300"
                            : o.status === "draft"
                              ? "bg-amber-500/20 text-amber-300"
                              : "bg-white/10 text-slate-500"
                        }`}>
                          {o.status === "finalized" ? "확정" : o.status === "draft" ? "대기" : "없음"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* 실장 선택 모달 — T2 round. 미배정 스태프 1건에 실장을 배정. */}
      {assignModalFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-2xl border border-pink-400/25 bg-[#0A1222] p-5 space-y-3">
            <div>
              <div className="text-xs text-slate-400">실장 배정</div>
              <div className="text-base font-semibold text-pink-200 mt-0.5">
                {assignModalFor.name}
                {assignModalFor.stage_name && (
                  <span className="ml-2 text-xs text-pink-300">@{assignModalFor.stage_name}</span>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">실장 선택</label>
              <select
                value={selectedManagerId}
                onChange={(e) => setSelectedManagerId(e.target.value)}
                className="w-full bg-[#030814] border border-white/10 rounded-lg px-3 py-2 text-sm [&>option]:bg-[#030814]"
              >
                <option value="">실장을 선택하세요</option>
                {managerOptions.map((m) => (
                  <option key={m.membership_id} value={m.membership_id}>
                    {m.name || m.membership_id.slice(0, 8)}
                  </option>
                ))}
              </select>
              {managerOptions.length === 0 && (
                <p className="mt-1 text-[11px] text-amber-300/80">
                  승인된 실장이 없습니다. 먼저 실장 계정을 승인하세요.
                </p>
              )}
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={closeAssignModal}
                className="flex-1 h-10 rounded-xl bg-white/5 text-slate-300 text-sm border border-white/10"
                disabled={assignSubmitting}
              >
                취소
              </button>
              <button
                onClick={submitAssign}
                disabled={!selectedManagerId || assignSubmitting}
                className="flex-1 h-10 rounded-xl bg-pink-500/25 text-pink-100 text-sm font-medium border border-pink-500/40 disabled:opacity-50"
              >
                {assignSubmitting ? "배정 중..." : "확인"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ROUND-OPS-2: 하루 1회 운영 체크 강제 모달 */}
      <DailyOpsCheckGate />
    </div>
  )
}
