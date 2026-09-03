"use client"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { TabBar } from "../_components/TabBar"
import { SosButton } from "../_components/SosButton"
import { AssignFlowSheet } from "../_components/AssignFlowSheet"
import { ExtendEndSheet } from "../_components/ExtendEndSheet"
import { fmtDateKo } from "../_lib/format"
import { useMe, useHostesses, useAttendance, useRooms, usePendingArrivals, useWaitlist, useServiceCalls, type HostessPreview } from "../_hooks/useMobileData"
import { PendingArrivalSheet } from "../_components/PendingArrivalSheet"
import { useAutoCloseExpired } from "../_hooks/useAutoCloseExpired"
import { invalidateApi } from "../_hooks/useApi"
import { useToast } from "../_components/Toast"
import { apiFetch } from "@/lib/apiFetch"
import { cn } from "../_lib/cn"

/**
 * 조판 — /m
 *
 * R-dispatch-view (2026-07-24): 프로토타입 참고본 layout 이식.
 *  - 상단 액션바 (컬럼 밀도 · 출근체크 · 영업종료 · 다크)
 *  - 필터 chips (전체 · 진행중 · 대기중 · 일중) — 프로토타입 매칭
 *  - 아가씨 row 리스트 (색 stripe + 상태 뱃지 + inline 상세)
 *    · 진행중 (green) : 방번호 · 시작~종료 시각 · 남은 분 · ⚠임박(≤10min)
 *    · 대기중 (yellow) : 대기중 · 배정 필요
 *    · 종료 (gray)    : 결근 or 최근 세션 종료
 *  - 컬럼 밀도 (1/2/3열) 는 정보 축약 정도 조절
 *
 *  이전 홈 대시보드 (채팅 strip · StatusCells 그리드 · 4열 스태프 grid ·
 *  외부 식구 section) 는 프로토타입에 대응 개념 없어 삭제.
 *  - 채팅: /m/chat 탭 별도
 *  - 외부 식구: /m/staff (외부조판) 탭에서 매장 전체 관측
 *  - 스탯: 필터 chips 카운트가 대체
 */

type FilterKey = "all" | "live" | "wait" | "onduty"
type ColKey = 1 | 2 | 3

type HostessState = "live" | "done" | "wait" | "off"

// R-dispatch-history (2026-07-24) — 프로토타입 3-state 매칭:
//   live  : is_working=true (현재 방중)
//   done  : 60분 내 세션 종료 (오늘 근무 이력 or 출근 상태)
//   wait  : 출근 상태 · 방중 아님 · 최근 종료도 아님
//   off   : 출근 안 함 · 오늘 세션 이력도 없음 (조판 제외)
// R-worked-today-inclusion (2026-08-23): today_session_count > 0 인 아가씨는
//   attendance 등록 안 됐어도 조판에 표시 (사용자 리포트: 24명 누락 문제).
//   퇴근·attendance 미등록이어도 오늘 참여했으면 done 으로.
function classify(h: HostessPreview, attendedSet: Set<string>, nowTs: number): HostessState {
  if (h.is_working) return "live"
  const attended = attendedSet.has(h.membership_id)
  const workedToday = (h.today_session_count ?? 0) > 0
  const lastLeft = h.last_left_at ? new Date(h.last_left_at).getTime() : 0
  const recentlyLeft = lastLeft && nowTs - lastLeft <= 60 * 60_000
  if (recentlyLeft) return "done"       // 방금 (60분 내) 나감 → done
  if (workedToday) return "done"        // attendance 없어도 오늘 세션 참여 → done
  if (attended) return "wait"           // attendance 만 있고 세션 이력 없음 → 대기
  return "off"
}

