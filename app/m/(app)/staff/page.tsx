"use client"
import Link from "next/link"
import { useMemo, useState } from "react"
import { PageHeader } from "../../_components/PageHeader"
import { TabBar } from "../../_components/TabBar"
import { useBuildingRooms, useMe, type BuildingRoom, type BuildingRoomsStoreBlock, type ClosedSessionLogEntry } from "../../_hooks/useMobileData"
import { cn } from "../../_lib/cn"

/**
 * 외부조판 — /m/staff (URL 유지 · 라벨만 "외부조판")
 *
 * R-external-dispatch (2026-07-24): 프로토타입 참고본 기반으로 완전 재구현.
 *  - super_admin → 건물 전체 (5~8F) 매장 방 aggregate
 *  - owner/manager → 자기 매장만
 *  - 방 카드: live (참여자·실장 pill·종목 pill) / empty (+ 체크인 → /m/assign)
 *  - 필터 chips: 전체 · 사용중 · 빈방 · 내방 · 매장별
 *
 *  이전 페이지 (아가씨 리스트 · 일하는중/대기/휴식 필터 · 일괄 출근)는
 *  프로토타입에 대응 개념이 없어 삭제. 아가씨 관리는 조판 탭 (/m) 에서.
 */

type FilterKey = "all" | "live" | "empty" | "mine"
type ClosedFilter = "all" | "unsettled" | "settled" | "edited"

export default function ExternalDispatchPage() {
  const me = useMe()
  const { data, isLoading, error } = useBuildingRooms()
  const [filter, setFilter] = useState<FilterKey>("all")
  const [storeFilter, setStoreFilter] = useState<string | null>(null) // store_uuid | null(전체)
  const [closedFilter, setClosedFilter] = useState<ClosedFilter>("all")
  const [expandAllClosed, setExpandAllClosed] = useState(false)

  const stores = useMemo(() => data?.stores ?? [], [data?.stores])
  const totals = useMemo(() => {
    let rooms = 0, live = 0, empty = 0
    for (const s of stores) {
      for (const r of s.rooms) {
        rooms++
        if (r.session) live++
        else empty++
      }
    }
    return { rooms, live, empty, stores: stores.length }
  }, [stores])

  // 필터 적용 (store + state)
  const filteredStores = useMemo<BuildingRoomsStoreBlock[]>(() => {
    return stores
      .filter((s) => !storeFilter || s.store_uuid === storeFilter)
      .map((s) => ({
        ...s,
        rooms: s.rooms.filter((r) => {
          if (filter === "live") return !!r.session
          if (filter === "empty") return !r.session
          if (filter === "mine") return r.session?.is_mine === true
          return true
        }),
      }))
      .filter((s) => s.rooms.length > 0 || filter === "all" || !storeFilter)
  }, [stores, filter, storeFilter])

  return (
    <>
      <PageHeader
        title="내 관리 매장 · 방 현황"
        subtitle={
          data
            ? `${totals.stores}매장 · ${totals.rooms}방 · 사용중 ${totals.live} · 빈방 ${totals.empty}`
            : undefined
        }
      />

      <main className="flex-1 overflow-y-auto px-3 pb-4 pt-2">
        {/* ── 상태 필터 chips ── */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
          <StateChip label="전체" count={totals.rooms} active={filter === "all"} onClick={() => setFilter("all")} />
          <StateChip label="사용중" count={totals.live} dot="live" active={filter === "live"} onClick={() => setFilter("live")} />
          <StateChip label="빈방" count={totals.empty} active={filter === "empty"} onClick={() => setFilter("empty")} />
          <StateChip label="내방" count={countMine(stores)} dot="mine" active={filter === "mine"} onClick={() => setFilter("mine")} />
        </div>

        {/* ── 매장 필터 chips ── */}
        {stores.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1.5 pb-1">
            <StoreChip label="전체 매장" active={storeFilter === null} onClick={() => setStoreFilter(null)} />
            {stores.map((s) => (
              <StoreChip
                key={s.store_uuid}
                label={`${s.floor != null ? `${s.floor}F ` : ""}${s.store_name}`}
                count={s.rooms.length}
                active={storeFilter === s.store_uuid}
                onClick={() => setStoreFilter((cur) => (cur === s.store_uuid ? null : s.store_uuid))}
              />
            ))}
          </div>
        )}

        {/* ── 상태 ── */}
        {isLoading && <SkeletonBlocks />}
        {error && (
          <div className="text-center text-[#B85450] text-[13px] font-bold py-8">
            불러오기 실패. 잠시 후 다시 시도.
          </div>
        )}
        {!isLoading && !error && filteredStores.length === 0 && (
          <div className="text-center text-[#7A746A] text-[13px] font-bold py-8">
            표시할 방이 없습니다.
          </div>
        )}

        {/* ── 매장별 방 블록 ── */}
        <div className="flex flex-col gap-3 pt-2">
          {filteredStores.map((store) => (
            <StoreBlock
              key={store.store_uuid}
              store={store}
              currentMembershipId={me.data?.membership_id ?? null}
            />
          ))}
        </div>

        {/* ── 종료된 세션 로그 (프로토타입 하단) ── */}
        <ClosedSessionsLog
          entries={data?.closed_sessions_log ?? []}
          filter={closedFilter}
          onFilterChange={setClosedFilter}
          expandAll={expandAllClosed}
          onToggleExpandAll={() => setExpandAllClosed((v) => !v)}
        />
      </main>

      <TabBar />
    </>
  )
}

