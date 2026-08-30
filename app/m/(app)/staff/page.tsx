"use client"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import { useToast } from "../../_components/Toast"
import { invalidateApi } from "../../_hooks/useApi"
import { PageHeader } from "../../_components/PageHeader"
import { TabBar } from "../../_components/TabBar"
import { ExtendEndSheet } from "../../_components/ExtendEndSheet"
import { AddHostessToSessionSheet } from "../../_components/AddHostessToSessionSheet"
import { PendingArrivalSheet } from "../../_components/PendingArrivalSheet"
import { useBuildingRooms, useMe, usePendingArrivals, type BuildingRoom, type BuildingRoomParticipant, type BuildingRoomsStoreBlock, type ClosedSessionLogEntry } from "../../_hooks/useMobileData"
import { cn } from "../../_lib/cn"

// R-external-extend-modal (2026-07-24): 참여자 [연장] 버튼 클릭 → 시트 오픈용 상태.
type ExtendTarget = {
  participant: BuildingRoomParticipant
  sessionId: string
  storeName: string
}

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
  // R-pending-pool (2026-08-31): 외부조판 페이지에도 도착 대기 배지 노출.
  const pendingArrivals = usePendingArrivals()
  const [pendingSheetOpen, setPendingSheetOpen] = useState(false)
  const [closedFilter, setClosedFilter] = useState<ClosedFilter>("all")
  const [expandAllClosed, setExpandAllClosed] = useState(false)
  const [extendTarget, setExtendTarget] = useState<ExtendTarget | null>(null)

  // 진행분 계산 (entered_at → now)
  const extendRemainingMin = useMemo(() => {
    if (!extendTarget?.participant.entered_at || !extendTarget.participant.time_minutes) return null
    const ent = new Date(extendTarget.participant.entered_at).getTime()
    if (Number.isNaN(ent)) return null
    const endMs = ent + extendTarget.participant.time_minutes * 60_000
    return Math.max(0, Math.round((endMs - Date.now()) / 60_000))
  }, [extendTarget])

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
        {/* R-pending-pool (2026-08-31): 도착 대기 · 방 배정 필요 배지 (count>0 만) */}
        {(pendingArrivals.data?.count ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => setPendingSheetOpen(true)}
            className="w-full mb-2 rounded-xl border-2 border-amber-400 bg-amber-100 px-4 py-3 text-left active:bg-amber-200 animate-pulse"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[13px] font-extrabold text-amber-800">
                  🚪 도착 대기 · 방 배정 필요 {pendingArrivals.data?.count}명
                </div>
                <div className="text-[10px] font-bold text-amber-700/80 mt-0.5">
                  외부 매장에서 우리 매장으로 보낸 아가씨 · 방을 선택하세요
                </div>
              </div>
              <div className="shrink-0 rounded-full bg-amber-600 text-white text-[10px] font-black px-2 py-1">
                {pendingArrivals.data?.count}
              </div>
            </div>
          </button>
        )}

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
              onOpenExtend={(participant, sessionId) => setExtendTarget({ participant, sessionId, storeName: store.store_name })}
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

      {/* R-external-extend-modal (2026-07-24): 참여자 [연장] 시트.
          조판 (/m) 과 동일 컴포넌트 재사용. participant 정보를 ExtendEndSheet
          prop 으로 매핑. */}
      {extendTarget && extendTarget.participant.membership_id && (
        <ExtendEndSheet
          open={true}
          onClose={() => setExtendTarget(null)}
          membershipId={extendTarget.participant.membership_id}
          hostessName={extendTarget.participant.name}
          participantId={extendTarget.participant.participant_id}
          sessionId={extendTarget.sessionId}
          category={extendTarget.participant.category}
          storeName={extendTarget.storeName}
          remainingMinutes={extendRemainingMin}
          startedAt={extendTarget.participant.entered_at}
        />
      )}
      {/* R-pending-pool (2026-08-31): 도착 대기 → 방 배정 시트 */}
      <PendingArrivalSheet
        open={pendingSheetOpen}
        onClose={() => setPendingSheetOpen(false)}
      />
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
  onOpenExtend,
}: {
  store: BuildingRoomsStoreBlock
  currentMembershipId: string | null
  onOpenExtend: (participant: BuildingRoomParticipant, sessionId: string) => void
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
            onOpenExtend={onOpenExtend}
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
  onOpenExtend,
}: {
  room: BuildingRoom
  storeUuid: string
  currentMembershipId: string | null
  onOpenExtend: (participant: BuildingRoomParticipant, sessionId: string) => void
}) {
  if (room.session) {
    return <LiveRoomCard room={room} storeUuid={storeUuid} currentMembershipId={currentMembershipId} onOpenExtend={onOpenExtend} />
  }
  return <EmptyRoomCard room={room} storeUuid={storeUuid} />
}