function fmtHM(iso: string | null | undefined): string {
  if (!iso) return "?"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "?"
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

export default function DispatchPage() {
  const me = useMe()
  const hostesses = useHostesses()
  const attendance = useAttendance()
  const roomsQ = useRooms()  // R-home-dashboard (2026-08-23): 매장 실시간 매출 · 방수
  const pendingArrivals = usePendingArrivals()
  const [pendingSheetOpen, setPendingSheetOpen] = useState(false)
  // R-waitlist + R-svc-calls (2026-09-04): 배지 count 만 표시
  const waitlistData = useWaitlist("building")
  const svcData = useServiceCalls("active")
  const waitlistCount = (waitlistData.data?.items ?? []).length
  const svcCount = (svcData.data?.items ?? []).length
  const { recent: autoClosedRecent } = useAutoCloseExpired()
  const toast = useToast()

  // R-drag-merge (2026-08-23): 다른 아가씨 카드 위에 드롭 → 병합 (from → into).
  //   confirm 후 POST /api/hostesses/{from}/merge · 성공 시 hostesses 리스트 갱신.
  const handleMergeDrop = async (
    from: { mid: string; name: string; storeUuid: string },
    into: { mid: string; name: string; storeUuid: string },
  ) => {
    if (from.mid === into.mid || from.storeUuid !== into.storeUuid) return
    const ok = window.confirm(
      `⚠️ 병합\n\n[${from.name}] → [${into.name}]\n\n` +
      `${from.name} 의 모든 세션 이력 · 정산 참조가 ${into.name} 로 옮겨집니다.\n` +
      `${from.name} 은(는) 삭제 마크됩니다.\n\n계속?`,
    )
    if (!ok) return
    try {
      const res = await apiFetch(`/api/hostesses/${from.mid}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ into_membership_id: into.mid, reason: "drag_merge_on_board" }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast(`병합 실패: ${j.message || j.error || res.status}`, "error")
        return
      }
      const c = j.counts || {}
      toast(
        `✓ ${from.name} → ${into.name} 병합 · 참여자 ${c.reassigned_participants ?? 0} · alias ${c.reassigned_aliases ?? 0}`,
        "success",
      )
      void invalidateApi("/api/building/hostesses")
      void invalidateApi("/api/manager/hostesses")
    } catch (e) {
      toast(`병합 실패: ${(e as Error).message}`, "error")
    }
  }

  // UI 상태
  const [filter, setFilter] = useState<FilterKey>("all")
  const [cols, setCols] = useState<ColKey>(1)
  const [q, setQ] = useState("")

  // 다크 모드 — /m 페이지 내 격리 (전역 아님).
  //   next-themes 연동은 별도 라운드. 여기선 페이지 컨테이너 로컬 토글.
  const [dark, setDark] = useState(false)

  // 컬럼 밀도 선택 모달
  const [colsModalOpen, setColsModalOpen] = useState(false)

  // 시트
  const [assignOpen, setAssignOpen] = useState(false)
  const [pendingIds, setPendingIds] = useState<string[]>([])
  const [pendingNames, setPendingNames] = useState<string[]>([])
  const [extendOpen, setExtendOpen] = useState(false)
  const [extendTarget, setExtendTarget] = useState<HostessPreview | null>(null)

  // 자동 종료 배너 dismiss
  const [bannerDismissed, setBannerDismissed] = useState(false)

  // 30초 tick — 남은 시간/임박 카운트 갱신
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const attendedSet = useMemo(() => {
    const s = new Set<string>()
    for (const a of attendance.data?.attendance ?? []) {
      if (a.status !== "off_duty") s.add(a.membership_id)
    }
    return s
  }, [attendance.data])

  const remainingMinutesOf = useMemo(() => {
    return (h: HostessPreview): number | null => {
      if (!h.is_working || !h.working_entered_at || !h.working_time_minutes) return null
      const enteredMs = new Date(h.working_entered_at).getTime()
      if (Number.isNaN(enteredMs)) return null
      const endMs = enteredMs + h.working_time_minutes * 60_000
      return Math.max(0, Math.round((endMs - nowTick) / 60_000))
    }
  }, [nowTick])

  // R-onduty-only (2026-07-24): 조판은 "출근한 아가씨" 만 표시.
  //   결근 (attended=false && !is_working && 오늘 세션 없음) 은 완전 제외.
  // R-worked-today-inclusion (2026-08-23): 오늘 세션 참여 이력이 있으면
  //   attendance 없어도 조판에 포함 (사용자 리포트: 오늘 근무했는데 카드 안 뜸).
  //   attendance 는 카운터 태블릿 출근체크로 등록되는데 · 실제 매장에서는
  //   실장이 채팅으로 바로 방 잡아 attendance 우회하는 경우가 흔함.
  const all = useMemo(() => {
    const raw = hostesses.data?.hostesses ?? []
    return raw.filter((h) =>
      h.is_working
      || attendedSet.has(h.membership_id)
      || (h.today_session_count ?? 0) > 0,
    )
  }, [hostesses.data, attendedSet])

  // 출근 시각 map (attendance.checked_in_at → 대기 duration 계산용)
  const checkedInAtMap = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const a of attendance.data?.attendance ?? []) {
      m.set(a.membership_id, a.checked_in_at)
    }
    return m
  }, [attendance.data])

  // R-duplicate-detect (2026-08-23): 같은 매장 내 같은 이름 여러 명 감지.
  //   동명이인일 수 있고 · 채팅 오탈자로 별도 등록됐을 수도 있음.
  //   조판에 붉은 "중복" 배지 · 클릭 시 rename / merge / cancel 액션.
  //   Map<membership_id, dupSiblingsList>.
  type Dup = { membership_id: string; hostess_name: string; origin_store_uuid: string | null; origin_store_name: string }
  const duplicateMap = useMemo(() => {
    const byKey = new Map<string, Dup[]>()
    for (const h of all) {
      const nm = (h.hostess_name ?? "").trim()
      if (!nm) continue
      const key = `${h.origin_store_uuid ?? ""}::${nm}`
      const arr = byKey.get(key) ?? []
      arr.push({
        membership_id: h.membership_id,
        hostess_name: nm,
        origin_store_uuid: h.origin_store_uuid ?? null,
        origin_store_name: (h as HostessPreview & { origin_store_name?: string }).origin_store_name ?? "",
      })
      byKey.set(key, arr)
    }
    const map = new Map<string, Dup[]>()
    for (const [, arr] of byKey) {
      if (arr.length < 2) continue
      for (const d of arr) {
        // 본인 제외한 sibling 리스트
        map.set(d.membership_id, arr.filter((x) => x.membership_id !== d.membership_id))
      }
    }
    return map
  }, [all])

  // R-custom-modal (2026-08-23): preview iframe 에서 window.prompt/confirm 이 blocked.
  //   custom modal state 로 대체 · React 관리.
  const [renameModal, setRenameModal] = useState<{ h: HostessPreview; value: string } | null>(null)
  const [mergeModal, setMergeModal] = useState<{ from: HostessPreview; into: Dup } | null>(null)

  const submitRename = async () => {
    if (!renameModal) return
    const { h, value } = renameModal
    const nn = value.trim()
    setRenameModal(null)
    if (!nn || nn === h.hostess_name) return
    try {
      const res = await apiFetch(`/api/hostesses/${h.membership_id}/rename`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_name: nn, reason: "duplicate_quick_rename" }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return toast(`이름 수정 실패: ${j.message || j.error || res.status}`, "error")
      toast(`이름 수정: ${h.hostess_name} → ${nn}`, "success")
      void invalidateApi("/api/manager/hostesses")
    } catch (e) {
      toast(`이름 수정 실패: ${(e as Error).message}`, "error")
    }
  }

  const submitMerge = async () => {
    if (!mergeModal) return
    const { from, into } = mergeModal
    setMergeModal(null)
    try {
      const res = await apiFetch(`/api/hostesses/${from.membership_id}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ into_membership_id: into.membership_id, reason: "duplicate_quick_merge" }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return toast(`병합 실패: ${j.message || j.error || res.status}`, "error")
      const c = j.counts || {}
      toast(
        `✓ 병합 완료 · 참여자 ${c.reassigned_participants ?? 0} · alias ${c.reassigned_aliases ?? 0} · 24시간 내 분리 가능`,
        "success",
      )
      void invalidateApi("/api/manager/hostesses")
      void invalidateApi("/api/building/hostesses")
    } catch (e) {
      toast(`병합 실패: ${(e as Error).message}`, "error")
    }
  }

  const handleQuickRename = (h: HostessPreview) => {
    setRenameModal({ h, value: h.hostess_name })
  }

  const handleQuickMerge = (from: HostessPreview, into: Dup) => {
    setMergeModal({ from, into })
  }

  // 카운트 (프로토타입 4-state: live · done · wait · off)
  const counts = useMemo(() => {
    let live = 0, done = 0, wait = 0
    for (const h of all) {
      const s = classify(h, attendedSet, nowTick)
      if (s === "live") live++
      else if (s === "done") done++
      else if (s === "wait") wait++
    }
    // R-worked-today-inclusion (2026-08-23): done 에 오늘 세션 참여자 (attendance 없어도) 포함됨.
    //   "일중" = 오늘 뭐라도 한 사람 전체 = live + wait + done = all.
    //   "대기중" = 방 안 잡은 사람 = wait + done 유지 (done 이 부풀림).
    return { live, done, wait, all: live + done + wait, onduty: live + done + wait }
  }, [all, attendedSet, nowTick])

  // 필터 + 검색 + 정렬 (진행중 임박순 → 종료 → 대기)
  const filteredSorted = useMemo(() => {
    const norm = q.trim().toLowerCase()
    const withState = all.map((h) => ({ h, state: classify(h, attendedSet, nowTick) }))
    const filtered = withState.filter(({ h, state }) => {
      if (norm) {
        const name = (h.hostess_name ?? "").toLowerCase()
        if (!name.includes(norm)) return false
      }
      if (filter === "all") return true
      if (filter === "live") return state === "live"
      if (filter === "wait") return state === "wait" || state === "done"
      if (filter === "onduty") return state === "live" || state === "wait"
      return true
    })
    const order = { live: 0, done: 1, wait: 2, off: 3 } as const
    filtered.sort((a, b) => {
      if (order[a.state] !== order[b.state]) return order[a.state] - order[b.state]
      if (a.state === "live" && b.state === "live") {
        const ra = remainingMinutesOf(a.h) ?? 999
        const rb = remainingMinutesOf(b.h) ?? 999
        if (ra !== rb) return ra - rb
      }
      return (a.h.hostess_name ?? "").localeCompare(b.h.hostess_name ?? "")
    })
    return filtered
  }, [all, attendedSet, filter, q, remainingMinutesOf, nowTick])

  return (
    <div
      data-theme={dark ? "dark" : "light"}
      className={cn(
        "flex flex-col min-h-full transition-colors",
        dark ? "bg-[#0f0d0a] text-[#F2ECE0]" : "bg-[#F8F4ED] text-[#2D2B26]",
      )}
    >
      {/* 헤더 */}
      <header
        className={cn(
          "px-4 pt-3 pb-2 flex items-center justify-between",
          dark ? "text-[#F2ECE0]" : "text-[#2D2B26]",
        )}
        style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}
      >
        <div className="min-w-0">
          <div className={cn("text-[11px] font-semibold", dark ? "text-[#8A8578]" : "text-[#7A746A]")}>
            {fmtDateKo()}
          </div>
          {me.data?.full_name && (
            <div className="text-[14px] font-extrabold mt-0.5 truncate">
              {me.data.full_name} 실장님
            </div>
          )}
        </div>
        <button
          type="button"
          aria-label="알림"
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center relative border",
            dark ? "bg-[#1a1712] border-[#302a20]" : "bg-white border-[#D8D2C8]",
          )}
        >
          🔔
          {autoClosedRecent.length > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[9px] font-extrabold flex items-center justify-center">
              {autoClosedRecent.length}
            </span>
          )}
        </button>
      </header>

      <div className="px-4">
        <SosButton />
      </div>

      {/* 자동 종료 배너 */}
      {autoClosedRecent.length > 0 && !bannerDismissed && (
        <div className="mx-4 mt-1 mb-2 bg-red-50 border-2 border-red-300 rounded-2xl px-3 py-2 flex items-start gap-2">
          <span className="text-[15px] leading-none mt-0.5">⏰</span>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-extrabold text-red-700 leading-tight">
              {autoClosedRecent.length}명 자동 종료 (시간 10분 초과)
            </div>
            <div className="text-[10px] font-bold text-red-700/80 mt-0.5 leading-snug">
              {autoClosedRecent
                .slice(0, 3)
                .map((r) => `${r.hostess_name} (${r.store_name}, +${r.overdue_minutes}분)`)
                .join(", ")}
              {autoClosedRecent.length > 3 && ` 외 ${autoClosedRecent.length - 3}명`}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            className="text-[12px] font-extrabold text-red-700 px-1.5 leading-none mt-0.5"
            aria-label="배너 닫기"
          >
            ✕
          </button>
        </div>
      )}

      {/* 검색 */}
      <div className="mx-4 mb-2 mt-1">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="아가씨 이름 검색"
          className={cn(
            "w-full rounded-2xl px-4 py-2.5 text-[13px] font-semibold border outline-none",
            dark
              ? "bg-[#1a1712] border-[#302a20] text-[#F2ECE0] placeholder:text-[#5a5348]"
              : "bg-white border-[#D8D2C8] placeholder:text-[#B0A99B]",
          )}
        />
      </div>

      {/* 액션 바: 다크 · 1/2/3열 · 출근체크 · 영업종료 */}
      <div className="mx-4 mb-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => setDark((v) => !v)}
          className={cn(
            "shrink-0 rounded-xl border px-3 py-1.5 text-[11px] font-extrabold inline-flex items-center gap-1.5",
            dark ? "bg-[#1a1712] border-[#302a20] text-[#F2ECE0]" : "bg-white border-[#D8D2C8] text-[#2D2B26]",
          )}
        >
          {dark ? "☀️ 라이트" : "🌙 다크"}
        </button>
        <button
          type="button"
          onClick={() => setColsModalOpen(true)}
          className={cn(
            "shrink-0 rounded-xl border px-3 py-1.5 text-[11px] font-extrabold inline-flex items-center gap-1.5",
            dark ? "bg-[#1a1712] border-[#302a20] text-[#F2ECE0]" : "bg-white border-[#D8D2C8] text-[#2D2B26]",
          )}
        >
          <span>▦ {cols}열</span>
          <span className="text-[9px] opacity-70">▾</span>
        </button>
        <Link
          href="/m/attendance"
          className={cn(
            "shrink-0 rounded-xl border px-3 py-1.5 text-[11px] font-extrabold no-underline inline-flex items-center gap-1.5",
            dark ? "bg-[#3a2f1a] border-[#5a4a2a] text-[#E0C89A]" : "bg-[#FBF6EC] border-[#C49B61]/40 text-[#8C6A3A]",
          )}
        >
          🧾 출근체크
          <span
            className={cn(
              "rounded-full text-[9px] font-black px-1.5 py-0.5",
              dark ? "bg-[#5a4a2a] text-[#F8E9C4]" : "bg-[#C49B61]/25 text-[#8C6A3A]",
            )}
          >
            {counts.all}
          </span>
        </Link>
        {/* R-pending-pool (2026-08-31): 도착 대기 배지. count>0 일 때만 노출. */}
        {(pendingArrivals.data?.count ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => setPendingSheetOpen(true)}
            className={cn(
              "shrink-0 rounded-xl border-2 px-3 py-1.5 text-[11px] font-extrabold inline-flex items-center gap-1.5 animate-pulse",
              "bg-amber-100 border-amber-400 text-amber-800",
            )}
          >
            🚪 도착 대기
            <span className="rounded-full text-[9px] font-black px-1.5 py-0.5 bg-amber-600 text-white">
              {pendingArrivals.data?.count}
            </span>
          </button>
        )}
        {/* R-waitlist (2026-09-04): 대기 board 진입 */}
        <Link
          href="/waitlist"
          className={cn(
            "shrink-0 rounded-xl border px-3 py-1.5 text-[11px] font-extrabold no-underline inline-flex items-center gap-1.5",
            dark ? "bg-[#3a2e1a] border-[#7a5c30] text-[#F5D9A8]" : "bg-[#C49B61]/15 border-[#A87D45] text-[#8C6A3A]",
          )}
        >
          📋 대기
          {waitlistCount > 0 && (
            <span className="rounded-full text-[9px] font-black px-1.5 py-0.5 bg-[#A87D45] text-white">
              {waitlistCount}
            </span>
          )}
        </Link>
        {/* R-svc-calls (2026-09-04): 서비스 콜 대시보드 진입 */}
        <Link
          href="/service"
          className={cn(
            "shrink-0 rounded-xl border px-3 py-1.5 text-[11px] font-extrabold no-underline inline-flex items-center gap-1.5",
            svcCount > 0
              ? "bg-yellow-100 border-yellow-400 text-yellow-800 animate-pulse"
              : (dark ? "bg-[#2e2e1a] border-[#7a7a30] text-[#F5E9A8]" : "bg-yellow-50 border-yellow-300 text-yellow-700"),
          )}
        >
          🛎 콜
          {svcCount > 0 && (
            <span className="rounded-full text-[9px] font-black px-1.5 py-0.5 bg-yellow-600 text-white">
              {svcCount}
            </span>
          )}
        </Link>
        <Link
          href="/operating-days"
          className={cn(
            "shrink-0 rounded-xl border px-3 py-1.5 text-[11px] font-extrabold no-underline",
            dark ? "bg-[#3d1c1f] border-[#6a2b32] text-[#F5A0A8]" : "bg-red-50 border-red-300 text-red-700",
          )}
        >
          🌙 영업종료
        </Link>
      </div>

      {/* R-home-dashboard (2026-08-23): 상단 4-cell 실시간 요약.
          사장/실장이 홈 진입 시 한눈에: 매출 · 활성 방수 · 방중 아가씨 · 손님.
          되돌리려면 이 커밋 revert. */}
      {(() => {
        const roomsData = roomsQ.data?.rooms ?? []
        const activeRooms = roomsData.filter((r) => r.session)
        const totalGross = activeRooms.reduce((s, r) => s + (r.session?.gross_total ?? 0), 0)
        const totalParticipants = activeRooms.reduce((s, r) => s + (r.session?.participant_count ?? 0), 0)
        const fmt = (n: number) => n >= 10000
          ? `${Math.floor(n / 10000)}만${n % 10000 === 0 ? "" : (Math.floor((n % 10000) / 1000) + "천")}원`
          : `${n.toLocaleString()}원`
        return (
          <div className="mx-4 mb-3 grid grid-cols-4 gap-1.5">
            <DashCell label="오늘 매출" value={totalGross > 0 ? fmt(totalGross) : "0원"} tone="gold" dark={dark} />
            <DashCell label="활성 방" value={`${activeRooms.length}방`} tone="green" dark={dark} />
            <DashCell label="방중 아가씨" value={`${totalParticipants}명`} tone="blue" dark={dark} />
            <DashCell label="출근" value={`${counts.all}명`} tone="neutral" dark={dark} />
          </div>
        )
      })()}

      {/* 필터 chips (프로토타입 매칭) — 출근한 아가씨만 (결근 제외).
          R-count-fix (2026-08-23): "일중" count 는 onduty (live+wait) 여야 함.
          이전엔 counts.all (live+done+wait) 로 잘못 표시되어 사용자 인지 혼동. */}
      <div className="mx-4 mb-3 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        <FilterChip label="전체" count={counts.all} active={filter === "all"} onClick={() => setFilter("all")} dark={dark} />
        <FilterChip label="진행중" count={counts.live} dot="live" active={filter === "live"} onClick={() => setFilter("live")} dark={dark} />
        <FilterChip label="대기중" count={counts.wait + counts.done} dot="wait" active={filter === "wait"} onClick={() => setFilter("wait")} dark={dark} />
        <FilterChip label="일중" count={counts.onduty} dot="onduty" active={filter === "onduty"} onClick={() => setFilter("onduty")} dark={dark} />
      </div>

      {/* 리스트 */}
      <main className="flex-1 overflow-y-auto px-4 pb-4">
        {hostesses.isLoading && (
          <div className="flex flex-col gap-1.5 pt-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className={cn("h-14 rounded-xl animate-pulse", dark ? "bg-[#1a1712]" : "bg-white/70")} />
            ))}
          </div>
        )}
        {hostesses.error && (
          <div className="text-center py-8 text-[13px] font-bold text-red-600">
            식구 목록을 불러올 수 없습니다.
          </div>
        )}
        {hostesses.data && filteredSorted.length === 0 && (
          <div className={cn("text-center py-8", dark ? "text-[#8A8578]" : "text-[#7A746A]")}>
            <div className="text-[13px] font-bold mb-1">
              {filter === "live" ? "지금 일하는 식구 없음"
                : filter === "wait" ? "대기 중인 식구 없음"
                  : "표시할 식구 없음"}
            </div>
            {/* R-empty-hint (2026-09-04): 활성방/외부식구 있으면 안내 배지.
                사용자 혼란 지점: "활성 방 5방 · 방중 2명" 인데 리스트 비어 보임.
                이유: 조판 홈 = 내 담당 아가씨. 외부 매장 식구는 /m/staff 노출. */}
            {filter === "all" && (roomsQ.data?.rooms ?? []).some((r) => r.session) && (
              <div className="text-[10px] font-semibold mt-2 leading-relaxed">
                이 화면은 <b>내 담당 아가씨</b> 만 표시.
                <br />활성 방/외부 매장 식구는{" "}
                <Link href="/m/staff" className={cn("underline no-underline", dark ? "text-[#F2ECE0]" : "text-[#2D2B26]")}>
                  외부조판
                </Link>{" "}
                또는{" "}
                <Link href="/m/settle" className={cn("underline no-underline", dark ? "text-[#F2ECE0]" : "text-[#2D2B26]")}>
                  정산
                </Link>{" "}
                에서 확인.
              </div>
            )}
          </div>
        )}
        {hostesses.data && filteredSorted.length > 0 && (
          <div
            className={cn(
              "grid gap-1.5",
              cols === 1 ? "grid-cols-1" : cols === 2 ? "grid-cols-2" : "grid-cols-3",
            )}
          >
            {filteredSorted.map(({ h, state }, idx) => (
              <HostessDispatchRow
                key={h.membership_id}
                index={idx + 1}
                hostess={h}
                state={state}
                remaining={state === "live" ? remainingMinutesOf(h) : null}
                waitStartIso={checkedInAtMap.get(h.membership_id) ?? null}
                nowTick={nowTick}
                dark={dark}
                cols={cols}
                onOpenExtend={() => { setExtendTarget(h); setExtendOpen(true) }}
                onOpenAssign={() => {
                  setPendingIds([h.membership_id])
                  setPendingNames([h.hostess_name])
                  setAssignOpen(true)
                }}
                onMergeDrop={(from) => handleMergeDrop(from, {
                  mid: h.membership_id,
                  name: h.hostess_name,
                  storeUuid: h.origin_store_uuid ?? "",
                })}
                duplicateSiblings={duplicateMap.get(h.membership_id) ?? []}
                onQuickRename={() => handleQuickRename(h)}
                onQuickMergeInto={(siblingMid) => {
                  const sib = (duplicateMap.get(h.membership_id) ?? []).find((x) => x.membership_id === siblingMid)
                  if (sib) handleQuickMerge(h, sib)
                }}
              />
            ))}
          </div>
        )}
      </main>

      <TabBar />

      {/* 시트 (기존 재사용) */}
      <AssignFlowSheet
        open={assignOpen}
        onClose={() => { setAssignOpen(false); setPendingIds([]); setPendingNames([]) }}
        hostessIds={pendingIds}
        hostessNames={pendingNames}
      />
      {/* R-pending-pool (2026-08-31): 도착 대기 → 방 배정 시트 */}
      <PendingArrivalSheet
        open={pendingSheetOpen}
        onClose={() => setPendingSheetOpen(false)}
      />
      {/* 컬럼 밀도 선택 모달 */}
      {colsModalOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-50"
            onClick={() => setColsModalOpen(false)}
          />
          <div
            className={cn(
              "fixed left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 rounded-2xl border p-3 z-50 w-[220px] shadow-2xl",
              dark ? "bg-[#1a1712] border-[#302a20] text-[#F2ECE0]" : "bg-white border-[#D8D2C8]",
            )}
          >
            <div className={cn("text-[13px] font-extrabold mb-2 text-center", dark ? "text-[#F2ECE0]" : "text-[#2D2B26]")}>
              컬럼 밀도 선택
            </div>
            <div className="flex flex-col gap-1.5">
              {([1, 2, 3] as const).map((c) => {
                const active = cols === c
                const label = c === 1 ? "1열 (넓게 · 기본)" : c === 2 ? "2열 (컴팩트)" : "3열 (요약)"
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => { setCols(c); setColsModalOpen(false) }}
                    className={cn(
                      "w-full rounded-lg border py-2 px-3 text-[12px] font-extrabold text-left inline-flex items-center gap-2",
                      active
                        ? dark ? "bg-[#F2ECE0] text-[#0f0d0a] border-[#F2ECE0]" : "bg-[#2D2B26] text-white border-[#2D2B26]"
                        : dark ? "bg-[#0f0d0a] text-[#F2ECE0] border-[#302a20]" : "bg-white text-[#2D2B26] border-[#D8D2C8]",
                    )}
                  >
                    <span className={cn("w-4 h-4 rounded-full border-2 flex items-center justify-center", active ? "border-current" : dark ? "border-[#5a5348]" : "border-[#B0A99B]")}>
                      {active && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
                    </span>
                    <span className="flex-1">{label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}

      {extendTarget && extendTarget.working_participant_id && extendTarget.working_session_id && (
        <ExtendEndSheet
          open={extendOpen}
          onClose={() => { setExtendOpen(false); setExtendTarget(null) }}
          membershipId={extendTarget.membership_id}
          hostessName={extendTarget.hostess_name}
          participantId={extendTarget.working_participant_id}
          sessionId={extendTarget.working_session_id}
          category={extendTarget.working_category ?? null}
          storeName={extendTarget.working_store_name ?? null}
          remainingMinutes={remainingMinutesOf(extendTarget)}
          startedAt={extendTarget.working_entered_at ?? null}
        />
      )}

      {/* R-custom-modal (2026-08-23): 이름 수정 modal · window.prompt 대체 */}
      {renameModal && (
        <div
          onClick={() => setRenameModal(null)}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl"
          >
            <div className="text-[13px] font-extrabold text-[#2D2B26] mb-2">
              ✏️ 이름 수정 · 현재: {renameModal.h.hostess_name}
            </div>
            <input
              autoFocus
              type="text"
              value={renameModal.value}
              onChange={(e) => setRenameModal((m) => (m ? { ...m, value: e.target.value } : m))}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); void submitRename() }
                else if (e.key === "Escape") setRenameModal(null)
              }}
              maxLength={40}
              className="w-full rounded-lg border border-[#C49B61] px-3 py-2 text-[13px] font-extrabold text-[#2D2B26] mb-3"
              placeholder="새 이름"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRenameModal(null)}
                className="flex-1 rounded-lg py-2 text-[12px] font-bold text-[#7A746A] bg-[#F3EEE3]"
              >취소</button>
              <button
                type="button"
                onClick={() => void submitRename()}
                className="flex-1 rounded-lg py-2 text-[12px] font-extrabold bg-[#C49B61] text-white"
              >저장</button>
            </div>
          </div>
        </div>
      )}

      {/* R-custom-modal (2026-08-23): 병합 confirm modal · window.confirm 대체 */}
      {mergeModal && (
        <div
          onClick={() => setMergeModal(null)}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl"
          >
            <div className="text-[13px] font-extrabold text-red-700 mb-2">⚠️ 병합 확인</div>
            <div className="text-[12px] text-[#2D2B26] mb-3 leading-relaxed">
              <b>[{mergeModal.from.hostess_name}]</b> → <b>[{mergeModal.into.hostess_name}]</b><br/>
              {mergeModal.from.hostess_name} 세션/정산 이력이 {mergeModal.into.hostess_name} 로 옮겨집니다.<br/>
              <span className="text-[10px] text-[#7A746A]">
                착오 시 24시간 내 분리 가능 · 이후 자동 정리.
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMergeModal(null)}
                className="flex-1 rounded-lg py-2 text-[12px] font-bold text-[#7A746A] bg-[#F3EEE3]"
              >취소</button>
              <button
                type="button"
                onClick={() => void submitMerge()}
                className="flex-1 rounded-lg py-2 text-[12px] font-extrabold bg-red-600 text-white"
              >병합 진행</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─────────────── 하위 컴포넌트 ─────────────── */

/**
 * R-home-dashboard (2026-08-23): 홈 top 4-cell 요약 셀.
 *   실 사용자 (사장/실장) 이 홈 진입 즉시 매장 상태 한눈에.
 *   되돌리려면 이 컴포넌트 사용부 (page 상단 dashboard block) 제거.
 */
function DashCell({ label, value, tone, dark }: {
  label: string; value: string; tone: "gold" | "green" | "blue" | "neutral"; dark: boolean
}) {
  const toneCls = tone === "gold"
    ? (dark ? "bg-[#3a2f1a] text-[#E0C89A] border-[#5a4a2a]" : "bg-[#FBF6EC] text-[#8C6A3A] border-[#C49B61]/40")
    : tone === "green"
      ? "bg-[#5FAB4E]/12 text-[#3E7A32] border-[#5FAB4E]/30"
      : tone === "blue"
        ? "bg-[#6B8AFD]/12 text-[#3E5EDB] border-[#6B8AFD]/30"
        : (dark ? "bg-[#1a1712] text-[#8A8578] border-[#302a20]" : "bg-white text-[#7A746A] border-[#D8D2C8]")
  return (
    <div className={cn("rounded-xl border px-1.5 py-1.5 text-center", toneCls)}>
      <div className="text-[9px] font-bold opacity-80">{label}</div>
      <div className="text-[11px] font-black leading-tight mt-0.5 truncate">{value}</div>
    </div>
  )
}

function FilterChip({
  label,
  count,
  active,
  dot,
  dark,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  dot?: "live" | "wait" | "onduty"
  dark: boolean
  onClick: () => void
}) {
  const dotColor =
    dot === "live" ? "bg-[#5FAB4E]"
      : dot === "wait" ? "bg-[#D9A557]"
        : dot === "onduty" ? "bg-[#C49B61]"
          : ""
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full px-3 py-1.5 border text-[11px] font-extrabold inline-flex items-center gap-1.5",
        active
          ? dark ? "bg-[#F2ECE0] text-[#0f0d0a] border-[#F2ECE0]" : "bg-[#2D2B26] text-white border-[#2D2B26]"
          : dark ? "bg-[#1a1712] text-[#F2ECE0] border-[#302a20]" : "bg-white text-[#2D2B26] border-[#D8D2C8]",
      )}
    >
      {dotColor && <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotColor)} />}
      <span>{label}</span>
      <span
        className={cn(
          "text-[10px] font-black",
          active
            ? dark ? "text-[#0f0d0a]/80" : "text-white/85"
            : dark ? "text-[#8A8578]" : "text-[#7A746A]",
        )}
      >
        {count}
      </span>
    </button>
  )
}