/* ─────────────── 하위 컴포넌트 ─────────────── */

function StateChip({
  label,
  count,
  active,
  dot,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  dot?: "live" | "mine"
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full px-3 py-1.5 border text-[11px] font-extrabold tracking-tight inline-flex items-center gap-1.5",
        active
          ? "bg-[#2D2B26] text-white border-[#2D2B26]"
          : "bg-white text-[#2D2B26] border-[#D8D2C8]",
      )}
    >
      {dot === "live" && <span className="w-1.5 h-1.5 rounded-full bg-[#5FAB4E] shrink-0" />}
      {dot === "mine" && <span className="w-1.5 h-1.5 rounded-full bg-[#C49B61] shrink-0" />}
      <span>{label}</span>
      <span className={cn("text-[10px] font-black", active ? "opacity-90" : "text-[#7A746A]")}>{count}</span>
    </button>
  )
}

function StoreChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count?: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full px-3 py-1.5 border text-[11px] font-extrabold tracking-tight",
        active
          ? "bg-[#C49B61] text-white border-[#C49B61]"
          : "bg-white text-[#2D2B26] border-[#D8D2C8]",
      )}
    >
      {label}
      {typeof count === "number" && (
        <span className={cn("ml-1.5 text-[10px] font-black", active ? "opacity-90" : "text-[#7A746A]")}>{count}</span>
      )}
    </button>
  )
}

function StoreBlock({
  store,
  currentMembershipId,
}: {
  store: BuildingRoomsStoreBlock
  currentMembershipId: string | null
}) {
  const live = store.rooms.filter((r) => r.session).length
  const empty = store.rooms.length - live
  return (
    <section className="rounded-2xl border border-[#D8D2C8] bg-[#FDFCF9] p-2.5">
      <header className="flex items-center justify-between px-1 pb-2">
        <div className="inline-flex items-center gap-2">
          <span className="bg-[#C49B61] text-white text-[10px] font-black rounded-md px-2 py-0.5">
            {store.floor != null ? `${store.store_name} · ${store.floor}F` : store.store_name}
          </span>
        </div>
        <span className="text-[10px] font-bold text-[#7A746A]">
          {store.rooms.length}방 · 사용중 {live} · 빈방 {empty}
        </span>
      </header>

      <div className="flex flex-col gap-1.5">
        {store.rooms.map((r) => (
          <RoomCard
            key={r.room_uuid}
            room={r}
            storeUuid={store.store_uuid}
            currentMembershipId={currentMembershipId}
          />
        ))}
      </div>
    </section>
  )
}

function RoomCard({
  room,
  storeUuid,
  currentMembershipId,
}: {
  room: BuildingRoom
  storeUuid: string
  currentMembershipId: string | null
}) {
  if (room.session) {
    return <LiveRoomCard room={room} currentMembershipId={currentMembershipId} />
  }
  return <EmptyRoomCard room={room} storeUuid={storeUuid} />
}

