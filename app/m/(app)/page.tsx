"use client"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { TabBar } from "../_components/TabBar"
import { StatusCells } from "../_components/StatusCells"
import { ChatCard } from "../_components/ChatCard"
import { StaffCard } from "../_components/StaffCard"
import { SessionGroupCard } from "../_components/SessionGroupCard"
import { PushEnableBanner } from "../_components/PushEnableBanner"
import { AnomaliesBanner } from "../_components/AnomaliesBanner"
import { AssignFlowSheet } from "../_components/AssignFlowSheet"
import { ExtendEndSheet } from "../_components/ExtendEndSheet"
import { ExternalStaffAddSheet } from "../_components/ExternalStaffAddSheet"
import { fmtDateKo, fmtMoney } from "../_lib/format"
import { useMe, useHostesses, useChatRooms, useRooms, useAttendance, useIncomingStaff, useBuildingStores, useActiveRoomChats, type HostessPreview } from "../_hooks/useMobileData"
import { useAutoCloseExpired } from "../_hooks/useAutoCloseExpired"
import { invalidateApi } from "../_hooks/useApi"
import { apiFetch } from "@/lib/apiFetch"
import { cn } from "../_lib/cn"

/**
 * 홈 (대시보드) — /m
 *
 * 카드 구성:
 *   1. 헤더 (오늘 날짜 + 알림 종)
 *   2. 검색 바
 *   3. 채팅 strip (접기 가능, 펴면 4줄)
 *   4. 오늘 우리 스태프 카운트 (일하는중/대기/휴식 → 인라인 확장)
 *   5. 매장별 스태프 그리드 (4-col 컴팩트)
 *   6. 빠른 메이드 등록 (FAB)
 *   7. 하단 탭바
 */
