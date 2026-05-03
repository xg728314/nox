"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"
import { useCurrentProfile, invalidateCurrentProfile } from "@/lib/auth/useCurrentProfile"
import { usePagePerf } from "@/lib/debug/usePagePerf"
import OwnerQuickNav from "./components/OwnerQuickNav"
import DailyOpsCheckGate from "@/components/DailyOpsCheckGate"
// 2026-05-03: 분할 — 모달 + 직원/정산 sections.
import AssignManagerModal from "./AssignManagerModal"
import StaffOverviewSection from "./components/StaffOverviewSection"
import SettlementOverviewSection from "./components/SettlementOverviewSection"
import {
  UnassignedHostessSection,
  AssignedHostessSection,
} from "./components/HostessAssignmentSections"

type StoreProfile = {
  store_uuid: string
  store_name: string
  created_at: string
  role: string
  membership_status: string
  /** 2026-05-02 R-Cafe: 3 = 카페. 카페 owner 는 /cafe/manage 로 redirect. */
  floor?: number | null
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

  // 2026-05-01 R-StoreSwitch 복구: super_admin 의 전 매장 list (멤버십 없는
  //   매장도 cookie override 로 전환 가능). 운영자가 14매장 다 보던 기능 복구.
  const [allStores, setAllStores] = useState<Array<{
    store_uuid: string
    store_name: string
    floor_no: number | null
  }>>([])

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
  const isSuperAdmin = me?.is_super_admin === true
  const [viewRole, setViewRole] = useState<string>("")  // 비어있으면 본인 role 그대로
  const [contextSwitching, setContextSwitching] = useState(false)

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

        if (data.profile) {
          const prof = data.profile as StoreProfile
          // 2026-05-02 R-Cafe: 카페 owner 는 카페 전용 홈으로 redirect.
          //   profile.floor === 3 이면 NOX 일반 매장 owner UI 가 무관 (스태프/정산/실장 등).
          //   super_admin override 로 카페에 들어온 경우도 일관되게 카페 UI 보여줌.
          if (prof.floor === 3) {
            router.replace("/cafe/manage")
            return
          }
          setProfile(prof)
        }
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
        // 2026-05-02 R-Cafe: 카페 owner redirect (fallback path).
        if (data?.floor === 3) {
          router.replace("/cafe/manage")
          return
        }
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

  // 2026-05-01 R-StoreSwitch 복구: super_admin 이면 전 매장 list 도 fetch.
  //   /api/auth/memberships 는 본인 멤버십 매장만. super_admin 은 멤버십 없어도
  //   cookie override (active_store) 로 전환 가능 → 모든 매장 보여줘야 함.
  async function fetchAllStoresForSuperAdmin() {
    try {
      const res = await apiFetch("/api/super-admin/stores-list")
      if (res.ok) {
        const data = await res.json()
        setAllStores(data.stores ?? [])
      }
    } catch { /* silent */ }
  }
  useEffect(() => {
    if (isSuperAdmin) void fetchAllStoresForSuperAdmin()
  }, [isSuperAdmin])

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
    // 2026-04-30 (R-super-admin-view):
    //   super_admin 은 /api/auth/active-context 로 cookie override 만 설정 →
    //   logout 없이 즉시 새 매장 컨텍스트로 진입.
    //   비-super_admin (단일 매장 owner) 는 기존 switch-membership swap 후
    //   logout 흐름 유지.
    setSwitching(true)
    try {
      if (isSuperAdmin) {
        // 운영자 경로: cookie 만 갈아끼움. logout 없음.
        const res = await apiFetch("/api/auth/active-context", {
          method: "PUT",
          body: JSON.stringify({ store_uuid: m.store_uuid }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          setError(d.message || "매장 전환에 실패했습니다.")
          return
        }
        // /api/auth/me 의 in-memory 캐시 즉시 무효화. router.refresh() 로 RSC 재요청.
        invalidateCurrentProfile()
        router.refresh()
        // 또한 /counter 등 다른 화면에서 보이도록 페이지 reload.
        window.location.reload()
        return
      }

      // 비-super_admin: 기존 swap + logout 경로
      const res = await apiFetch("/api/auth/switch-membership", {
        method: "POST",
        body: JSON.stringify({ target_membership_id: m.membership_id }),
      })
      if (res.status === 401 || res.status === 403) {
        setError("매장 전환 권한이 없습니다. 다시 로그인 후 시도하세요.")
        router.push("/login")
        return
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.message || "매장 전환에 실패했습니다.")
        return
      }
      await apiFetch("/api/auth/logout", { method: "POST" })
      router.push("/login?switched=1")
    } catch {
      setError("서버 오류")
    } finally {
      setSwitching(false)
    }
  }

  /**
   * R-super-admin-view: 역할 view override. super_admin 만.
   *
   * 2026-04-30: 단순 reload 가 아니라 role 별 홈 페이지로 이동.
   *   /owner 는 owner-only 라 manager/staff view 로 바꾸면 middleware 가
   *   /counter 로 리다이렉트하는 어색한 상태가 됐다. 명시적으로 해당 role
   *   의 home 으로 라우팅해 메뉴/UI 가 자연스럽게 보이게 한다.
   *
   *   owner   → /owner
   *   manager → /manager
   *   staff   → /counter   (스태프는 카운터 위주 사용)
   *   hostess → /me
   *   ""(원래) → /owner    (cookie 삭제 후 본인 사장 권한)
   */
  async function handleSetViewRole(role: string) {
    if (!isSuperAdmin) return
    setContextSwitching(true)
    try {
      if (role === "") {
        await apiFetch("/api/auth/active-context", { method: "DELETE" })
        setViewRole("")
      } else {
        const res = await apiFetch("/api/auth/active-context", {
          method: "PUT",
          body: JSON.stringify({ role }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          setError(d.message || "역할 전환 실패")
          return
        }
        setViewRole(role)
      }
      invalidateCurrentProfile()
      // role 별 home 으로 hard navigation (캐시·middleware 양쪽 동시 갱신).
      const target =
        role === "manager" ? "/manager" :
        role === "staff"   ? "/counter" :
        role === "hostess" ? "/me" :
                             "/owner"
      window.location.href = target
    } catch {
      setError("서버 오류")
    } finally {
      setContextSwitching(false)
    }
  }

  // 2026-04-30: store_uuid 별 dedup. 한 매장에 owner + manager 처럼 복수
  //   role 멤버십이 있으면 React key 중복 + UX 혼선 (예: xg728314 의 마블).
  //   우선순위: owner > manager > staff > waiter > hostess.
  //   클릭 시 active-context 가 하나의 store 로만 전환하므로 매장당 1행이
  //   의미상으로도 정합.
  const ROLE_RANK: Record<string, number> = {
    owner: 0, manager: 1, staff: 2, waiter: 3, hostess: 4,
  }
  const dedupedMemberships = (() => {
    const byStore = new Map<string, StoreMembership>()
    for (const m of memberships) {
      const prev = byStore.get(m.store_uuid)
      if (!prev) { byStore.set(m.store_uuid, m); continue }
      const prevRank = ROLE_RANK[prev.role] ?? 99
      const curRank = ROLE_RANK[m.role] ?? 99
      if (curRank < prevRank) byStore.set(m.store_uuid, m)
    }
    return Array.from(byStore.values())
  })()
  const otherStores = dedupedMemberships.filter((m) => m.store_uuid !== currentStoreUuid)

  // 2026-05-01 R-StoreSwitch 복구: super_admin 이면 본인 멤버십 외 매장도 표시.
  //   본인 멤버십 매장 (otherStores) 는 위쪽에. 멤버십 없는 매장은 아래 별도
  //   섹션. 둘 다 "전환" 클릭 시 cookie override 로 전환 (super_admin 분기).
  const otherStoreUuidSet = new Set([currentStoreUuid, ...otherStores.map((m) => m.store_uuid)])
  const superAdminExtraStores = isSuperAdmin
    ? allStores.filter((s) => !otherStoreUuidSet.has(s.store_uuid))
    : []

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
        {/* 헤더
            2026-05-03: super_admin (운영자) 의 경우 헤더 자체를 [매장 선택 + 권한 선택]
              컨트롤로 만든다. 기존엔 헤더 아래에 별도 "🛡️ 운영자 모드" 패널 +
              "다른 매장으로 전환" 섹션 두 곳에 분산돼 있었는데, 운영자가 14매장
              + 카페까지 자주 옮겨다니는 작업 흐름에선 화면 상단 한 곳에서 즉시
              매장/권한을 갈아끼울 수 있어야 한다.

              매장 옵션: allStores (super_admin stores-list) — 카페 (floor=3) + 5/6/7/8층.
              권한 옵션: 사장 / 실장 / 스태프.
                "사장" = viewRole "" (원래 본인 권한 = super_admin → owner home).
                "실장" 선택 시 /manager 로, "스태프" 선택 시 /counter 로 hard navigate.
            비-super_admin 은 종전 헤더 유지. */}
        {isSuperAdmin ? (
          <div className="sticky top-0 z-40 bg-[#030814]/95 backdrop-blur border-b border-fuchsia-500/30 px-3 py-2.5 flex items-center gap-2 flex-wrap">
            <button
              onClick={() => router.push("/counter")}
              className="text-cyan-400 text-sm whitespace-nowrap"
            >←</button>
            <span className="text-[10px] px-2 py-0.5 rounded bg-fuchsia-500/25 text-fuchsia-100 font-semibold whitespace-nowrap">
              🛡️ 운영자
            </span>
            <span className="text-sm font-semibold text-fuchsia-50 truncate max-w-[140px]">
              {profile?.store_name ?? "-"}
            </span>

            <label className="flex items-center gap-1 ml-auto">
              <span className="text-[10px] text-fuchsia-300">매장</span>
              <select
                value={currentStoreUuid}
                onChange={(e) => {
                  const v = e.target.value
                  if (!v || v === currentStoreUuid) return
                  const target = allStores.find((s) => s.store_uuid === v)
                  if (!target) return
                  handleSwitchStore({
                    membership_id: target.store_uuid,
                    store_uuid: target.store_uuid,
                    store_name: target.store_name,
                    role: "owner",
                    is_primary: false,
                  } as StoreMembership)
                }}
                disabled={switching || allStores.length === 0}
                className="bg-[#0A1222] border border-fuchsia-500/30 text-fuchsia-100 text-xs rounded-lg px-2 py-1.5 disabled:opacity-50 [&>option]:bg-[#0A1222] max-w-[160px]"
              >
                {allStores.length === 0 ? (
                  <option value={currentStoreUuid}>
                    {profile?.store_name ?? "로딩…"}
                  </option>
                ) : (
                  allStores.map((s) => (
                    <option key={s.store_uuid} value={s.store_uuid}>
                      {s.floor_no === 3
                        ? "☕ 카페"
                        : s.floor_no
                          ? `${s.floor_no}층`
                          : "?"}{" · "}
                      {s.store_name}
                    </option>
                  ))
                )}
              </select>
            </label>

            <label className="flex items-center gap-1">
              <span className="text-[10px] text-fuchsia-300">권한</span>
              <select
                value={viewRole || "owner"}
                onChange={(e) => {
                  const v = e.target.value
                  handleSetViewRole(v === "owner" ? "" : v)
                }}
                disabled={contextSwitching}
                className="bg-[#0A1222] border border-fuchsia-500/30 text-fuchsia-100 text-xs rounded-lg px-2 py-1.5 disabled:opacity-50 [&>option]:bg-[#0A1222]"
              >
                <option value="owner">사장</option>
                <option value="manager">실장</option>
                <option value="staff">스태프</option>
              </select>
            </label>

            {(switching || contextSwitching) && (
              <span className="text-[10px] text-fuchsia-300 whitespace-nowrap">전환 중…</span>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
            <button
              onClick={() => router.push("/counter")}
              className="text-cyan-400 text-sm"
            >← 뒤로</button>
            <span className="font-semibold">매장관리</span>
            <div className="text-xs text-slate-400">사장</div>
          </div>
        )}

        {/* 에러 */}
        {error && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
        )}

        <div className="px-4 py-4 space-y-4">
          {/* 2026-05-03: 기존 "🛡️ 운영자 모드" 패널 (권한 view 4버튼) 은 상단
              StoreContextBar 의 inline 4-button 그룹으로 이동.
              어느 페이지에서든 1탭 전환 가능. 이 자리는 비움. */}

          {/* 매장 정보 — UUID 는 super_admin 에게만 노출 */}
          {profile ? (
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-2">
              <div className="text-xs text-slate-400">매장 정보</div>
              <div className="text-lg font-semibold text-cyan-300">{profile.store_name}</div>
              <div className="flex items-center gap-4 text-xs text-slate-400">
                {isSuperAdmin && <span>UUID: {profile.store_uuid.slice(0, 8)}</span>}
                <span>가입: {new Date(profile.created_at).toLocaleDateString("ko-KR")}</span>
              </div>
            </div>
          ) : !error && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
              <p className="text-slate-500 text-sm">매장 정보를 불러올 수 없습니다.</p>
            </div>
          )}

          {/* 매장 전환 — 본인 멤버십 매장 + (super_admin 면) 전 매장.
              2026-05-03: super_admin 은 상단 헤더 dropdown 에서 모든 매장 전환
              가능 → 이 섹션은 비-super_admin (다중 멤버십 owner/manager) 만
              필요. super_admin 면 숨겨서 화면을 단순화. */}
          {!isSuperAdmin && (otherStores.length > 0 || superAdminExtraStores.length > 0) && (
            <div className="space-y-2">
              <button
                onClick={() => setShowSwitcher(!showSwitcher)}
                className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-3 flex items-center justify-between hover:bg-white/[0.08] transition-colors"
              >
                <span className="text-sm text-slate-300">다른 매장으로 전환</span>
                <span className="text-xs text-slate-500">
                  {otherStores.length + superAdminExtraStores.length}개 매장 ▾
                </span>
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
                        <div className="text-xs text-slate-500">
                          {isSuperAdmin && <span>UUID: {m.store_uuid.slice(0, 8)} · </span>}
                          {m.role === "owner" ? "사장" : m.role === "manager" ? "실장" : "스태프"}
                        </div>
                      </div>
                      <span className="text-xs text-cyan-400">{switching ? "전환 중..." : "전환 →"}</span>
                    </button>
                  ))}

                  {/* 2026-05-01 R-StoreSwitch 복구:
                      super_admin 면 본인 멤버십 없는 매장도 cookie override 로
                      전환 가능. 14매장 전체 운영 모니터 정책. */}
                  {superAdminExtraStores.length > 0 && (
                    <div className="pt-2 mt-2 border-t border-fuchsia-500/20">
                      <div className="text-[10px] text-fuchsia-300/80 mb-2 px-1">
                        🛡️ 운영자 — 멤버십 없는 매장 (cookie override 전환)
                      </div>
                      {superAdminExtraStores.map((s) => (
                        <button
                          key={s.store_uuid}
                          onClick={() =>
                            handleSwitchStore({
                              membership_id: s.store_uuid,
                              store_uuid: s.store_uuid,
                              store_name: s.store_name,
                              role: "owner",
                              is_primary: false,
                            } as StoreMembership)
                          }
                          disabled={switching}
                          className="w-full rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/[0.05] p-4 flex items-center justify-between hover:bg-fuchsia-500/10 hover:border-fuchsia-500/40 transition-colors disabled:opacity-50 mb-2"
                        >
                          <div className="text-left">
                            <div className="text-sm font-medium text-fuchsia-100">
                              {s.floor_no ? `${s.floor_no}층 ` : ""}
                              {s.store_name}
                            </div>
                            <div className="text-xs text-fuchsia-400/70">
                              UUID: {s.store_uuid.slice(0, 8)} · 멤버십 없음 (운영자 권한)
                            </div>
                          </div>
                          <span className="text-xs text-fuchsia-300">
                            {switching ? "전환 중..." : "전환 →"}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 미배정 / 배정된 스태프 — extracted components */}
          <UnassignedHostessSection
            unassigned={unassigned}
            loading={unassignedLoading}
            onClickAssign={openAssignModal}
          />
          {assignToast && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 text-xs px-3 py-2">
              {assignToast}
            </div>
          )}
          <AssignedHostessSection
            assigned={assignedHostesses}
            expanded={expandAssigned}
            onToggle={() => setExpandAssigned((v) => !v)}
            busyId={unassignBusyId}
            onUnassign={unassignHostess}
          />

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

          {/* 빠른 이동 — R28-refactor: OwnerQuickNav 로 분리.
              2026-04-30: super_admin flag 전달 — "네트워크 맵" 같은
              운영자 전용 메뉴를 일반 사장에게 숨기기 위함. */}
          <OwnerQuickNav chatUnread={chatUnread} isSuperAdmin={isSuperAdmin} />

          {/* 스태프 현황 + 정산 개요 — extracted to dedicated components. */}
          <StaffOverviewSection
            staff={staff}
            expandStaff={expandStaff}
            onToggle={() => setExpandStaff((v) => !v)}
            attendanceOnCount={attendanceOnCount}
            error={error}
          />
          <SettlementOverviewSection
            overview={overview}
            expandSettlement={expandSettlement}
            onToggle={() => setExpandSettlement((v) => !v)}
            error={error}
          />
        </div>
      </div>

      {/* 실장 배정 모달 — extracted to AssignManagerModal */}
      {assignModalFor && (
        <AssignManagerModal
          hostess={assignModalFor}
          selectedManagerId={selectedManagerId}
          managerOptions={managerOptions.map((m) => ({ membership_id: m.membership_id, name: m.name }))}
          submitting={assignSubmitting}
          onClose={closeAssignModal}
          onSelect={setSelectedManagerId}
          onSubmit={submitAssign}
        />
      )}

      {/* ROUND-OPS-2: 하루 1회 운영 체크 강제 모달 */}
      <DailyOpsCheckGate />
    </div>
  )
}
