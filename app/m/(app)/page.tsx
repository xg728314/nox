"use client"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { TabBar } from "../_components/TabBar"
import { SosButton } from "../_components/SosButton"
import { AssignFlowSheet } from "../_components/AssignFlowSheet"
import { ExtendEndSheet } from "../_components/ExtendEndSheet"
import { fmtDateKo } from "../_lib/format"
import { useMe, useHostesses, useAttendance, type HostessPreview } from "../_hooks/useMobileData"
import { useAutoCloseExpired } from "../_hooks/useAutoCloseExpired"
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

type HostessState = "live" | "wait" | "off"

function classify(h: HostessPreview, attendedSet: Set<string>): HostessState {
  if (h.is_working) return "live"
  if (attendedSet.has(h.membership_id)) return "wait"
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
  const { recent: autoClosedRecent } = useAutoCloseExpired()

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
  //   결근 (attended=false && !is_working) 은 완전 제외 — 사용자 요구.
  const all = useMemo(() => {
    const raw = hostesses.data?.hostesses ?? []
    return raw.filter((h) => h.is_working || attendedSet.has(h.membership_id))
  }, [hostesses.data, attendedSet])

  // 카운트 (결근 제외 · 전체 = 출근한 인원 전체)
  const counts = useMemo(() => {
    let live = 0, wait = 0
    for (const h of all) {
      const s = classify(h, attendedSet)
      if (s === "live") live++
      else if (s === "wait") wait++
    }
    return { live, wait, all: live + wait }
  }, [all, attendedSet])

  // 필터 + 검색 (아가씨 이름만) + 정렬 (진행중 임박순 → 대기)
  const filteredSorted = useMemo(() => {
    const norm = q.trim().toLowerCase()
    const withState = all.map((h) => ({ h, state: classify(h, attendedSet) }))
    const filtered = withState.filter(({ h, state }) => {
      if (norm) {
        const name = (h.hostess_name ?? "").toLowerCase()
        if (!name.includes(norm)) return false
      }
      if (filter === "all") return true
      if (filter === "live") return state === "live"
      if (filter === "wait") return state === "wait"
      if (filter === "onduty") return true // 이미 결근 제외됨 → all 과 동일
      return true
    })
    const order = { live: 0, wait: 1, off: 2 } as const
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
  }, [all, attendedSet, filter, q, remainingMinutesOf])

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

      {/* 필터 chips (프로토타입 매칭) — 출근한 아가씨만 (결근 제외) */}
      <div className="mx-4 mb-3 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        <FilterChip label="전체" count={counts.all} active={filter === "all"} onClick={() => setFilter("all")} dark={dark} />
        <FilterChip label="진행중" count={counts.live} dot="live" active={filter === "live"} onClick={() => setFilter("live")} dark={dark} />
        <FilterChip label="대기중" count={counts.wait} dot="wait" active={filter === "wait"} onClick={() => setFilter("wait")} dark={dark} />
        <FilterChip label="일중" count={counts.all} dot="onduty" active={filter === "onduty"} onClick={() => setFilter("onduty")} dark={dark} />
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
          <div className={cn("text-center py-8 text-[13px] font-bold", dark ? "text-[#8A8578]" : "text-[#7A746A]")}>
            {filter === "live" ? "지금 일하는 식구 없음"
              : filter === "wait" ? "대기 중인 식구 없음"
                : "표시할 식구 없음"}
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
                dark={dark}
                cols={cols}
                onOpenExtend={() => { setExtendTarget(h); setExtendOpen(true) }}
                onOpenAssign={() => {
                  setPendingIds([h.membership_id])
                  setPendingNames([h.hostess_name])
                  setAssignOpen(true)
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
    </div>
  )
}

/* ─────────────── 하위 컴포넌트 ─────────────── */

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

function HostessDispatchRow({
  index,
  hostess: h,
  state,
  remaining,
  dark,
  cols,
  onOpenExtend,
  onOpenAssign,
}: {
  index: number
  hostess: HostessPreview
  state: HostessState
  remaining: number | null
  dark: boolean
  cols: ColKey
  onOpenExtend: () => void
  onOpenAssign: () => void
}) {
  const imminent = state === "live" && remaining !== null && remaining <= 10

  const stripe =
    state === "live" ? "border-l-[#5FAB4E]"
      : state === "wait" ? "border-l-[#D9A557]"
        : "border-l-[#8A8578]"

  const stateLabel =
    state === "live" ? "방중"
      : state === "wait" ? "대기"
        : "결근"

  const statePill =
    state === "live"
      ? "bg-[#5FAB4E]/18 text-[#3E7A32]"
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

  // 3열 컴팩트 — 이름 + 상태 + 남은분만.
  if (cols === 3) {
    return (
      <button type="button" onClick={handleTap} className={cn(cardBase, "w-full text-left px-2 py-2 flex flex-col gap-1")}>
        <div className="flex items-center gap-1 min-w-0">
          <span className={cn("text-[10px] font-black", dark ? "text-[#8A8578]" : "text-[#7A746A]")}>#{index}</span>
          <span className="text-[12px] font-extrabold truncate flex-1">{h.hostess_name}</span>
        </div>
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
    )
  }

  // 2열 컴팩트
  if (cols === 2) {
    return (
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
    )
  }

  // 1열 (기본 · 프로토타입 매칭)
  return (
    <button type="button" onClick={handleTap} className={cn(cardBase, "w-full text-left px-3 py-2.5")}>
      {/* 1행: index · 이름 · 상태뱃지 · imminent 뱃지 */}
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={cn(
            "w-2 h-2 rounded-full shrink-0",
            state === "live" ? "bg-[#5FAB4E]"
              : state === "wait" ? "bg-[#D9A557]"
                : "bg-[#8A8578]",
          )}
        />
        <span className={cn("text-[11px] font-black shrink-0", dark ? "text-[#8A8578]" : "text-[#7A746A]")}>
          {index}
        </span>
        <span className="text-[14px] font-extrabold truncate min-w-0">
          <span className="underline underline-offset-2 decoration-dotted">{h.hostess_name}</span>
        </span>
        <Link
          href={`/m/staff/${encodeURIComponent(h.membership_id)}`}
          onClick={(e) => e.stopPropagation()}
          aria-label="세부"
          className={cn(
            "shrink-0 text-[10px] px-1.5 py-0.5 rounded no-underline",
            dark ? "text-[#8A8578] hover:bg-[#302a20]" : "text-[#7A746A] hover:bg-[#EDE7DA]",
          )}
        >
          🔀
        </Link>
        <span className={cn("ml-auto inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-black shrink-0", statePill)}>
          {state === "live" ? "● 방중" : state === "wait" ? "🕐 대기" : "결근"}
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
            "mt-1 pl-4 text-[11px] font-bold leading-tight",
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
      {state === "wait" && (
        <div className={cn("mt-1 pl-4 text-[11px] font-bold", dark ? "text-[#8A8578]" : "text-[#7A746A]")}>
          🕐 대기중 · 배정 필요
        </div>
      )}
      {state === "off" && (
        <div className={cn("mt-1 pl-4 text-[11px] font-bold", dark ? "text-[#8A8578]" : "text-[#7A746A]")}>
          결근 · 미출근
        </div>
      )}
    </button>
  )
}