export default function HomePage() {
  const me = useMe()
  const hostesses = useHostesses()
  const chats = useChatRooms()
  const rooms = useRooms()
  const attendance = useAttendance()
  const incoming = useIncomingStaff()
  const buildingStores = useBuildingStores()
  const roomChats = useActiveRoomChats()

  // R-attendance-enum-fix (2026-06-28): 사용자 보고 "대기 0" 인데 실제 대기
  //   14명. 원인: DB attendance.status 는 'available' / 'assigned' /
  //   'in_room' / 'off_duty' 값 저장 (staff_attendance 테이블). 클라 코드는
  //   'present' 체크 → 매칭 0건 → attendedSet 항상 empty → 대기 카운트 0.
  //   Fix: 'off_duty' 가 아니면 모두 출근으로 인식.
  const attendedSet = useMemo(() => {
    const s = new Set<string>()
    for (const a of attendance.data?.attendance ?? []) {
      if (a.status !== "off_duty") s.add(a.membership_id)
    }
    return s
  }, [attendance.data])

  const [chatCollapsed, setChatCollapsed] = useState(false)
  // R-grid-collapse (2026-06-28): 내 식구 그리드 접기/펴기. 채팅 strip 처럼.
  const [gridCollapsed, setGridCollapsed] = useState(false)
  const [activeFilter, setActiveFilter] = useState<"working" | "waiting" | "total" | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  // 10분 초과 자동 종료 + 최근 30분 자동 종료된 식구 목록
  const { recent: autoClosedRecent } = useAutoCloseExpired()

  // 2026-06-24 R-staff-assign-sheet: 홈에서 식구 카드 클릭 → 4-step 배정 시트.
  //   - 단일 클릭: 그 식구 1명만 선택 + 시트 오픈
  //   - 길게 누르면 multi-select 모드 → 여러 명 토글 → 하단 액션바 → 시트
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // R-checkout-mode (2026-06-28): 퇴근 일괄 처리 모드. ON 시 카드 클릭 = select,
  //   selectMode 와 동일한 selectedIds 사용. 하단 액션바에 [퇴근 N명] 표시.
  const [checkoutMode, setCheckoutMode] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [pendingIds, setPendingIds] = useState<string[]>([])
  const [pendingNames, setPendingNames] = useState<string[]>([])

  // 일하는 식구 탭 시 연장/종료 시트
  const [extendOpen, setExtendOpen] = useState(false)
  const [extendTarget, setExtendTarget] = useState<HostessPreview | null>(null)

  // 외부 식구 추가 시트
  const [externalAddOpen, setExternalAddOpen] = useState(false)

  // 채팅 미리보기 (최대 4개)
  //   2026-06-25 R-chat-collapse: 접기 = 매장 전체 (type=global) 채팅 1개만 표시.
  //     없으면 fallback 으로 첫 채팅. 평소엔 4개 (last_message_at 순 그대로).
  const chatPreview = useMemo(() => (chats.data?.rooms ?? []).slice(0, 4), [chats.data])
  const chatVisible = useMemo(() => {
    if (!chatCollapsed) return chatPreview
    const all = chats.data?.rooms ?? []
    const global = all.find((r) => r.type === "global")
    return global ? [global] : chatPreview.slice(0, 1)
  }, [chatCollapsed, chatPreview, chats.data])

  // 1초마다 갱신되는 \"now\" — 남은 시간 / 임박 카운트용
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000) // 30초 주기 충분
    return () => clearInterval(id)
  }, [])

  // 식구별 남은 분 (entered_at + time_minutes 기준)
  const remainingMinutesOf = useMemo(() => {
    const fn = (h: HostessPreview): number | null => {
      if (!h.is_working || !h.working_entered_at || !h.working_time_minutes) return null
      const enteredMs = new Date(h.working_entered_at).getTime()
      if (Number.isNaN(enteredMs)) return null
      const endMs = enteredMs + h.working_time_minutes * 60_000
      return Math.max(0, Math.round((endMs - nowTick) / 60_000))
    }
    return fn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowTick])

  // 스태프 통계 (active session 기준 — cross-store 포함)
  //   2026-06-24 R-cross-store-working: 본 매장 룸 카운트 대신
  //   hostess.is_working (서버에서 모든 매장의 active 세션 참여 여부) 사용.
  //   → 마블 식구가 아우라에서 일해도 working 으로 잡힘.
  //   2026-06-25 R-status-filter: endingSoon (10분 이내 종료) 카운트 추가.
  // R-attendance-aware-stats (2026-06-28): 대기 카운트가 attendance 와 무관해서
  //   퇴근 처리해도 안 줄어드는 버그 → attendance 반영.
  //   - 일하는중: is_working
  //   - 대기: 출근(attendedSet) + 일하는중 X — 일할 준비 된 식구
  //   - 결근(off): 출근 안 함 + 일하는중 X — 퇴근 처리된 식구
  //   - 총인원(출근): working + waiting (결근 제외)
  const stats = useMemo(() => {
    const all = hostesses.data?.hostesses ?? []
    let working = 0
    let waiting = 0
    let off = 0
    let endingSoon = 0
    for (const h of all) {
      if (h.is_working) {
        working++
        const rem = remainingMinutesOf(h)
        if (rem !== null && rem <= 10) endingSoon++
      } else if (attendedSet.has(h.membership_id)) {
        waiting++
      } else {
        off++
      }
    }
    const total = working + waiting  // 총 출근자 (결근 제외)
    return { working, waiting, total, off, endingSoon }
  }, [hostesses.data, attendedSet, remainingMinutesOf])

  // 매장 → 층 매핑 (정렬용)
  const floorByStore = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of buildingStores.data?.stores ?? []) {
      if (s.floor != null) m.set(s.store_uuid, s.floor)
    }
    return m
  }, [buildingStores.data])

  // 필터 적용된 식구 목록
  //   R-sort-working (2026-06-26): "일하는 중" 필터 시 정렬 — 곧 끝나는 식구 맨 앞,
  //   동률이면 working_store 의 층 오름차순 (5→8층).
  //   R-sort-all (2026-06-28): 사용자 요청 — "선택했을 때 정렬 잘 안 되는데
  //   일하는 건 맨 위로". 필터 무관 항상 is_working → waiting → off 순으로.
  const filteredHostesses = useMemo(() => {
    const all = hostesses.data?.hostesses ?? []

    // 정렬 헬퍼 — is_working 앞, 그 안에서 임박(남은분)→층→이름 순.
    const sortAll = (list: typeof all) =>
      [...list].sort((a, b) => {
        if (a.is_working !== b.is_working) return a.is_working ? -1 : 1
        if (a.is_working && b.is_working) {
          // 같은 세션 (같은 방/매장) 식구는 인접하게 — session_id 로 그룹핑
          if (a.working_session_id && b.working_session_id
              && a.working_session_id !== b.working_session_id) {
            // 세션끼리 임박 순
            const ra = remainingMinutesOf(a) ?? Number.POSITIVE_INFINITY
            const rb = remainingMinutesOf(b) ?? Number.POSITIVE_INFINITY
            if (ra !== rb) return ra - rb
            const fa = a.working_store_uuid ? (floorByStore.get(a.working_store_uuid) ?? 99) : 99
            const fb = b.working_store_uuid ? (floorByStore.get(b.working_store_uuid) ?? 99) : 99
            if (fa !== fb) return fa - fb
            return (a.working_session_id ?? "").localeCompare(b.working_session_id ?? "")
          }
          // 같은 세션 = 이름 순
          return (a.hostess_name ?? "").localeCompare(b.hostess_name ?? "")
        }
        // 둘 다 대기/결근 — 이름 순
        return (a.hostess_name ?? "").localeCompare(b.hostess_name ?? "")
      })

    if (!activeFilter) return sortAll(all)
    if (activeFilter === "working") return sortAll(all.filter((h) => h.is_working))
    if (activeFilter === "waiting") return sortAll(all.filter((h) => !h.is_working))
    if (activeFilter === "total") return sortAll(all)
    return sortAll(all)
  }, [hostesses.data, activeFilter, remainingMinutesOf, floorByStore])

  return (
    <div className="flex flex-col min-h-full text-[#2D2B26]">
      <header
        className="px-5 pt-3 pb-1 flex items-center justify-between"
        style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}
      >
        <div>
          <div className="text-[12px] font-semibold text-[#7A746A]">{fmtDateKo()}</div>
          {me.data?.full_name && (
            <div className="text-[14px] font-extrabold mt-0.5">{me.data.full_name} 실장님</div>
          )}
        </div>
        <button
          type="button"
          aria-label="알림"
          className="w-9 h-9 rounded-full bg-white border border-[#D8D2C8] flex items-center justify-center relative"
        >
          🔔
          {autoClosedRecent.length > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[9px] font-extrabold flex items-center justify-center">
              {autoClosedRecent.length}
            </span>
          )}
        </button>
      </header>

      {/* Push 알림 켜기 배너 (permission 미승인 + 미dismiss 시만) */}
      <div className="mx-5 mt-1">
        <PushEnableBanner />
        <AnomaliesBanner />
      </div>

      {/* 자동 종료 배너 — 최근 30분 내 10분 초과 자동 종료된 식구 */}
      {autoClosedRecent.length > 0 && !bannerDismissed && (
        <div className="mx-5 mt-1 mb-2 bg-red-50 border-2 border-red-300 rounded-2xl px-3 py-2.5 flex items-start gap-2 shadow-sm">
          <span className="text-[16px] leading-none mt-0.5">⏰</span>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-extrabold text-red-700 leading-tight">
              {autoClosedRecent.length}명 자동 종료 (시간 10분 초과)
            </div>
            <div className="text-[10px] font-bold text-red-700/80 mt-0.5 leading-snug">
              {autoClosedRecent.slice(0, 3).map((r) => `${r.hostess_name} (${r.store_name}, +${r.overdue_minutes}분)`).join(", ")}
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
      <Link
        href="/m/staff"
        className="mx-5 mb-3 mt-2 bg-white rounded-2xl px-4 py-3 flex items-center gap-2 border border-[#D8D2C8]/60 no-underline"
      >
        <span className="text-[14px]">🔍</span>
        <span className="flex-1 text-[12px] text-[#7A746A] font-semibold">이름 / 매장 / 종목 검색...</span>
        <span className="text-[10px] font-bold text-[#A87D45] bg-[#C49B61]/15 px-2 py-0.5 rounded-full">
          {stats.total}명
        </span>
      </Link>

      {/* 채팅 strip */}
      <section className="px-5 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-bold text-[#7A746A] uppercase tracking-wider flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" /> 채팅 · 실시간
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setChatCollapsed((v) => !v)}
              className="text-[10px] font-bold border border-[#D8D2C8] rounded-full px-2.5 py-0.5 text-[#7A746A]"
            >
              {chatCollapsed ? "▸ 펴기" : "▾ 접기"}
            </button>
            <Link href="/m/chat" className="text-[11px] font-bold text-[#A87D45] no-underline">
              전체 →
            </Link>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          {chats.isLoading && <SkelLine />}
          {chats.error && <ErrLine msg="채팅을 불러올 수 없습니다" />}
          {chatVisible.map((c) => (
            <ChatCard key={c.id} room={c} />
          ))}
          {!chatCollapsed && chatPreview.length === 0 && !chats.isLoading && (
            <div className="text-center text-[11px] text-[#7A746A] py-4">진행 중인 채팅 없음</div>
          )}
        </div>

        {/* R-room-chats (2026-06-26): 방번호별 채팅 — 각 방의 식구 + 외부 식구 + 담당 매니저 */}
        {!chatCollapsed && (roomChats.data?.rooms?.length ?? 0) > 0 && (
          <div className="mt-3">
            <div className="text-[10px] font-bold text-[#7A746A] uppercase tracking-wider mb-1.5 flex items-center gap-1">
              🚪 방별 채팅 (실시간 활성 룸)
            </div>
            <div className="flex flex-col gap-1.5">
              {(roomChats.data?.rooms ?? []).map((r) => (
                <RoomChatCard key={r.session_id} room={r} />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 오늘 우리 스태프 */}
      <section className="mx-5 mb-4 bg-white/70 rounded-2xl p-4 border border-[#D8D2C8]/50">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[13px] font-extrabold text-[#2D2B26]">오늘 우리 스태프</div>
          <span className="text-[10px] font-bold text-green-700 bg-green-500/15 px-2 py-0.5 rounded-full">
            ● 실시간
          </span>
        </div>
        <StatusCells
          working={stats.working}
          waiting={stats.waiting}
          total={stats.total}
          active={activeFilter}
          onClick={(s) => setActiveFilter((prev) => (prev === s ? null : s))}
          endingSoonCount={stats.endingSoon}
        />
        <div className="flex items-center justify-between mt-3 text-[10px] text-[#7A746A] font-semibold">
          <div>
            <b className="text-[#2D2B26]">{stats.total}</b> 식구 ·{" "}
            <b className="text-[#2D2B26]">{me.data?.store_name ?? "—"}</b>
          </div>
          <div>오늘 출근 {stats.working + stats.waiting}명</div>
        </div>
        {/* R-checkout-button (2026-06-28): 퇴근 일괄 처리 진입 버튼.
            누르면 checkoutMode ON → 식구 카드 클릭으로 선택 → 하단 액션바 [퇴근 N명]. */}
        <button
          type="button"
          onClick={() => {
            if (checkoutMode) {
              setCheckoutMode(false)
              setSelectedIds(new Set())
            } else {
              setCheckoutMode(true)
              setSelectMode(false)
              setSelectedIds(new Set())
            }
          }}
          className={cn(
            "w-full mt-3 rounded-xl py-2.5 text-[12px] font-extrabold border-2 transition-all",
            checkoutMode
              ? "bg-red-50 border-red-400 text-red-700"
              : "bg-white border-[#D8D2C8] text-[#7A746A] active:bg-[#FAF5EC]",
          )}
        >
          {checkoutMode
            ? `✕ 퇴근 모드 취소 (${selectedIds.size}명 선택)`
            : "🚪 퇴근 처리 — 식구 선택"}
        </button>
      </section>

      {/* 스태프 그리드 (4-col 컴팩트) */}
      <section className="px-5 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[13px] font-extrabold">
            내 식구 {hostesses.data?.hostesses.length ?? 0}명
            {activeFilter && (
              <span className="text-[10px] font-bold text-[#A87D45] ml-1.5">
                · {activeFilter === "working" ? "일하는 중" : activeFilter === "waiting" ? "대기" : "전체 (총인원)"} {filteredHostesses.length}명
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setGridCollapsed((v) => !v)}
              className="text-[10px] font-bold border border-[#D8D2C8] rounded-full px-2.5 py-0.5 text-[#7A746A]"
            >
              {gridCollapsed ? "▸ 펴기" : "▾ 접기"}
            </button>
            {activeFilter ? (
              <button
                type="button"
                onClick={() => setActiveFilter(null)}
                className="text-[11px] font-bold text-[#A87D45] no-underline"
              >
                ✕ 필터 해제
              </button>
            ) : (
              <Link href="/m/staff" className="text-[11px] font-bold text-[#A87D45] no-underline">
                전체 →
              </Link>
            )}
          </div>
        </div>
        {!gridCollapsed && activeFilter === "total" && (
          <div className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-xl px-3 py-1.5 mb-2 leading-snug">
            👉 카드를 탭하면 출근/결근 토글 — 출근 {attendedSet.size}명 / 총 {stats.total}명
            <br />· 일하는 중인 식구는 자동 출근으로 처리됨 (탭으로 결근 불가, 먼저 세션 종료)
          </div>
        )}
        {!gridCollapsed && hostesses.isLoading && <SkelGrid />}
        {!gridCollapsed && hostesses.error && <ErrLine msg="식구 목록을 불러올 수 없습니다" />}
        {!gridCollapsed && hostesses.data && filteredHostesses.length === 0 && (
          <div className="text-center text-[11px] text-[#7A746A] py-6 font-semibold">
            {activeFilter === "working" ? "지금 일하는 식구 없음" : activeFilter === "waiting" ? "대기 중인 식구 없음" : "등록된 식구 없음"}
          </div>
        )}
        {!gridCollapsed && hostesses.data && filteredHostesses.length > 0 && (
          <div
            className="grid grid-cols-4 max-[360px]:grid-cols-3 gap-1.5 max-h-[55vh] overflow-y-auto pr-1 -mr-1 pb-2"
          >
            {/* R-grid-scroll (2026-06-26): 필터 여부 무관 항상 max-h + scroll.
                이전엔 필터 활성 시만 적용 + 12명 slice 라 본 매장 20명 식구
                중 8명이 안 보였음. 이젠 전부 스크롤로 노출. */}
            {filteredHostesses.map((h) => {
              // R-session-group (2026-06-28): 같은 세션에서 함께 일하는 식구
              //   → SessionGroupCard 로 묶음. 첫 멤버일 때만 렌더, 나머지는 null.
              //   R-solo-group (2026-06-28): 사용자 요청 — 혼자여도 그룹 카드로
              //   (매장 · 종목 · 시간 뚜렷하게 보이게). min length 1.
              const sessId = h.working_session_id
              if (h.is_working && sessId) {
                const groupMembers = filteredHostesses.filter(
                  (x) => x.is_working && x.working_session_id === sessId,
                )
                if (groupMembers.length >= 1) {
                  if (groupMembers[0].membership_id !== h.membership_id) return null
                  const remainings = groupMembers
                    .map((m) => remainingMinutesOf(m))
                    .filter((r): r is number => typeof r === "number")
                  const minRemaining =
                    remainings.length > 0 ? Math.min(...remainings) : null
                  return (
                    <SessionGroupCard
                      key={`sess-${sessId}`}
                      sessionId={sessId}
                      storeName={h.working_store_name}
                      category={h.working_category}
                      startedAt={h.working_entered_at}
                      timeMinutes={h.working_time_minutes}
                      remainingMinutes={minRemaining}
                      members={groupMembers.map((m) => ({
                        membershipId: m.membership_id,
                        name: m.hostess_name,
                      }))}
                      selectedIds={
                        selectMode || checkoutMode ? selectedIds : undefined
                      }
                      onTapMember={(mid) => {
                        const target = groupMembers.find(
                          (x) => x.membership_id === mid,
                        )
                        if (!target) return
                        if (checkoutMode) return // 일하는 중 → 퇴근 불가
                        if (selectMode) {
                          setSelectedIds((prev) => {
                            const n = new Set(prev)
                            if (n.has(mid)) n.delete(mid)
                            else n.add(mid)
                            if (n.size === 0) setSelectMode(false)
                            return n
                          })
                        } else if (activeFilter === "total") {
                          return // 일하는 중 → 출근 토글 불가
                        } else if (
                          target.working_participant_id &&
                          target.working_session_id
                        ) {
                          setExtendTarget(target)
                          setExtendOpen(true)
                        }
                      }}
                    />
                  )
                }
              }
              // 단독 카드 (그룹 아닌 경우) — 기존 StaffCard 로직 그대로
              return (
              <StaffCard
                key={h.membership_id}
                membershipId={h.membership_id}
                name={h.hostess_name}
                isMyStore
                storeLabel={
                  activeFilter === "total"
                    ? (h.is_working ? "출근" : attendedSet.has(h.membership_id) ? "출근" : "결근")
                    : undefined  /* R-no-self-store-label (2026-06-26): 본 매장 식구는
                                    모두 같은 매장이라 라벨 불필요 — 정보 가림 방지 */
                }
                status={
                  activeFilter === "total"
                    ? (h.is_working || attendedSet.has(h.membership_id) ? "working" : "off")
                    : (h.is_working ? "working" : "waiting")
                }
                workingDetail={h.is_working ? {
                  storeName: h.working_store_name,
                  category: h.working_category,
                  remainingMinutes: remainingMinutesOf(h),
                  startedAt: h.working_entered_at,
                  timeMinutes: h.working_time_minutes,
                } : undefined}
                selected={(selectMode || checkoutMode) && selectedIds.has(h.membership_id)}
                onTap={async () => {
                  if (checkoutMode) {
                    // R-checkout-mode (2026-06-28): 퇴근 모드 — 카드 클릭 = 선택 토글.
                    //   일하는 중인 식구는 toggle 금지 (먼저 종료 후 퇴근).
                    if (h.is_working) return
                    setSelectedIds((prev) => {
                      const n = new Set(prev)
                      if (n.has(h.membership_id)) n.delete(h.membership_id)
                      else n.add(h.membership_id)
                      return n
                    })
                  } else if (selectMode) {
                    // 배정/종료 모드 — 토글
                    setSelectedIds((prev) => {
                      const n = new Set(prev)
                      if (n.has(h.membership_id)) n.delete(h.membership_id)
                      else n.add(h.membership_id)
                      if (n.size === 0) setSelectMode(false)
                      return n
                    })
                  } else if (activeFilter === "total") {
                    // 출근 모드 — 카드 탭으로 출근/결근 토글
                    //   일하는 중인 식구는 toggle 금지 (먼저 종료 후 결근)
                    if (h.is_working) {
                      return
                    }
                    const isAttended = attendedSet.has(h.membership_id)
                    try {
                      const res = await apiFetch("/api/attendance", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          membership_id: h.membership_id,
                          action: isAttended ? "checkout" : "checkin",
                        }),
                      })
                      if (res.ok) {
                        invalidateApi("/api/attendance")
                      }
                    } catch { /* swallow */ }
                  } else if (h.is_working && h.working_participant_id && h.working_session_id) {
                    // 일하는 식구 → 연장/종료 시트
                    setExtendTarget(h)
                    setExtendOpen(true)
                  } else {
                    // 대기 식구 → 배정 시트
                    setPendingIds([h.membership_id])
                    setPendingNames([h.hostess_name])
                    setSheetOpen(true)
                  }
                }}
                onLongPress={() => {
                  setSelectMode(true)
                  setSelectedIds((prev) => {
                    const n = new Set(prev)
                    n.add(h.membership_id)
                    return n
                  })
                }}
              />
              )
            })}
          </div>
        )}
      </section>

      {/* 🔄 외부 식구 — 타매장 식구가 본 매장에서 일하고 있는 내역 (실시간 모니터링).
          R-incoming-active-only (2026-06-26): 홈은 실시간 화면 — 종료된(status!='active')
          row 와 그 그룹이 전부 종료된 경우 제외. 정산 페이지(/m/settle)는 종료/정산 추적이
          필요하므로 그대로 전체 표시. */}
      {(() => {
        const rawGroups = incoming.data?.groups ?? []
        // active 참여자만 남기고, active 없는 그룹 제거
        const groups = rawGroups
          .map((g) => {
            const activeParts = g.participants.filter((p) => p.status === "active")
            if (activeParts.length === 0) return null
            const total_price = activeParts.reduce((a, p) => a + p.price_amount, 0)
            const total_hostess_payout = activeParts.reduce((a, p) => a + p.hostess_payout_amount, 0)
            const total_manager_payout = activeParts.reduce((a, p) => a + p.manager_payout_amount, 0)
            return {
              ...g,
              participants: activeParts,
              active_count: activeParts.length,
              finished_count: 0,
              total_price,
              total_hostess_payout,
              total_manager_payout,
            }
          })
          .filter(Boolean) as typeof rawGroups
        const totalCount = groups.reduce((a, g) => a + g.participants.length, 0)
        return (
        <section className="px-5 mb-4">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-[13px] font-extrabold">
              🔄 우리 매장 외부 식구 <span className="text-green-600">●</span> {totalCount}명 일하는 중
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setExternalAddOpen(true)}
                className="text-[10px] font-extrabold bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white rounded-full px-2.5 py-1"
              >
                + 추가
              </button>
              <Link href="/m/settle" className="text-[11px] font-bold text-[#A87D45] no-underline">
                정산보기 →
              </Link>
            </div>
          </div>
          <div className="text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-xl px-3 py-1.5 mb-2 leading-snug">
            타매장 식구가 우리 매장에서 일하면 여기 표시. 줄돈 = 원소속 매장 정산액.
          </div>
          {groups.length === 0 && (
            <div className="bg-white border border-[#D8D2C8]/60 rounded-2xl px-4 py-6 text-center">
              <div className="text-[14px] font-extrabold text-[#7A746A]">— 일하는 외부 식구 없음 —</div>
              <div className="text-[10px] font-semibold text-[#7A746A] mt-1">
                종료된 식구는 정산 페이지에서 확인
              </div>
            </div>
          )}
          <div className="space-y-2">
            {groups.map((g) => (
              <div
                key={`${g.origin_store_uuid}-${g.origin_manager_membership_id ?? "x"}`}
                className="bg-white rounded-2xl border border-[#D8D2C8]/60 overflow-hidden"
              >
                <div className="px-3 py-2 bg-gradient-to-br from-[#FAF5EC] to-[#F0E8D8] flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[12px] font-extrabold tracking-tight text-[#2D2B26]">
                      {g.origin_store_name}
                      <span className="text-[9px] text-[#7A746A] font-bold ml-1.5">
                        · {g.origin_manager_name ?? "미배정"} 실장
                      </span>
                    </div>
                    <div className="text-[9px] font-bold text-green-700 mt-0.5">
                      <span className="inline-block w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse mr-1 align-middle" />
                      {g.active_count}명 일하는 중
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] font-bold text-red-700">
                      줄돈 {(g.total_hostess_payout / 10000).toFixed(0)}만
                    </div>
                  </div>
                </div>
                <div className="divide-y divide-[#D8D2C8]/40">
                  {g.participants.slice(0, 6).map((p) => {
                    const sameHostessActiveCount = g.participants.filter(
                      (x) => x.membership_id === p.membership_id && x.status === "active",
                    ).length
                    const isActive = p.status === "active"
                    return (
                      <button
                        type="button"
                        key={p.participant_id}
                        onClick={() => {
                          if (!isActive) return
                          // 외부 식구 active row 클릭 → ExtendEndSheet 오픈
                          //   working_session_id 는 incoming-staff 응답에 없어 별도 lookup 필요.
                          //   여기선 HostessPreview 가 아닌 minimal 타겟 구성.
                          setExtendTarget({
                            hostess_id: p.membership_id,
                            membership_id: p.membership_id,
                            hostess_name: p.hostess_name,
                            profile_id: null,
                            role: "hostess",
                            status: "approved",
                            manager_membership_id: g.origin_manager_membership_id,
                            origin_store_uuid: g.origin_store_uuid,
                            is_working: true,
                            working_store_uuid: me.data?.store_uuid ?? null,
                            working_store_name: me.data?.store_name ?? null,
                            working_category: p.category,
                            working_time_minutes: p.time_minutes,
                            working_entered_at: p.entered_at,
                            working_participant_id: p.participant_id,
                            working_session_id: p.session_id ?? "",
                          })
                          setExtendOpen(true)
                        }}
                        className="w-full flex items-center justify-between px-3 py-1.5 gap-2 text-left active:bg-[#FAF5EC] transition-colors disabled:opacity-60"
                        disabled={!isActive}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={cn(
                              "w-1.5 h-1.5 rounded-full shrink-0",
                              isActive ? "bg-green-500 animate-pulse" : "bg-[#94A3B8]",
                            )}
                          />
                          <div className="text-[11px] font-extrabold text-[#2D2B26] truncate">
                            {p.hostess_name}
                            {sameHostessActiveCount > 1 && (
                              <span className="text-[9px] font-extrabold text-red-600 ml-1">
                                ×{sameHostessActiveCount}연장
                              </span>
                            )}
                            <span className="text-[9px] font-bold text-[#A87D45] ml-1">
                              {p.category}{p.time_minutes != null && ` ${p.time_minutes}분`}
                            </span>
                          </div>
                        </div>
                        <div className="text-[9px] font-bold text-red-700 shrink-0">
                          {(p.hostess_payout_amount / 10000).toFixed(0)}만
                        </div>
                      </button>
                    )
                  })}
                  {g.participants.length > 6 && (
                    <div className="text-center text-[9px] font-bold text-[#7A746A] py-1">
                      외 {g.participants.length - 6}명
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
        )
      })()}

      <div className="flex-1" />

      {/* FAB */}
      <Link
        href="/m/assign"
        aria-label="메이드 등록"
        className="fixed bottom-20 right-5 w-14 h-14 rounded-full bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white text-2xl flex items-center justify-center shadow-lg no-underline z-20"
      >
        +
      </Link>

      {/* R-checkout-mode-bar (2026-06-28): 퇴근 모드 액션 바.
          선택된 식구 일괄 checkout POST. */}
      {checkoutMode && (
        <div
          className={cn(
            "fixed left-1/2 -translate-x-1/2 bottom-[80px] z-30",
            "bg-white rounded-2xl shadow-[0_8px_24px_rgba(45,43,38,0.18)] border border-[#D8D2C8]/60",
            "flex items-center gap-2 px-3 py-2",
          )}
        >
          <button
            type="button"
            onClick={() => {
              setCheckoutMode(false)
              setSelectedIds(new Set())
            }}
            className="text-[11px] font-extrabold text-[#7A746A] px-2"
          >
            취소
          </button>
          <div className="text-[12px] font-extrabold text-[#2D2B26]">
            {selectedIds.size}명 선택
          </div>
          <button
            type="button"
            disabled={selectedIds.size === 0}
            onClick={async () => {
              let ok = 0, fail = 0
              for (const mid of selectedIds) {
                try {
                  const res = await apiFetch("/api/attendance", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ membership_id: mid, action: "checkout" }),
                  })
                  if (res.ok) ok++; else fail++
                } catch { fail++ }
              }
              invalidateApi("/api/attendance")
              setCheckoutMode(false)
              setSelectedIds(new Set())
            }}
            className="bg-red-50 border-2 border-red-300 text-red-700 rounded-xl px-3 py-2 text-[11px] font-extrabold disabled:opacity-40"
          >
            🚪 퇴근 ({selectedIds.size})
          </button>
        </div>
      )}

      {/* 선택 모드 액션 바 — selectMode 일 때만 + FAB 위로 띄움 */}
      {selectMode && (
        <div
          className={cn(
            "fixed left-1/2 -translate-x-1/2 bottom-[80px] z-30",
            "bg-white rounded-2xl shadow-[0_8px_24px_rgba(45,43,38,0.18)] border border-[#D8D2C8]/60",
            "flex items-center gap-2 px-3 py-2",
          )}
        >
          <button
            type="button"
            onClick={() => {
              setSelectMode(false)
              setSelectedIds(new Set())
            }}
            className="text-[11px] font-extrabold text-[#7A746A] px-2"
          >
            취소
          </button>
          <div className="text-[12px] font-extrabold text-[#2D2B26]">
            {selectedIds.size}명 선택
          </div>
          {(() => {
            const all = hostesses.data?.hostesses ?? []
            const selectedList = all.filter((h) => selectedIds.has(h.membership_id))
            const workingSelected = selectedList.filter((h) => h.is_working)
            const waitingSelected = selectedList.filter((h) => !h.is_working)
            // 일하는 식구 1+ 선택 시 \"묶음 종료\" 버튼 추가 표시
            return (
              <>
                {waitingSelected.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setPendingIds(waitingSelected.map((h) => h.membership_id))
                      setPendingNames(waitingSelected.map((h) => h.hostess_name))
                      setSheetOpen(true)
                    }}
                    className="bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white rounded-xl px-3 py-2 text-[11px] font-extrabold"
                  >
                    배정 ({waitingSelected.length})
                  </button>
                )}
                {workingSelected.length > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      // 묶음 종료 — 각각 leave (정산 옵션 없이 그대로)
                      for (const h of workingSelected) {
                        if (!h.working_participant_id) continue
                        try {
                          await apiFetch(`/api/sessions/participants/${encodeURIComponent(h.working_participant_id)}/leave`, {
                            method: "POST",
                          })
                        } catch { /* best-effort */ }
                      }
                      invalidateApi("/api/manager/hostesses")
                      invalidateApi("/api/rooms")
                      setSelectMode(false)
                      setSelectedIds(new Set())
                    }}
                    className="bg-red-50 border-2 border-red-300 text-red-700 rounded-xl px-3 py-2 text-[11px] font-extrabold"
                  >
                    종료 ({workingSelected.length})
                  </button>
                )}
              </>
            )
          })()}
        </div>
      )}

      <AssignFlowSheet
        open={sheetOpen}
        onClose={() => {
          setSheetOpen(false)
          // 시트 닫히면 선택 해제
          if (selectMode) {
            setSelectMode(false)
            setSelectedIds(new Set())
          }
        }}
        hostessIds={pendingIds}
        hostessNames={pendingNames}
      />

      {extendTarget && extendTarget.working_participant_id && extendTarget.working_session_id && (
        <ExtendEndSheet
          open={extendOpen}
          onClose={() => {
            setExtendOpen(false)
            setExtendTarget(null)
          }}
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

      <ExternalStaffAddSheet
        open={externalAddOpen}
        onClose={() => setExternalAddOpen(false)}
      />

      <TabBar
        chatUnread={(chats.data?.rooms ?? []).some((c) => c.unread_count > 0)}
      />
    </div>
  )
}