function LiveRoomCard({
  room,
  storeUuid,
  currentMembershipId,
  onOpenExtend,
}: {
  room: BuildingRoom
  storeUuid: string
  currentMembershipId: string | null
  onOpenExtend: (participant: BuildingRoomParticipant, sessionId: string) => void
}) {
  const [open, setOpen] = useState(false)
  // R-add-hostess + R-force-close (2026-08-31)
  const [addSheetOpen, setAddSheetOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const toast = useToast()
  const s = room.session!
  const isMine =
    (currentMembershipId != null && s.manager_membership_id === currentMembershipId) || s.is_mine

  const elapsedMin = elapsedMinutesSince(s.started_at)

  async function forceClose() {
    if (closing) return
    if (!confirm(`${room.room_no}번방 세션을 종료하시겠습니까? (빈 세션 정리)`)) return
    setClosing(true)
    try {
      const res = await apiFetch(`/api/sessions/${encodeURIComponent(s.session_id)}/force-close`, {
        method: "POST",
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.message ?? j?.error ?? `HTTP ${res.status}`)
      toast(`${room.room_no}번방 세션 종료`, "success")
      invalidateApi("/api/building/rooms")
      invalidateApi("/api/rooms")
    } catch (e) {
      toast(`종료 실패: ${(e as Error).message}`, "error")
    } finally {
      setClosing(false)
    }
  }
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

        {/* R-manager-pill-always (2026-08-23): 접힌 상태에서도 담당 실장 항상 노출.
              미지정 (null) 시 붉은 pill 로 인지 강화 · 세션 열지 않고도 바로 확인. */}
        <span
          className={cn(
            "inline-flex items-center gap-0.5 ml-auto rounded-md px-1.5 py-0.5 text-[10px] font-black border shrink-0",
            isMine
              ? "bg-[#C49B61]/16 text-[#8C6A3A] border-[#C49B61]/40"
              : s.manager_name
                ? "bg-[#DE3A7B]/10 text-[#B22563] border-[#DE3A7B]/30"
                : "bg-red-100 text-red-700 border-red-300",
          )}
        >
          {isMine ? `✓ ${s.manager_name || "내"}` : s.manager_name ? `실 ${s.manager_name}` : "⚠ 실장 미지정"}
        </span>

        {/* 인원 카운트 */}
        <span className="text-[10px] font-black text-[#7A746A] ml-1 shrink-0">
          {s.participant_count}/{Math.max(s.participant_count, 3)}
        </span>
      </button>

      {open && (
        <div className="border-t border-[#EDE7DA] px-3 py-2 flex flex-col gap-1.5">
          {/* R-session-manager-change (2026-08-23): 담당 실장 변경 · 대신 체크인 케이스 대응 */}
          <SessionManagerChange
            sessionId={s.session_id}
            storeUuid={storeUuid}
            currentManagerName={s.manager_name}
            currentManagerId={s.manager_membership_id ?? null}
          />
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
            <ParticipantRow
              key={p.participant_id}
              participant={p}
              sessionId={s.session_id}
              onOpenExtend={() => onOpenExtend(p, s.session_id)}
            />
          ))}
          {/* R-add-hostess + R-force-close (2026-08-31): 방 액션 */}
          <div className="mt-2 pt-2 border-t border-[#EDE7DA] flex gap-1.5">
            <button
              type="button"
              onClick={() => setAddSheetOpen(true)}
              className="flex-1 rounded-lg py-2 text-[11px] font-extrabold border-2 border-[#A87D45] bg-[#C49B61]/15 text-[#8C6A3A] active:bg-[#C49B61]/25"
            >
              + 아가씨 추가
            </button>
            {s.participants.length === 0 && (
              <button
                type="button"
                disabled={closing}
                onClick={forceClose}
                className="flex-1 rounded-lg py-2 text-[11px] font-extrabold border-2 border-red-300 bg-red-50 text-red-700 active:bg-red-100 disabled:opacity-40"
              >
                {closing ? "..." : "🔚 세션 종료"}
              </button>
            )}
          </div>
        </div>
      )}
      {addSheetOpen && (
        <AddHostessToSessionSheet
          open={addSheetOpen}
          onClose={() => setAddSheetOpen(false)}
          sessionId={s.session_id}
          storeUuid={storeUuid}
          roomLabel={`${room.room_no}번방`}
        />
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
  // R-instant-checkin (2026-08-31): 사용자 요청 "체크인 눌렀을때 체크인 한사람이
  //   담당이 되고 세션이 열리게만" — /m/assign 페이지 우회, 즉시 checkin API 호출.
  //   체크인 후 아가씨 추가는 확장 카드의 「+ 아가씨 추가」 사용.
  const me = useMe()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function instantCheckin() {
    if (busy || !me.data?.membership_id) return
    setBusy(true)
    try {
      const res = await apiFetch("/api/sessions/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_uuid: room.room_uuid,
          manager_membership_id: me.data.membership_id,
          manager_name: me.data.full_name ?? "",
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 409) {
          toast(`${room.room_no}번방 이미 사용중 · 새로고침`, "info")
          invalidateApi("/api/building/rooms")
          invalidateApi("/api/rooms")
        } else {
          throw new Error(j?.message ?? j?.error ?? `HTTP ${res.status}`)
        }
      } else {
        toast(`✓ ${room.room_no}번방 체크인 · 담당 ${me.data.full_name ?? "나"}`, "success")
        invalidateApi("/api/building/rooms")
        invalidateApi("/api/rooms")
      }
    } catch (e) {
      toast(`체크인 실패: ${(e as Error).message}`, "error")
    } finally {
      setBusy(false)
    }
  }

  // storeUuid 는 소속 매장이 아닌 다른 매장 방이면 링크 모드 유지 (외부 체크인).
  const isOwnStore = me.data?.store_uuid === storeUuid
  if (!isOwnStore) {
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

  return (
    <div className="rounded-xl border border-dashed border-[#D8D2C8] bg-white/70 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-[13px] font-extrabold text-[#7A746A]">
          {room.room_no}
          <span className="text-[10px] font-bold text-[#B0A99B] ml-0.5">번방</span>
        </span>
        <span className="text-[10px] font-bold text-[#B0A99B]">빈방</span>
        <button
          type="button"
          disabled={busy}
          onClick={instantCheckin}
          className="ml-auto rounded-full bg-[#2D2B26] text-white text-[10px] font-black tracking-tight px-3 py-1 disabled:opacity-40"
        >
          {busy ? "..." : "+ 체크인"}
        </button>
      </div>
    </div>
  )
}

/**
 * R-participant-actions (2026-07-24): 사용중 방 참여자 row.
 *   프로토타입 매칭: [매장뱃지] 이름 [티켓] [P/H/S pill] [⏱ 연장] [○ 종료]
 *   본 매장 = "내" (검은 뱃지) · 외부 = 매장명 (매장별 색상 팔레트)
 *
 *   R-store-palette (2026-07-24): 매장별 배지 색상 hash → 팔레트 매핑.
 *   같은 매장은 항상 같은 색 · 다른 매장은 시각적 구분 쉬움.
 */
// R-store-color-inline (2026-07-24): Tailwind arbitrary class (bg-[#hex]) 가
//   production build 에서 CSS 에 포함 안 되는 이슈 관측 → inline style 로 전환.
//   safelist 하는 것보다 명시적이고 조회 안 필요.
const STORE_COLOR_PALETTE: Array<{ bg: string; text: string }> = [
  { bg: "#DE3A7B", text: "#ffffff" },   // 0 pink
  { bg: "#6B8AFD", text: "#ffffff" },   // 1 blue
  { bg: "#8B5CF6", text: "#ffffff" },   // 2 purple
  { bg: "#D97757", text: "#ffffff" },   // 3 orange
  { bg: "#059669", text: "#ffffff" },   // 4 green
  { bg: "#DC2626", text: "#ffffff" },   // 5 red
  { bg: "#0891B2", text: "#ffffff" },   // 6 cyan
  { bg: "#CA8A04", text: "#ffffff" },   // 7 amber
  { bg: "#EC4899", text: "#ffffff" },   // 8 hot pink
  { bg: "#3B82F6", text: "#ffffff" },   // 9 sky
  { bg: "#10B981", text: "#ffffff" },   // 10 emerald
  { bg: "#6D28D9", text: "#ffffff" },   // 11 deep purple
]
const STORE_COLOR_FIXED: Record<string, number> = {
  "마블": 0,     // pink
  "아우라": 2,   // purple
  "발리": 1,     // blue
  "토끼": 3,     // orange
  "신세계": 4,   // green
  "아지트": 5,   // red
  "파티": 6,     // cyan
  "8번가": 7,    // amber
  "라이브": 8,   // hot pink
  "버닝": 9,     // sky
  "두바이": 10,  // emerald
  "황진이": 11,  // deep purple
  "썸": 8,
  "퍼스트": 9,
}
function storeColorFor(name: string | null | undefined): { bg: string; text: string } {
  if (!name) return STORE_COLOR_PALETTE[0]
  const fixed = STORE_COLOR_FIXED[name.trim()]
  if (fixed !== undefined) return STORE_COLOR_PALETTE[fixed]
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return STORE_COLOR_PALETTE[hash % STORE_COLOR_PALETTE.length]
}

function ParticipantRow({
  participant,
  sessionId,
  onOpenExtend,
}: {
  participant: BuildingRoomParticipant
  sessionId: string
  onOpenExtend: () => void
}) {
  const [busy, setBusy] = useState<"leave" | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  // sessionId 는 종료 endpoint 에 직접 필요 없지만 audit 목적으로 참조 유지.
  void sessionId

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

  const storeColor = participant.is_external
    ? storeColorFor(participant.origin_store_name)
    : { bg: "#2D2B26", text: "#ffffff" }

  return (
    <div className="flex items-center gap-1.5 py-1 px-2 rounded-lg bg-[#F8F4ED]/60">
      <span
        className="text-[9px] font-black rounded px-1.5 py-0.5 shrink-0"
        style={{ backgroundColor: storeColor.bg, color: storeColor.text }}
      >
        {participant.is_external ? (participant.origin_store_name || "외부") : "내"}
      </span>
      <span className="text-[12px] font-bold text-[#2D2B26] flex-1 truncate">{participant.name}</span>
      <span className="text-[10px] font-bold text-[#7A746A]">{participant.ticket}</span>
      {participant.category_letter && <CategoryPill letter={participant.category_letter} />}
      <button
        type="button"
        onClick={onOpenExtend}
        disabled={busy !== null || !participant.membership_id}
        className={cn(
          "shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-black inline-flex items-center gap-0.5",
          "bg-[#5FAB4E]/12 text-[#3E7A32] border-[#5FAB4E]/30",
          "disabled:opacity-40",
        )}
      >
        ⏱ 연장
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
  // R-closed-row-expand (2026-08-23): 개별 클릭 시 개별 expand + 부모 "모두 펼치기" 상속.
  //   토글 UX: 부모 모두 접기 → 클릭 → 이 row 만 펼침 · 다시 클릭 → 접힘.
  const [localOpen, setLocalOpen] = useState(false)
  const isOpen = expanded || localOpen
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
      <button
        type="button"
        onClick={() => setLocalOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        <span className={cn("text-[11px] transition-transform", isOpen && "rotate-90")}>▶</span>
        <span className="text-[13px] font-extrabold text-[#2D2B26]">
          {entry.room_no}
          <span className="text-[10px] font-bold text-[#7A746A] ml-0.5">번방</span>
        </span>
        <span className="text-[10px] font-bold text-[#7A746A]">종료 {endTime}</span>
        {/* R-closed-manager (2026-08-23): 담당 실장 표시 · 접힌 상태에서도 노출 */}
        {entry.manager_name && (
          <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-black bg-[#C49B61]/20 text-[#8C6A3A]">
            실 {entry.manager_name}
          </span>
        )}
        {badge && (
          <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-black", badge.cls)}>
            {badge.txt}
          </span>
        )}
        <span className="ml-auto text-[10px] font-black text-[#7A746A]">
          {entry.participant_count}/{entry.capacity_hint}
        </span>
      </button>
      {isOpen && (() => {
        // R-price-display (2026-08-23): 매장 옆에 아가씨 총금액 · 각 이름 옆에 개별 금액.
        const totalPrice = (entry.participants || []).reduce((s, p) => s + (p.price_amount ?? 0), 0)
        const fmt = (n: number) => n >= 10000
          ? `${Math.floor(n / 10000)}만${n % 10000 === 0 ? "" : Math.floor((n % 10000) / 1000) + "천"}원`
          : `${n.toLocaleString()}원`
        return (
        <div className="border-t border-[#EDE7DA] px-3 py-2 text-[10px] font-bold text-[#7A746A] flex flex-col gap-1">
          <div className="flex gap-3 flex-wrap items-center">
            <span>매장: <span className="text-[#2D2B26] font-extrabold">{entry.store_name}</span></span>
            {totalPrice > 0 && (
              <span className="inline-flex items-center rounded-md px-2 py-0.5 bg-[#C49B61]/18 text-[#8C6A3A] text-[10px] font-black">
                총 {fmt(totalPrice)}
              </span>
            )}
            {entry.manager_name && (
              <span>실장: <span className="text-[#2D2B26] font-extrabold">{entry.manager_name}</span></span>
            )}
          </div>
          {/* R-closed-participants (2026-08-23): 참여 아가씨 내역 · 개별 금액 */}
          {entry.participants.length > 0 ? (
            <div className="mt-1 flex flex-col gap-0.5">
              <div className="text-[9px] text-[#A87D45] font-extrabold">참여자 {entry.participants.length}명</div>
              {entry.participants.map((p) => {
                const cat = p.category === "퍼블릭" ? "P" : p.category === "셔츠" ? "S" : p.category === "하퍼" ? "H" : ""
                return (
                  <div key={p.participant_id} className="flex items-center gap-2 text-[11px]">
                    <span className="w-4 h-4 inline-flex items-center justify-center rounded bg-[#EDE7DA] text-[8px] font-black text-[#7A746A]">
                      {cat}
                    </span>
                    <span className="font-extrabold text-[#2D2B26]">{p.hostess_name}</span>
                    {p.price_amount > 0 && (
                      <span className="text-[10px] text-[#8C6A3A] font-black">{fmt(p.price_amount)}</span>
                    )}
                    {p.origin_store_name && p.origin_store_name !== entry.store_name && (
                      <span className="text-red-700 font-bold">({p.origin_store_name})</span>
                    )}
                    <span className="ml-auto text-[10px] text-[#7A746A]">
                      {p.time_minutes ? `${p.time_minutes}분` : "-"}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-[10px] text-[#7A746A]">참여자 없음</div>
          )}
        </div>
        )
      })()}
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

/**
 * R-session-manager-change (2026-08-23): 세션 담당 실장 변경 인라인 UI.
 *
 * 실장 A 가 실장 B 대신 체크인해줬을 때 → 담당이 A 로 잡힘 → 실제 담당 B 로 수정 필요.
 * PATCH /api/sessions/{id} 로 manager_membership_id 갱신.
 *
 * 매장별 매니저 목록은 storeUuid 로 /api/store/staff?store_uuid=... 조회
 * (본 매장이면 auto · 다른 매장이면 super_admin 만 조회 가능).
 */
function SessionManagerChange({
  sessionId,
  storeUuid,
  currentManagerName,
  currentManagerId,
}: {
  sessionId: string
  storeUuid: string
  currentManagerName: string | null
  currentManagerId: string | null
}) {
  const [managers, setManagers] = useState<Array<{ id: string; name: string }>>([])
  const [busy, setBusy] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const toast = useToast()

  useEffect(() => {
    (async () => {
      try {
        // 본 매장 매니저만 (다른 매장 노출 안 함 · privacy)
        const r = await apiFetch("/api/store/staff")
        const j = await r.json()
        const list = (j.staff || [])
          .filter((s: { role: string; store_uuid?: string }) => s.role === "manager" && (!s.store_uuid || s.store_uuid === storeUuid))
          .map((s: { membership_id: string; full_name?: string; name?: string }) => ({
            id: s.membership_id, name: s.full_name || s.name || "?",
          }))
        setManagers(list)
      } catch { /* silent */ }
    })()
  }, [storeUuid])

  const change = async (newManagerId: string) => {
    setBusy(true)
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manager_membership_id: newManagerId }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return toast(`실장 변경 실패: ${j.message || j.error || res.status}`, "error")
      const nm = managers.find((m) => m.id === newManagerId)?.name || "?"
      toast(`✓ 담당 실장 변경: ${nm}`, "success")
      invalidateApi("/api/building/rooms")
    } catch (e) {
      toast(`실장 변경 실패: ${(e as Error).message}`, "error")
    } finally {
      setBusy(false)
      setPickerOpen(false)
    }
  }

  return (
    <div className="flex items-center gap-2 text-[10px] font-bold text-[#7A746A]">
      <span>담당 실장:</span>
      <span className="text-[#2D2B26] font-extrabold">{currentManagerName || "미지정"}</span>
      <button
        type="button"
        onClick={() => setPickerOpen((v) => !v)}
        disabled={busy || managers.length === 0}
        className="ml-auto rounded-md bg-[#C49B61]/20 text-[#8C6A3A] border border-[#C49B61]/40 px-2 py-0.5 text-[10px] font-black disabled:opacity-40"
      >
        {busy ? "..." : "✏️ 실장 변경"}
      </button>
      {pickerOpen && managers.length > 0 && (
        <div
          onClick={() => setPickerOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs rounded-2xl bg-white p-3 shadow-2xl"
          >
            <div className="text-[12px] font-extrabold text-[#2D2B26] mb-2">담당 실장 선택</div>
            <div className="flex flex-col gap-1">
              {managers.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => change(m.id)}
                  disabled={busy}
                  className={cn(
                    "w-full text-left rounded-lg py-2 px-3 text-[12px] font-extrabold border disabled:opacity-40",
                    m.id === currentManagerId
                      ? "bg-[#C49B61]/20 text-[#8C6A3A] border-[#C49B61]"
                      : "bg-white text-[#2D2B26] border-[#D8D2C8] hover:bg-[#FBF6EC]",
                  )}
                >
                  {m.id === currentManagerId && "✓ "}{m.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="w-full rounded-lg py-2 text-[11px] font-bold text-[#7A746A] bg-[#F3EEE3] mt-1"
              >취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