/**
 * R-drag-merge (2026-08-23): 조판에서 아가씨 카드를 다른 아가씨 카드 위로 드래그하면
 *   병합 (from → into). 오탈자로 별도 등록된 지언 을 지연 위에 drop 하면 병합.
 *   같은 매장 내에서만 · 자기 자신 drop 은 무시. onDrop 콜백이 confirm + API 호출.
 */
function DragMergeWrapper({
  children,
  membershipId,
  hostessName,
  storeUuid,
  onMergeDrop,
  className,
}: {
  children: React.ReactNode
  membershipId: string
  hostessName: string
  storeUuid: string
  onMergeDrop: (from: { mid: string; name: string; storeUuid: string }) => void
  className?: string
}) {
  const [over, setOver] = useState(false)
  return (
    <div
      className={cn(className, over && "ring-2 ring-red-500 rounded-xl")}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move"
        e.dataTransfer.setData(
          "application/x-nox-hostess",
          JSON.stringify({ mid: membershipId, name: hostessName, storeUuid }),
        )
      }}
      onDragOver={(e) => {
        // drop 대상은 preventDefault 로 허용 표시
        if (e.dataTransfer.types.includes("application/x-nox-hostess")) {
          e.preventDefault()
          e.dataTransfer.dropEffect = "move"
          if (!over) setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        try {
          const raw = e.dataTransfer.getData("application/x-nox-hostess")
          if (!raw) return
          const from = JSON.parse(raw) as { mid: string; name: string; storeUuid: string }
          if (from.mid === membershipId) return // 자기 자신
          if (from.storeUuid !== storeUuid) return // 다른 매장
          onMergeDrop(from)
        } catch { /* noop */ }
      }}
    >
      {children}
    </div>
  )
}