function LiveRoomCard({
  room,
  currentMembershipId,
}: {
  room: BuildingRoom
  currentMembershipId: string | null
}) {
  const [open, setOpen] = useState(false)
  const s = room.session!
  const isMine =
    (currentMembershipId != null && s.manager_membership_id === currentMembershipId) || s.is_mine

  const elapsedMin = elapsedMinutesSince(s.started_at)
  return (
    <div
      className={cn(
        "rounded-xl border-l-4 border border-[#D8D2C8] bg-white overflow-hidden",
        isMine ? "border-l-[#C49B61] bg-[#FBF6EC]" : "border-l-[#5FAB4E]",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        <span className={cn("text-[11px] transition-transform", open ? "rotate-90" : "")}>▶</span>
        <span className="text-[13px] font-extrabold text-[#2D2B26]">
          {room.room_no}
          <span className="text-[10px] font-bold text-[#7A746A] ml-0.5">번방</span>
        </span>

        {/* 종목 pills */}
        {s.categories.length > 0 && (
          <span className="inline-flex items-center gap-0.5 ml-1">
            {s.categories.map((c) => (
              <CategoryPill key={c} letter={c} />
            ))}
          </span>
        )}

        {/* 진행 시간 */}
        <span className="inline-flex items-center gap-1 ml-1 bg-[#5FAB4E]/12 text-[#468838] rounded-md px-1.5 py-0.5 text-[10px] font-black">
          진행 {formatElapsed(elapsedMin)}
        </span>

        {/* 실장 pill */}
        {(s.manager_name || isMine) && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 ml-auto rounded-md px-1.5 py-0.5 text-[10px] font-black border",
              isMine
                ? "bg-[#C49B61]/16 text-[#8C6A3A] border-[#C49B61]/40"
                : "bg-[#DE3A7B]/10 text-[#B22563] border-[#DE3A7B]/30",
            )}
          >
            {isMine ? "✓" : "실"} {s.manager_name || "?"}
          </span>
        )}

        {/* 인원 카운트 */}
        <span className="text-[10px] font-black text-[#7A746A] ml-1 shrink-0">
          {s.participant_count}/{Math.max(s.participant_count, 3)}
        </span>
      </button>

      {open && (
        <div className="border-t border-[#EDE7DA] px-3 py-2 flex flex-col gap-1.5">
          {s.customer_name && (
            <div className="text-[10px] font-bold text-[#7A746A]">
              손님: {s.customer_name}
              {s.customer_party_size > 0 && ` · ${s.customer_party_size}명`}
            </div>
          )}
          {s.participants.length === 0 && (
            <div className="text-[10px] font-bold text-[#7A746A] py-1">참여자 없음</div>
          )}
          {s.participants.map((p) => (
            <ParticipantRow key={p.participant_id} participant={p} sessionId={s.session_id} />
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyRoomCard({
  room,
  storeUuid,
}: {
  room: BuildingRoom
  storeUuid: string
}) {
  return (
    <div className="rounded-xl border border-dashed border-[#D8D2C8] bg-white/70 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-[13px] font-extrabold text-[#7A746A]">
          {room.room_no}
          <span className="text-[10px] font-bold text-[#B0A99B] ml-0.5">번방</span>
        </span>
        <span className="text-[10px] font-bold text-[#B0A99B]">빈방</span>
        <Link
          href={`/m/assign?destStore=${encodeURIComponent(storeUuid)}&room=${encodeURIComponent(room.room_uuid)}`}
          className="ml-auto rounded-full bg-[#2D2B26] text-white text-[10px] font-black tracking-tight px-3 py-1 no-underline"
        >
          + 체크인
        </Link>
      </div>
    </div>
  )
}

/**
 * R-participant-actions (2026-07-24): 사용중 방 참여자 row.
 *   프로토타입 매칭: [매장뱃지] 이름 [티켓] [P/H/S pill] [⏱ 연장] [○ 종료]
 *   본 매장 참여자 = [내] 뱃지 (accent), 외부 = [매장명] 뱃지 (pink)
 */
function ParticipantRow({
  participant,
  sessionId,
}: {
  participant: import("../../_hooks/useMobileData").BuildingRoomParticipant
  sessionId: string
}) {
  const [busy, setBusy] = useState<"extend" | "leave" | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function extend() {
    if (!participant.membership_id || !participant.category || busy) return
    setBusy("extend")
    setMsg(null)
    try {
      const res = await fetch("/api/sessions/participants", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          membership_id: participant.membership_id,
          role: "hostess",
          category: participant.category,
          time_minutes: participant.time_minutes,
          time_type: participant.ticket === "완메" ? "기본" : participant.ticket,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message || `HTTP ${res.status}`)
      }
      setMsg("연장 완료")
    } catch (e) {
      setMsg(`실패: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  async function leave() {
    if (busy) return
    setBusy("leave")
    setMsg(null)
    try {
      const res = await fetch(`/api/sessions/participants/${encodeURIComponent(participant.participant_id)}/leave`, {
        method: "POST",
        credentials: "include",
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        if (j.error === "ALREADY_LEFT") {
          setMsg("이미 종료")
        } else {
          throw new Error(j.message || `HTTP ${res.status}`)
        }
      } else {
        setMsg("종료 완료")
      }
    } catch (e) {
      setMsg(`실패: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex items-center gap-1.5 py-1 px-2 rounded-lg bg-[#F8F4ED]/60">
      <span
        className={cn(
          "text-[9px] font-black rounded px-1.5 py-0.5 shrink-0",
          participant.is_external
            ? "bg-[#DE3A7B] text-white"
            : "bg-[#2D2B26] text-white",
        )}
      >
        {participant.is_external ? (participant.origin_store_name || "외부") : "내"}
      </span>
      <span className="text-[12px] font-bold text-[#2D2B26] flex-1 truncate">{participant.name}</span>
      <span className="text-[10px] font-bold text-[#7A746A]">{participant.ticket}</span>
      {participant.category_letter && <CategoryPill letter={participant.category_letter} />}
      <button
        type="button"
        onClick={extend}
        disabled={busy !== null || !participant.membership_id}
        className={cn(
          "shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-black inline-flex items-center gap-0.5",
          "bg-[#5FAB4E]/12 text-[#3E7A32] border-[#5FAB4E]/30",
          "disabled:opacity-40",
        )}
      >
        {busy === "extend" ? "…" : "⏱ 연장"}
      </button>
      <button
        type="button"
        onClick={leave}
        disabled={busy !== null}
        className={cn(
          "shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-black inline-flex items-center gap-0.5",
          "bg-[#DE3A7B]/12 text-[#B22563] border-[#DE3A7B]/30",
          "disabled:opacity-40",
        )}
      >
        {busy === "leave" ? "…" : "○ 종료"}
      </button>
      {msg && (
        <span className={cn("text-[9px] font-bold shrink-0", msg.startsWith("실패") ? "text-red-600" : "text-[#3E7A32]")}>
          {msg}
        </span>
      )}
    </div>
  )
}

function CategoryPill({ letter }: { letter: "P" | "H" | "S" }) {
  const cls =
    letter === "P"
      ? "bg-[#6B8AFD]/18 text-[#3E5EDB]"
      : letter === "H"
        ? "bg-[#D97757]/18 text-[#A94B2A]"
        : "bg-[#D9A557]/22 text-[#8C6A2A]"
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded text-[9px] font-black tracking-tight",
        cls,
      )}
    >
      {letter}
    </span>
  )
}

function SkeletonBlocks() {
  return (
    <div className="flex flex-col gap-3 pt-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-2xl border border-[#D8D2C8] bg-[#FDFCF9] p-3">
          <div className="h-4 w-32 bg-[#EDE7DA] rounded mb-3 animate-pulse" />
          {[0, 1, 2].map((j) => (
            <div key={j} className="h-9 bg-[#F3EEE3] rounded-xl mb-1.5 animate-pulse" />
          ))}
        </div>
      ))}
    </div>
  )
}

/* ─────────────── 종료 세션 로그 ─────────────── */

function ClosedSessionsLog({
  entries,
  filter,
  onFilterChange,
  expandAll,
  onToggleExpandAll,
}: {
  entries: ClosedSessionLogEntry[]
  filter: ClosedFilter
  onFilterChange: (f: ClosedFilter) => void
  expandAll: boolean
  onToggleExpandAll: () => void
}) {
  const counts = useMemo(() => {
    let all = 0, unsettled = 0, settled = 0, edited = 0
    for (const e of entries) {
      all++
      if (e.settlement_status === "unsettled") unsettled++
      else if (e.settlement_status === "settled") settled++
      else if (e.settlement_status === "edited") edited++
    }
    return { all, unsettled, settled, edited }
  }, [entries])

  const filtered = useMemo(() => {
    if (filter === "all") return entries
    return entries.filter((e) => e.settlement_status === filter)
  }, [entries, filter])

  if (entries.length === 0) return null

  return (
    <section className="mt-4 rounded-2xl border border-[#D8D2C8] bg-[#FDFCF9] p-2.5">
      <header className="flex items-center justify-between px-1 pb-2">
        <div className="text-[13px] font-extrabold text-[#2D2B26]">
          종료된 세션 · 로그
        </div>
        <span className="text-[10px] font-bold text-[#7A746A]">
          {counts.all}건 {counts.edited > 0 && `· 수정 ${counts.edited}건`}
        </span>
      </header>

      {/* 상태 필터 chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1.5 px-0.5">
        <ClosedStateChip label="전체" count={counts.all} active={filter === "all"} onClick={() => onFilterChange("all")} />
        <ClosedStateChip label="미정산" count={counts.unsettled} dot="unsettled" active={filter === "unsettled"} onClick={() => onFilterChange("unsettled")} />
        <ClosedStateChip label="정산완료" count={counts.settled} dot="settled" active={filter === "settled"} onClick={() => onFilterChange("settled")} />
        <ClosedStateChip label="수정됨" count={counts.edited} dot="edited" active={filter === "edited"} onClick={() => onFilterChange("edited")} />
      </div>

      {/* 모두 펼치기/접기 */}
      <div className="grid grid-cols-2 gap-1.5 mb-1.5 px-0.5">
        <button
          type="button"
          onClick={onToggleExpandAll}
          className={cn(
            "rounded-lg border py-1.5 text-[11px] font-extrabold",
            expandAll ? "bg-[#2D2B26] text-white border-[#2D2B26]" : "bg-white text-[#2D2B26] border-[#D8D2C8]",
          )}
        >
          ▼ 모두 펼치기
        </button>
        <button
          type="button"
          onClick={onToggleExpandAll}
          className={cn(
            "rounded-lg border py-1.5 text-[11px] font-extrabold",
            !expandAll ? "bg-[#2D2B26] text-white border-[#2D2B26]" : "bg-white text-[#2D2B26] border-[#D8D2C8]",
          )}
        >
          ▲ 모두 접기
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        {filtered.length === 0 && (
          <div className="text-center text-[11px] font-bold text-[#7A746A] py-4">
            해당 상태 없음
          </div>
        )}
        {filtered.map((e) => (
          <ClosedSessionRow key={e.session_id} entry={e} expanded={expandAll} />
        ))}
      </div>
    </section>
  )
}

function ClosedStateChip({
  label,
  count,
  active,
  dot,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  dot?: "unsettled" | "settled" | "edited"
  onClick: () => void
}) {
  const dotColor =
    dot === "unsettled" ? "bg-[#D9A557]"
      : dot === "settled" ? "bg-[#5FAB4E]"
        : dot === "edited" ? "bg-[#DE8A3A]"
          : ""
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full px-3 py-1 border text-[11px] font-extrabold inline-flex items-center gap-1.5",
        active
          ? "bg-[#2D2B26] text-white border-[#2D2B26]"
          : "bg-white text-[#2D2B26] border-[#D8D2C8]",
      )}
    >
      {dotColor && <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotColor)} />}
      <span>{label}</span>
      <span className={cn("text-[10px] font-black", active ? "opacity-90" : "text-[#7A746A]")}>{count}</span>
    </button>
  )
}

