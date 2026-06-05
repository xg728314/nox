"use client"
import Link from "next/link"
import { useMemo, useState } from "react"
import { TabBar } from "../_components/TabBar"
import { StatusCells } from "../_components/StatusCells"
import { ChatCard } from "../_components/ChatCard"
import { StaffCard } from "../_components/StaffCard"
import { fmtDateKo, fmtMoney } from "../_lib/format"
import { useMe, useHostesses, useChatRooms, useRooms } from "../_hooks/useMobileData"

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

  // 채팅 미리보기 (최대 4개)
  const chatPreview = useMemo(() => (chats.data?.rooms ?? []).slice(0, 4), [chats.data])
  const chatVisible = chatCollapsed ? chatPreview.slice(0, 1) : chatPreview

  // 스태프 통계 (active session 기준)
  const stats = useMemo(() => {
    const all = hostesses.data?.hostesses ?? []
    const activeRooms = rooms.data?.rooms ?? []
    // 현재 active session 에 참여한 hostess 수 추정 (서버 정확 카운트 없으면 0)
    let working = 0
    for (const r of activeRooms) if (r.session) working += r.session.participant_count ?? 0
    const total = all.length
    const waiting = Math.max(0, Math.min(total, total - working))
    return { working, waiting, rest: 0, total }
  }, [hostesses.data, rooms.data])

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
          className="w-9 h-9 rounded-full bg-white border border-[#D8D2C8] flex items-center justify-center"
        >
          🔔
        </button>
      </header>

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
          <div className="text-[13px] font-extrabold">내 식구 {hostesses.data?.hostesses.length ?? 0}명</div>
          <Link href="/m/staff" className="text-[11px] font-bold text-[#A87D45] no-underline">
            전체 →
          </Link>
        </div>
        {hostesses.isLoading && <SkelGrid />}
        {hostesses.error && <ErrLine msg="식구 목록을 불러올 수 없습니다" />}
        {hostesses.data && (
          <div className="grid grid-cols-4 max-[360px]:grid-cols-3 gap-1.5">
            {hostesses.data.hostesses.slice(0, 12).map((h) => (
              <StaffCard
                key={h.membership_id}
                membershipId={h.membership_id}
                name={h.hostess_name}
                isMyStore
                storeLabel={me.data?.store_name ?? undefined}
                href={`/m/staff/${encodeURIComponent(h.membership_id)}`}
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