function SkelLine() {
  return <div className="h-12 rounded-xl bg-[#EFEBE3] animate-pulse" />
}
function SkelGrid() {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="aspect-[1/1.4] rounded-2xl bg-[#EFEBE3] animate-pulse" />
      ))}
    </div>
  )
}
function ErrLine({ msg }: { msg: string }) {
  return <div className="text-center text-[11px] text-red-600 py-3 font-semibold">{msg}</div>
}

/**
 * R-room-chats (2026-06-26): 방별 채팅 카드. 클릭 → /m/chat/{chat_room_id}
 *   (chat_room_id 없으면 POST 로 자동 생성 후 이동)
 */
function RoomChatCard({ room }: { room: import("../_hooks/useMobileData").ActiveRoomChat }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const ext = room.participants.filter((p) => p.is_external)
  const own = room.participants.filter((p) => !p.is_external)
  async function open() {
    if (busy) return
    if (room.chat_room_id) {
      router.push(`/m/chat/${encodeURIComponent(room.chat_room_id)}`)
      return
    }
    setBusy(true)
    try {
      const res = await apiFetch("/api/chat/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "room_session", session_id: room.session_id }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j?.chat_room_id) {
        router.push(`/m/chat/${encodeURIComponent(j.chat_room_id)}`)
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      className="w-full bg-white border border-[#D8D2C8]/60 rounded-xl px-3 py-2 flex items-center gap-2 text-left active:bg-[#FAF5EC] transition-colors disabled:opacity-60"
    >
      <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#FAF5EC] to-[#F0E8D8] flex items-center justify-center shrink-0">
        <span className="text-[10px] font-extrabold text-[#A87D45]">
          {room.room_no ?? room.room_name.slice(0, 2)}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-extrabold text-[#2D2B26] truncate flex items-center gap-1">
          {room.room_name}
          <span className="text-[9px] text-[#7A746A] font-bold">
            · {room.participants.length}명
          </span>
          {ext.length > 0 && (
            <span className="text-[9px] font-extrabold text-[#A87D45] bg-[#C49B61]/15 px-1.5 py-0.5 rounded-full">
              외부 {ext.length}
            </span>
          )}
        </div>
        <div className="text-[10px] font-semibold text-[#7A746A] truncate mt-0.5">
          {own.length > 0 && `우리 ${own.map((p) => p.hostess_name).join(", ")}`}
          {ext.length > 0 && own.length > 0 && " · "}
          {ext.length > 0 && (
            <span className="text-[#A87D45]">
              {ext.map((p) => `${p.origin_store_name ?? "?"} ${p.hostess_name}`).join(", ")}
            </span>
          )}
        </div>
      </div>
      {room.unread_count > 0 && (
        <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-extrabold flex items-center justify-center">
          {room.unread_count > 99 ? "99+" : room.unread_count}
        </span>
      )}
    </button>
  )
}

// 출근중 카운트 placeholder — 실제 attendance API 연동은 next round
function _unused() {
  fmtMoney(0)
}
