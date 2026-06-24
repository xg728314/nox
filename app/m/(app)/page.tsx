"use client"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { TabBar } from "../_components/TabBar"
import { StatusCells } from "../_components/StatusCells"
import { ChatCard } from "../_components/ChatCard"
import { StaffCard } from "../_components/StaffCard"
import { AssignFlowSheet } from "../_components/AssignFlowSheet"
import { fmtDateKo, fmtMoney } from "../_lib/format"
import { useMe, useHostesses, useChatRooms, useRooms, type HostessPreview } from "../_hooks/useMobileData"
import { useAutoCloseExpired } from "../_hooks/useAutoCloseExpired"
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

  const [chatCollapsed, setChatCollapsed] = useState(false)
  const [activeFilter, setActiveFilter] = useState<"working" | "waiting" | "rest" | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  // 10분 초과 자동 종료 + 최근 30분 자동 종료된 식구 목록
  const { recent: autoClosedRecent } = useAutoCloseExpired()

  // 2026-06-24 R-staff-assign-sheet: 홈에서 식구 카드 클릭 → 4-step 배정 시트.
  //   - 단일 클릭: 그 식구 1명만 선택 + 시트 오픈
  //   - 길게 누르면 multi-select 모드 → 여러 명 토글 → 하단 액션바 → 시트
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [sheetOpen, setSheetOpen] = useState(false)
  const [pendingIds, setPendingIds] = useState<string[]>([])
  const [pendingNames, setPendingNames] = useState<string[]>([])

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
  const stats = useMemo(() => {
    const all = hostesses.data?.hostesses ?? []
    let working = 0
    let endingSoon = 0
    for (const h of all) {
      if (h.is_working) {
        working++
        const rem = remainingMinutesOf(h)
        if (rem !== null && rem <= 10) endingSoon++
      }
    }
    const total = all.length
    const waiting = Math.max(0, total - working)
    return { working, waiting, rest: 0, total, endingSoon }
  }, [hostesses.data, remainingMinutesOf])

  // 필터 적용된 식구 목록
  const filteredHostesses = useMemo(() => {
    const all = hostesses.data?.hostesses ?? []
    if (!activeFilter) return all
    if (activeFilter === "working") return all.filter((h) => h.is_working)
    if (activeFilter === "waiting") return all.filter((h) => !h.is_working)
    return [] // rest 는 아직 미구현
  }, [hostesses.data, activeFilter])

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
          rest={stats.rest}
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
      </section>

      {/* 스태프 그리드 (4-col 컴팩트) */}
      <section className="px-5 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[13px] font-extrabold">
            내 식구 {hostesses.data?.hostesses.length ?? 0}명
            {activeFilter && (
              <span className="text-[10px] font-bold text-[#A87D45] ml-1.5">
                · {activeFilter === "working" ? "일하는 중" : activeFilter === "waiting" ? "대기" : "휴식"} {filteredHostesses.length}명
              </span>
            )}
          </div>
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
        {hostesses.isLoading && <SkelGrid />}
        {hostesses.error && <ErrLine msg="식구 목록을 불러올 수 없습니다" />}
        {hostesses.data && filteredHostesses.length === 0 && (
          <div className="text-center text-[11px] text-[#7A746A] py-6 font-semibold">
            {activeFilter === "working" ? "지금 일하는 식구 없음" : activeFilter === "waiting" ? "대기 중인 식구 없음" : "휴식 중인 식구 없음"}
          </div>
        )}
        {hostesses.data && filteredHostesses.length > 0 && (
          <div className="grid grid-cols-4 max-[360px]:grid-cols-3 gap-1.5">
            {filteredHostesses.slice(0, 12).map((h) => (
              <StaffCard
                key={h.membership_id}
                membershipId={h.membership_id}
                name={h.hostess_name}
                isMyStore
                storeLabel={me.data?.store_name ?? undefined}
                status={h.is_working ? "working" : "waiting"}
                workingDetail={h.is_working ? {
                  storeName: h.working_store_name,
                  category: h.working_category,
                  remainingMinutes: remainingMinutesOf(h),
                  startedAt: h.working_entered_at,
                  timeMinutes: h.working_time_minutes,
                } : undefined}
                selected={selectMode && selectedIds.has(h.membership_id)}
                onTap={() => {
                  if (selectMode) {
                    // 토글
                    setSelectedIds((prev) => {
                      const n = new Set(prev)
                      if (n.has(h.membership_id)) n.delete(h.membership_id)
                      else n.add(h.membership_id)
                      if (n.size === 0) setSelectMode(false)
                      return n
                    })
                  } else {
                    // 단일 클릭 — 1명 시트
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
            ))}
          </div>
        )}
      </section>

      <div className="flex-1" />

      {/* FAB */}
      <Link
        href="/m/assign"
        aria-label="메이드 등록"
        className="fixed bottom-20 right-5 w-14 h-14 rounded-full bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white text-2xl flex items-center justify-center shadow-lg no-underline z-20"
      >
        +
      </Link>

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
          <button
            type="button"
            disabled={selectedIds.size === 0}
            onClick={() => {
              const list = (hostesses.data?.hostesses ?? []).filter((h) => selectedIds.has(h.membership_id))
              setPendingIds(list.map((h) => h.membership_id))
              setPendingNames(list.map((h) => h.hostess_name))
              setSheetOpen(true)
            }}
            className="bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white rounded-xl px-4 py-2 text-[12px] font-extrabold disabled:opacity-40"
          >
            묶어서 배정 →
          </button>
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

// 출근중 카운트 placeholder — 실제 attendance API 연동은 next round
function _unused() {
  fmtMoney(0)
}