/**
 * R-duplicate-action (2026-08-23): 중복 이름 아가씨 인라인 액션 버튼.
 *   조판 이름 옆 붉은 "⚠" 배지 · 클릭 시 popup:
 *     - 이름 수정 (오탈자 정정)
 *     - 다른 동명 아가씨와 병합 (siblings 리스트에서 선택)
 *   siblings.length === 0 이면 표시 자체 안 함.
 */
function DuplicateActionButton({
  hostess: h,
  siblings,
  onRename,
  onMergeInto,
}: {
  hostess: HostessPreview
  siblings: Array<{ membership_id: string; hostess_name: string; origin_store_name: string }>
  onRename: () => void
  onMergeInto: (siblingMembershipId: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        className="shrink-0 text-[9px] font-black bg-red-100 text-red-700 border border-red-300 px-1.5 py-0.5 rounded-full"
        title={`중복 ${siblings.length + 1}명 · 클릭해서 정정`}
      >
        ⚠ 중복 {siblings.length + 1}
      </button>
      {open && (
        <div
          onClick={(e) => { e.stopPropagation(); setOpen(false) }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl"
          >
            <div className="text-[13px] font-extrabold text-[#2D2B26] mb-1">
              ⚠ 중복 이름 · {h.hostess_name}
            </div>
            <div className="text-[10px] text-[#7A746A] mb-3">
              같은 매장에 <b>{h.hostess_name}</b> 이 {siblings.length + 1}명 · 동명이인일 수도 있고 오탈자일 수도 있음.
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => { setOpen(false); onRename() }}
                className="w-full rounded-lg py-2 text-[12px] font-extrabold bg-amber-50 text-amber-800 border border-amber-300"
              >
                ✏️ 이름 수정 (오탈자 정정)
              </button>
              <div className="text-[10px] font-bold text-[#7A746A] mt-2 mb-1">
                병합 대상 선택 (선택한 아가씨로 세션/정산 이력 옮김):
              </div>
              {siblings.map((s) => (
                <button
                  key={s.membership_id}
                  type="button"
                  onClick={() => { setOpen(false); onMergeInto(s.membership_id) }}
                  className="w-full rounded-lg py-2 text-[11px] font-extrabold bg-red-50 text-red-700 border border-red-300"
                >
                  🔀 → {s.hostess_name} 로 병합
                </button>
              ))}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="w-full rounded-lg py-2 text-[11px] font-bold text-[#7A746A] bg-[#F3EEE3]"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function HostessDispatchRow({
  index,
  hostess: h,
  state,
  remaining,
  waitStartIso,
  nowTick,
  dark,
  cols,
  onOpenExtend,
  onOpenAssign,
  onMergeDrop,
  duplicateSiblings,
  onQuickRename,
  onQuickMergeInto,
}: {
  index: number
  hostess: HostessPreview
  state: HostessState
  remaining: number | null
  waitStartIso: string | null
  nowTick: number
  dark: boolean
  cols: ColKey
  onOpenExtend: () => void
  onOpenAssign: () => void
  onMergeDrop: (from: { mid: string; name: string; storeUuid: string }) => void
  duplicateSiblings: Array<{ membership_id: string; hostess_name: string; origin_store_uuid: string | null; origin_store_name: string }>
  onQuickRename: () => void
  onQuickMergeInto: (siblingMembershipId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [leavingId, setLeavingId] = useState<string | null>(null)

  const imminent = state === "live" && remaining !== null && remaining <= 10

  const stripe =
    state === "live" ? "border-l-[#5FAB4E]"
      : state === "done" ? "border-l-[#8A8578]"
        : state === "wait" ? "border-l-[#D9A557]"
          : "border-l-[#8A8578]"

  const stateLabel =
    state === "live" ? "방중"
      : state === "done" ? "종료"
        : state === "wait" ? "대기"
          : "결근"

  const statePill =
    state === "live"
      ? "bg-[#5FAB4E]/18 text-[#3E7A32]"
      : state === "done"
        ? dark ? "bg-[#302a20] text-[#8A8578]" : "bg-[#EDE7DA] text-[#7A746A]"
        : state === "wait"
          ? "bg-[#D9A557]/22 text-[#8C6A2A]"
          : dark
            ? "bg-[#302a20] text-[#8A8578]"
            : "bg-[#EDE7DA] text-[#7A746A]"

  const cardBase = cn(
    "rounded-xl border border-l-4 overflow-hidden active:opacity-70 transition",
    dark ? "bg-[#1a1712] border-[#302a20]" : "bg-white border-[#D8D2C8]",
    stripe,
  )

  const handleTap = () => {
    if (state === "live") onOpenExtend()
    else onOpenAssign()
  }

  // 대기 duration (분) — checked_in_at 기준 · done 상태는 last_left_at 기준
  const waitMin = useMemo(() => {
    let baseIso: string | null = null
    if (state === "done" && h.last_left_at) baseIso = h.last_left_at
    else if (state === "wait") baseIso = waitStartIso
    if (!baseIso) return null
    const t = new Date(baseIso).getTime()
    if (Number.isNaN(t)) return null
    return Math.max(0, Math.round((nowTick - t) / 60_000))
  }, [state, h.last_left_at, waitStartIso, nowTick])

  const todaySessions = h.today_sessions ?? []
  const todayStores = h.today_stores ?? []

  // per-row leave (참여자 개별 종료 — 프로토타입 [-] 버튼)
  const leaveParticipant = async (participantId: string) => {
    if (leavingId) return
    setLeavingId(participantId)
    try {
      await fetch(`/api/sessions/participants/${encodeURIComponent(participantId)}/leave`, { method: "POST" })
    } catch { /* silent — cache 자동 갱신 */ }
    finally { setLeavingId(null) }
  }

  // 3열 컴팩트 — 이름 + 매장 + 상태 + 남은분.
  //   사용자 요청: "3열 아가씨가 어느 가게에 있는지 표시" (2026-07-25)
  if (cols === 3) {
    return (
      <DragMergeWrapper
        membershipId={h.membership_id}
        hostessName={h.hostess_name}
        storeUuid={h.origin_store_uuid ?? ""}
        onMergeDrop={onMergeDrop}
      >
      <button type="button" onClick={handleTap} className={cn(cardBase, "w-full text-left px-2 py-2 flex flex-col gap-1")}>
        <div className="flex items-center gap-1 min-w-0">
          <span className={cn("text-[10px] font-black", dark ? "text-[#8A8578]" : "text-[#7A746A]")}>#{index}</span>
          <span className="text-[12px] font-extrabold truncate flex-1">{h.hostess_name}</span>
        </div>
        {/* 매장(+방번호) — live 이면 표시 · wait/done 는 생략 (공간 절약) */}
        {state === "live" && h.working_store_name && (
          <div className={cn("text-[10px] font-bold truncate", dark ? "text-[#F2ECE0]" : "text-[#2D2B26]")}>
            {h.working_store_name}
          </div>
        )}
        <div className="flex items-center gap-1">
          <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-black", statePill)}>
            {stateLabel}
          </span>
          {state === "live" && remaining !== null && (
            <span className={cn("text-[10px] font-black", imminent ? "text-red-600" : dark ? "text-[#F2ECE0]" : "text-[#2D2B26]")}>
              {remaining}분
            </span>
          )}
        </div>
      </button>
      </DragMergeWrapper>
    )
  }

  // 2열 컴팩트
  if (cols === 2) {
    return (
      <DragMergeWrapper
        membershipId={h.membership_id}
        hostessName={h.hostess_name}
        storeUuid={h.origin_store_uuid ?? ""}
        onMergeDrop={onMergeDrop}
      >
      <button type="button" onClick={handleTap} className={cn(cardBase, "w-full text-left px-2.5 py-2 flex flex-col gap-1")}>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={cn("text-[10px] font-black shrink-0", dark ? "text-[#8A8578]" : "text-[#7A746A]")}>#{index}</span>
          <span className="text-[13px] font-extrabold truncate flex-1">{h.hostess_name}</span>
          <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-black shrink-0", statePill)}>
            {stateLabel}
          </span>
        </div>
        {state === "live" && (
          <div className={cn("text-[10px] font-bold flex items-center gap-1", dark ? "text-[#8A8578]" : "text-[#7A746A]")}>
            <span className="truncate">
              {h.working_store_name || ""}{h.working_category ? ` · ${h.working_category}` : ""}
            </span>
            {remaining !== null && (
              <span className={cn("shrink-0 font-black", imminent ? "text-red-600" : dark ? "text-[#F2ECE0]" : "text-[#2D2B26]")}>
                {imminent && "⚠ "}{remaining}분
              </span>
            )}
          </div>
        )}
        {state === "wait" && (
          <div className={cn("text-[10px] font-bold", dark ? "text-[#8A8578]" : "text-[#7A746A]")}>대기중 · 배정 필요</div>
        )}
      </button>
      </DragMergeWrapper>
    )
  }

  // 1열 (기본 · 프로토타입 매칭 · 정렬 강화)
  //   슬롯 폭 고정 → 모든 row 정렬됨:
  //     [▶ 14px] [● 8px] [# 20px 우정렬] [name flex-1] [🔀 auto] [pill ml-auto] [warn? auto]
  return (
    <DragMergeWrapper
      membershipId={h.membership_id}
      hostessName={h.hostess_name}
      storeUuid={h.origin_store_uuid ?? ""}
      onMergeDrop={onMergeDrop}
    >
    <div className={cn(cardBase, "text-left")}>
      {/* R-hydration-fix (2026-08-31): button 안에 DuplicateActionButton (button)
          + Link (a) 가 들어가 button-in-button 해서 hydration 실패 → 페이지
          전체 클릭 죽음. div role=button 으로 전환 · Enter/Space 지원 유지. */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleTap}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            handleTap()
          }
        }}
        className="w-full text-left px-3 py-2.5 cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          {/* ▶ chevron — 항상 자리 확보 (세션 이력 없으면 투명 placeholder) */}
          <span
            role={todaySessions.length > 0 ? "button" : undefined}
            tabIndex={todaySessions.length > 0 ? 0 : -1}
            onClick={(e) => {
              if (todaySessions.length === 0) return
              e.stopPropagation()
              setExpanded((v) => !v)
            }}
            className={cn(
              "w-3.5 shrink-0 text-[10px] transition-transform text-center",
              expanded ? "rotate-90" : "",
              todaySessions.length > 0
                ? (dark ? "text-[#8A8578] cursor-pointer" : "text-[#7A746A] cursor-pointer")
                : "opacity-0 cursor-default",
            )}
          >
            ▶
          </span>
          <span
            className={cn(
              "w-2 h-2 rounded-full shrink-0",
              state === "live" ? "bg-[#5FAB4E]"
                : state === "done" ? "bg-[#8A8578]"
                  : state === "wait" ? "bg-[#D9A557]"
                    : "bg-[#8A8578]",
            )}
          />
          <span className={cn("text-[11px] font-black shrink-0 tabular-nums w-5 text-right", dark ? "text-[#8A8578]" : "text-[#7A746A]")}>
            {index}
          </span>
          <span className="text-[14px] font-extrabold truncate min-w-0">
            <span className="underline underline-offset-2 decoration-dotted">{h.hostess_name}</span>
          </span>
          {/* R-duplicate-badge (2026-08-23): 같은 이름 다른 아가씨 있으면 중복 배지 · 클릭 시 액션 */}
          {duplicateSiblings.length > 0 && (
            <DuplicateActionButton
              hostess={h}
              siblings={duplicateSiblings}
              onRename={onQuickRename}
              onMergeInto={onQuickMergeInto}
            />
          )}
          <Link
            href={`/m/staff/${encodeURIComponent(h.membership_id)}`}
            onClick={(e) => e.stopPropagation()}
            aria-label="세부"
            className={cn(
              "shrink-0 text-[10px] px-1 rounded no-underline",
              dark ? "text-[#8A8578]" : "text-[#7A746A]",
            )}
          >
            🔀
          </Link>
          <span className={cn("ml-auto inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-black shrink-0", statePill)}>
            {state === "live" ? "● 방중"
              : state === "done" ? "✓ 종료"
                : state === "wait" ? (waitMin !== null ? `🕐 대기 ${waitMin}분` : "🕐 대기")
                  : "결근"}
          </span>
          {imminent && (
            <span className="shrink-0 inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-black bg-red-500 text-white animate-pulse">
              ⚠ {remaining}분
            </span>
          )}
        </div>

        {/* 2행: 상태별 상세 */}
        {state === "live" && (
          <div
            className={cn(
              "mt-1 pl-[64px] text-[11px] font-bold leading-tight",
              dark ? "text-[#8A8578]" : "text-[#7A746A]",
            )}
          >
            지금 · <b className={dark ? "text-[#F2ECE0]" : "text-[#2D2B26]"}>{h.working_store_name || "?"}</b>
            {h.working_category && <> · {h.working_category}</>}
            {h.working_entered_at && (
              <>
                {" · "}
                {fmtHM(h.working_entered_at)}
                {h.working_time_minutes && (
                  <>~{fmtHM(new Date(new Date(h.working_entered_at).getTime() + h.working_time_minutes * 60_000).toISOString())}</>
                )}
              </>
            )}
            {remaining !== null && !imminent && (
              <>
                {" · "}
                <b className={dark ? "text-[#F2ECE0]" : "text-[#2D2B26]"}>{remaining}분 남음</b>
              </>
            )}
          </div>
        )}
        {state === "done" && (
          <div className={cn("mt-1 pl-[64px] text-[11px] font-bold leading-tight", dark ? "text-[#8A8578]" : "text-[#7A746A]")}>
            ✓ {waitMin !== null && waitMin < 10 ? "방금 종료" : `종료 ${waitMin}분 전`} · 오늘 <b>{h.today_session_count ?? 0}건</b>
            {todayStores.length > 0 && (
              <> · <b className={dark ? "text-[#F2ECE0]" : "text-[#2D2B26]"}>{todayStores.slice(0, 4).join(" · ")}</b></>
            )}
          </div>
        )}
        {/* wait / off — 한 줄 표시. 상태 pill 이 이미 우측에 표시되므로 2번째 줄 생략 */}
      </div>

      {/* ad-detail — chevron 클릭 시 오늘 세션 이력 (프로토타입 매칭) */}
      {expanded && todaySessions.length > 0 && (
        <div className={cn("border-t px-3 py-2 flex flex-col gap-1", dark ? "border-[#302a20] bg-[#0f0d0a]" : "border-[#EDE7DA] bg-[#FAF5EC]/40")}>
          {(() => {
            // R-extend-count (2026-08-23): 미리 연장 횟수 표시.
            //   같은 방·같은 아가씨에 active 참여자 여러 개 = 미리 연장 (사전 예약).
            //   실수 여부 판단용 · 정확 카운트 노출.
            const activeCountByRoom = new Map<string, number>()
            for (const s of todaySessions) {
              if (s.status !== "active") continue
              activeCountByRoom.set(s.room_no ?? "?", (activeCountByRoom.get(s.room_no ?? "?") ?? 0) + 1)
            }
            const extendBadges = Array.from(activeCountByRoom.entries()).filter(([, cnt]) => cnt >= 2)
            if (extendBadges.length === 0) return null
            return (
              <div className="mb-1 flex flex-wrap gap-1">
                {extendBadges.map(([room, cnt]) => (
                  <span key={room} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black bg-[#DE8A3A]/18 text-[#8A5325] border border-[#DE8A3A]/40">
                    ⏩ {room}번방 미리 연장 {cnt - 1}회 (총 {cnt}건)
                  </span>
                ))}
              </div>
            )
          })()}
          {todaySessions.map((s) => {
            const roomLabel = `${s.store_name}${s.room_no ? s.room_no : ""}`
            const isActive = s.status === "active"
            const catLetter = s.category === "퍼블릭" ? "P" : s.category === "하퍼" ? "H" : s.category === "셔츠" ? "S" : null
            const catCls = catLetter === "P" ? "bg-[#6B8AFD]/22 text-[#3E5EDB]"
              : catLetter === "H" ? "bg-[#D97757]/22 text-[#A94B2A]"
                : catLetter === "S" ? "bg-[#D9A557]/22 text-[#8C6A2A]"
                  : "bg-[#8A8578]/22 text-[#7A746A]"
            // 진행중 세션 남은 분 계산
            const remainingMin = isActive && s.entered_at && s.time_minutes
              ? Math.max(0, Math.round((new Date(s.entered_at).getTime() + s.time_minutes * 60_000 - nowTick) / 60_000))
              : null
            // R-idle-after-end (2026-08-23): 진행 중이지만 예정 시간 지난 유휴 상태 계산.
            //   remainingMin === 0 & 실 종료 시각 지남 → 오버 얼마나 됐는지.
            const isOvertime = isActive && s.entered_at && s.time_minutes && remainingMin === 0
            const overtimeMin = isOvertime
              ? Math.max(0, Math.round((nowTick - (new Date(s.entered_at).getTime() + (s.time_minutes ?? 0) * 60_000)) / 60_000))
              : 0
            return (
              <div key={s.participant_id} className={cn("flex items-center gap-2 text-[11px] py-0.5", isActive && "bg-[#5FAB4E]/8 -mx-3 px-3 rounded")}>
                <span className={cn("font-mono font-bold shrink-0 w-10 text-right", dark ? "text-[#8A8578]" : "text-[#7A746A]")}>{fmtHM(s.entered_at)}</span>
                <span className={cn("truncate w-14 font-extrabold", dark ? "text-[#F2ECE0]" : "text-[#2D2B26]")}>{roomLabel}</span>
                {catLetter && (
                  <span className={cn("inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded text-[9px] font-black shrink-0", catCls)}>
                    {catLetter}
                  </span>
                )}
                {s.ticket && (
                  <span className={cn("text-[10px] font-bold shrink-0", dark ? "text-[#8A8578]" : "text-[#7A746A]")}>{s.ticket}</span>
                )}
                {isActive && (
                  <>
                    <button
                      type="button"
                      onClick={() => leaveParticipant(s.participant_id)}
                      disabled={leavingId === s.participant_id}
                      className={cn(
                        "shrink-0 rounded-full w-5 h-5 flex items-center justify-center text-[11px] font-black border transition",
                        dark ? "border-[#5a4a2a] text-[#E0C89A]" : "border-[#C49B61]/40 text-[#8C6A3A]",
                        leavingId === s.participant_id ? "opacity-40" : "",
                      )}
                      aria-label="종료"
                    >
                      {leavingId === s.participant_id ? "…" : "−"}
                    </button>
                    <span className={cn(
                      "ml-auto shrink-0 inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-black",
                      isOvertime
                        ? "bg-red-500/20 text-red-700 animate-pulse"
                        : remainingMin !== null && remainingMin <= 10
                          ? "bg-[#DE8A3A]/25 text-[#8A5325]"
                          : "bg-[#5FAB4E]/18 text-[#3E7A32]"
                    )}>
                      {/* R-idle-after-end: 오버 시 유휴 시간 표시 */}
                      {isOvertime
                        ? (overtimeMin === 0 ? "⚠ 방금 종료" : `⚠ 유휴 ${overtimeMin}분`)
                        : remainingMin !== null
                          ? (remainingMin <= 10 ? `${remainingMin}m` : `진행 ${remainingMin}분`)
                          : "진행중"}
                    </span>
                  </>
                )}
                {!isActive && (
                  <>
                    <span className="shrink-0 w-5"></span>
                    <span className={cn("ml-auto text-[9px] font-bold shrink-0", dark ? "text-[#5a5348]" : "text-[#B0A99B]")}>종료</span>
                  </>
                )}
              </div>
            )
          })}

          {/* 진행중 세션 경고 + 퇴근 버튼 (프로토타입 매칭) */}
          {state === "live" && (
            <>
              <div className={cn(
                "mt-1 text-[10px] font-bold px-2 py-1.5 rounded-md border-l-2 border-[#DE8A3A] flex items-start gap-1",
                dark ? "bg-[#3a2f1a] text-[#E0C89A]" : "bg-[#FBF6EC] text-[#8C6A3A]",
              )}>
                <span>⚠</span>
                <span>진행중 세션 있음 · 종료 후 퇴근 가능</span>
              </div>
              <button
                type="button"
                disabled={true}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "mt-1 w-full rounded-md py-2 text-[11px] font-black border-2 inline-flex items-center justify-center gap-1 opacity-50 cursor-not-allowed",
                  dark ? "border-[#302a20] text-[#8A8578] bg-[#0f0d0a]" : "border-[#D8D2C8] text-[#7A746A] bg-white",
                )}
              >
                🚪 퇴근
              </button>
            </>
          )}
          {state === "done" && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); alert("퇴근 처리 (정산으로 이동)") }}
              className={cn(
                "mt-1 w-full rounded-md py-2 text-[11px] font-black border-2 inline-flex items-center justify-center gap-1",
                dark ? "border-[#5a4a2a] text-[#E0C89A] bg-[#3a2f1a]" : "border-[#C49B61] text-[#8C6A3A] bg-[#FBF6EC]",
              )}
            >
              🚪 퇴근 · 정산 처리
            </button>
          )}
        </div>
      )}
    </div>
    </DragMergeWrapper>
  )
}