function ClosedSessionRow({ entry, expanded }: { entry: ClosedSessionLogEntry; expanded: boolean }) {
  const endTime = fmtHm(entry.ended_at)
  const stripeCls =
    entry.settlement_status === "edited" ? "border-l-[#DE8A3A]"
      : entry.settlement_status === "settled" ? "border-l-[#5FAB4E]"
        : "border-l-[#D9A557]"
  const badge =
    entry.settlement_status === "edited"
      ? { txt: "🖊 수정됨", cls: "bg-[#DE8A3A]/18 text-[#8A5325]" }
      : entry.settlement_status === "settled"
        ? { txt: "✓ 정산완료", cls: "bg-[#5FAB4E]/18 text-[#3E7A32]" }
        : null
  return (
    <div className={cn("rounded-xl border-l-4 border border-[#D8D2C8] bg-white overflow-hidden", stripeCls)}>
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-[11px]">▶</span>
        <span className="text-[13px] font-extrabold text-[#2D2B26]">
          {entry.room_no}
          <span className="text-[10px] font-bold text-[#7A746A] ml-0.5">번방</span>
        </span>
        <span className="text-[10px] font-bold text-[#7A746A]">종료 {endTime}</span>
        {badge && (
          <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-black", badge.cls)}>
            {badge.txt}
          </span>
        )}
        <span className="ml-auto text-[10px] font-black text-[#7A746A]">
          {entry.participant_count}/{entry.capacity_hint}
        </span>
      </div>
      {expanded && (
        <div className="border-t border-[#EDE7DA] px-3 py-2 text-[10px] font-bold text-[#7A746A] flex flex-col gap-0.5">
          <div>매장: {entry.store_name}</div>
          {entry.manager_name && <div>실장: {entry.manager_name}</div>}
        </div>
      )}
    </div>
  )
}

function fmtHm(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return "?"
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

/* ─────────────── 유틸 ─────────────── */

function elapsedMinutesSince(iso: string): number {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 0
  const diffMs = Date.now() - t
  return Math.max(0, Math.round(diffMs / 60000))
}

function formatElapsed(min: number): string {
  if (min < 60) return `${min}분`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`
}

function countMine(stores: BuildingRoomsStoreBlock[]): number {
  let n = 0
  for (const s of stores) for (const r of s.rooms) if (r.session?.is_mine) n++
  return n
}
