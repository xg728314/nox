"use client"

/**
 * MonitorPanel — composable body of the Counter Monitor V2.
 *
 * One implementation, two mount modes:
 *
 *   variant="page"     — original full-viewport route (/counter/monitor).
 *                        Renders its own chrome: MonitorHeader, toolbar,
 *                        BottomNavStrip, ModeHelpStrip, MobileTabBar.
 *                        Root is `min-h-screen` and owns the background.
 *
 *   variant="embedded" — drop-in inside another page (e.g. /counter).
 *                        Root is `h-full` (fills its parent container),
 *                        no MonitorHeader (parent owns page chrome), no
 *                        BottomNavStrip / ModeHelpStrip / MobileTabBar.
 *                        Always renders the TABLET layout regardless of
 *                        viewport breakpoint so the embedded container's
 *                        width (not the window's) drives density. The
 *                        panel scrolls internally via its own
 *                        `overflow-hidden → child overflow-auto` chain.
 *
 * Shared between variants: data polling (useMonitorData), preferences
 * (useMonitorPreferences), view options, alerts, selection state,
 * ActionPopover, BleCorrectionModal, KPI strip (toolbar-gated). Zero
 * business-logic forks.
 *
 * The standalone /counter/monitor route still works because page.tsx
 * simply mounts <MonitorPanel variant="page" />.
 */

import { useEffect, useMemo, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import { useMonitorData } from "./hooks/useMonitorData"
import { useBreakpoint, type Breakpoint } from "./hooks/useBreakpoint"
import { useMonitorPreferences } from "./hooks/useMonitorPreferences"
import { participantState, type WorkerState } from "./statusStyles"
import MonitorHeader from "./components/nav/MonitorHeader"
import MonitorToolbar from "./components/nav/MonitorToolbar"
// Phase 6: MobileTabBar import 제거. mobile 뷰포트 진입은 wrapper 에서
// 조기 배너 반환으로 처리된다. `/m/monitor` 트리가 모바일 UX 를 전담.
import RoomListPanel from "./components/panels/RoomListPanel"
import FloorMap, { type SelectedWorker } from "./components/FloorMap"
import HomeWorkersPanel from "./components/panels/HomeWorkersPanel"
import ForeignWorkersPanel from "./components/panels/ForeignWorkersPanel"
import FloorSummaryPanel from "./components/panels/FloorSummaryPanel"
import AbsencePanel from "./components/panels/AbsencePanel"
import MovementFeed from "./components/MovementFeed"
import BottomNavStrip from "./components/nav/BottomNavStrip"
import ModeHelpStrip from "./components/ModeHelpStrip"
import ActionPopover, { type ActionSubject } from "./components/ActionPopover"
import BleCorrectionModal, { type CorrectionSubject } from "./components/ble/BleCorrectionModal"
import BleKpiStrip from "./components/ble/BleKpiStrip"
import type {
  MonitorBlePresence, MonitorMovementEvent, MonitorRecommendation,
  MonitorRoom, MonitorRoomParticipant,
} from "./types"
import type { MonitorPanelId } from "@/lib/counter/monitorLayoutTypes"
import { useMonitorAlerts } from "./hooks/useMonitorAlerts"
import { filterRecommendations } from "@/lib/counter/monitorAlertsTypes"
import { useMonitorViewOptions } from "./hooks/useMonitorViewOptions"
import type { MonitorViewOptions } from "@/lib/counter/monitorViewOptionsTypes"
// Phase 6: device mode detection for mobile-viewport early banner.
import { useDeviceMode, setDeviceModePreference } from "@/lib/ui/useDeviceMode"

type InternalSelection = {
  participant_id: string | null
  membership_id: string | null
  hint_room_uuid: string | null
}

export type MonitorPanelVariant = "page" | "embedded"
export type MonitorPanelProps = { variant?: MonitorPanelVariant }

function resolveSelectedWorker(
  selection: InternalSelection,
  rooms: MonitorRoom[],
  movement: MonitorMovementEvent[],
): SelectedWorker | null {
  let live: MonitorRoomParticipant | null = null
  let liveRoom: string | null = null
  for (const r of rooms) {
    for (const p of r.participants) {
      const byId = selection.participant_id && p.id === selection.participant_id
      const byMem = !selection.participant_id && selection.membership_id && p.membership_id === selection.membership_id
      if (byId || byMem) { live = p; liveRoom = r.room_uuid; break }
    }
    if (live) break
  }
  if (live && liveRoom) {
    const state = participantState(live.status, live.zone)
    const lastMid = movement.find(m => m.kind === "participant_mid_out" && m.entity_id === live!.id)
    return {
      participant_id: live.id,
      membership_id: live.membership_id,
      current_room_uuid: liveRoom,
      source_room_uuid: state === "mid_out" ? (lastMid?.room_uuid ?? liveRoom) : null,
      destination_zone: state === "present" ? "room" : state === "mid_out" ? "restroom" : null,
      state,
      display_name: live.display_name,
    }
  }
  if (selection.participant_id) {
    const ev = movement.find(m => m.entity_id === selection.participant_id)
    if (ev && ev.room_uuid) {
      const room = rooms.find(r => r.room_uuid === ev.room_uuid)
      return {
        participant_id: selection.participant_id,
        membership_id: selection.membership_id,
        current_room_uuid: null,
        source_room_uuid: ev.room_uuid,
        destination_zone: "restroom",
        state: "mid_out",
        display_name: room ? `${room.room_name} · 이전 참여자` : "이전 참여자",
      }
    }
  }
  if (selection.membership_id) {
    return {
      participant_id: null,
      membership_id: selection.membership_id,
      current_room_uuid: selection.hint_room_uuid,
      source_room_uuid: null,
      destination_zone: null,
      state: selection.hint_room_uuid ? "present" : "waiting",
      display_name: "선택된 스태프",
    }
  }
  return null
}

type ProfileInfo = { store_name?: string | null }
function useStoreLabel(): string {
  const [label, setLabel] = useState<string>("우리 매장")
  useEffect(() => {
    let aborted = false
    apiFetch("/api/store/profile")
      .then(async r => (r.ok ? (await r.json()) as ProfileInfo : null))
      .then(p => {
        if (aborted || !p) return
        const name = (p.store_name ?? "").trim()
        if (name) setLabel(name)
      })
      .catch(() => { /* keep default */ })
    return () => { aborted = true }
  }, [])
  return label
}

export default function MonitorPanel({ variant = "page" }: MonitorPanelProps) {
  const viewportBreakpoint: Breakpoint = useBreakpoint()
  // Embedded panels live inside a bounded parent; viewport-driven
  // breakpoints would mis-classify a small embedded slot as desktop on
  // a 1920px screen. Force tablet layout for the embedded variant so
  // density is reasonable regardless of window size.
  const breakpoint: Breakpoint = variant === "embedded" ? "tablet" : viewportBreakpoint

  // Phase 6: hard device-mode guard for the `page` variant.
  //   Mobile viewport (< 960px) → render a redirect banner only.
  //   The embedded variant is used inside /counter's bounded widget
  //   slot, so device gating does NOT apply there.
  const deviceMode = useDeviceMode("ops")
  if (variant === "page" && deviceMode === "mobile") {
    return <MobileRedirectBanner />
  }

  const { data, loading, error, refresh, lastUpdatedAt } = useMonitorData()
  const [selectedRoomUuid, setSelectedRoomUuid] = useState<string | null>(null)
  const [selection, setSelection] = useState<InternalSelection>({
    participant_id: null, membership_id: null, hint_room_uuid: null,
  })
  const [stateFilter, setStateFilter] = useState<WorkerState | null>(null)
  const storeLabel = useStoreLabel()

  const storeUuid = data?.store_uuid ?? null
  const monitorPrefs = useMonitorPreferences(storeUuid)
  const { prefs, forcedActive, update, reset } = monitorPrefs
  const { prefs: alertsPrefs } = useMonitorAlerts(storeUuid)
  const monitorViewOptions = useMonitorViewOptions(storeUuid)
  const viewOptions: MonitorViewOptions = monitorViewOptions.options
  const toggleViewOption = (k: keyof Omit<MonitorViewOptions, "version">) => {
    void monitorViewOptions.update({ [k]: !viewOptions[k] } as Partial<MonitorViewOptions>)
  }
  const resetViewOptions = () => { void monitorViewOptions.reset() }

  // Phase 6: 모바일 전용 탭 state 삭제됨. 관련 렌더 함수도 제거되어
  // 이 Ops 트리는 데스크톱/태블릿 전용. 모바일 UX 는 `/m/monitor`.

  const rooms = useMemo(() => data?.rooms ?? [], [data])
  const homeWorkers = useMemo(() => data?.home_workers ?? [], [data])
  const foreignWorkers = useMemo(() => data?.foreign_workers ?? [], [data])
  const movement = useMemo(() => data?.movement ?? [], [data])
  const selectedWorker = useMemo(
    () => resolveSelectedWorker(selection, rooms, movement),
    [selection, rooms, movement],
  )

  const blePresenceAll = useMemo<MonitorBlePresence[]>(() => data?.ble.presence ?? [], [data])

  const blePresence = useMemo<MonitorBlePresence[]>(() => {
    const ok = (src: "ble" | "corrected") =>
      src === "corrected" ? viewOptions.show_correction_indicators : viewOptions.show_ble_validation_info
    return blePresenceAll.filter(p => ok(p.source))
  }, [blePresenceAll, viewOptions.show_ble_validation_info, viewOptions.show_correction_indicators])

  const bleByMembership = useMemo(() => {
    const m = new Map<string, MonitorBlePresence>()
    for (const p of blePresence) m.set(p.membership_id, p)
    return m
  }, [blePresence])

  const bleByMembershipRaw = useMemo(() => {
    const m = new Map<string, MonitorBlePresence>()
    for (const p of blePresenceAll) m.set(p.membership_id, p)
    return m
  }, [blePresenceAll])

  const participantNameById = useMemo(() => {
    const m = new Map<string, { name: string; origin_store_name: string | null }>()
    for (const r of rooms) {
      for (const p of r.participants) {
        m.set(p.id, { name: p.display_name, origin_store_name: p.origin_store_name })
      }
    }
    return m
  }, [rooms])

  const absenceCount = useMemo(() => {
    let n = 0
    for (const r of rooms) for (const p of r.participants) if (p.status !== "active") n++
    return n
  }, [rooms])

  const alertsByParticipantId = useMemo(() => {
    const m = new Map<string, MonitorRecommendation[]>()
    for (const r of rooms) {
      for (const p of r.participants) {
        const filtered = filterRecommendations(p.recommendations ?? [], alertsPrefs)
        if (filtered.length > 0) m.set(p.id, filtered)
      }
    }
    return m
  }, [rooms, alertsPrefs])

  const alertStateCounts = useMemo(() => {
    const buckets = { present: 0, mid_out: 0 }
    for (const r of rooms) {
      for (const p of r.participants) {
        if (!alertsByParticipantId.has(p.id)) continue
        if (p.status === "active") buckets.present += 1
        else if (p.status === "mid_out") buckets.mid_out += 1
      }
    }
    return buckets
  }, [rooms, alertsByParticipantId])

  const canAct = !!data && !error

  const [actionSubject, setActionSubject] = useState<ActionSubject | null>(null)
  const [correctionSubject, setCorrectionSubject] = useState<CorrectionSubject | null>(null)
  const openActionsFor = (args: {
    participant_id: string | null
    membership_id: string | null
    room_uuid: string | null
    display_name?: string | null
  }) => {
    if (!args.participant_id) return
    let name = args.display_name ?? ""
    if (!name) {
      outer: for (const r of rooms) {
        for (const p of r.participants) {
          if (p.id === args.participant_id) { name = p.display_name; break outer }
        }
      }
    }
    if (!name) name = "선택된 스태프"
    setActionSubject({
      participant_id: args.participant_id,
      membership_id: args.membership_id,
      room_uuid: args.room_uuid,
      display_name: name,
    })
  }

  const selectRoomWorker = (args: {
    participant_id: string; membership_id: string | null; room_uuid: string | null
  }) => {
    setSelection({
      participant_id: args.participant_id,
      membership_id: args.membership_id,
      hint_room_uuid: args.room_uuid,
    })
    if (args.room_uuid) setSelectedRoomUuid(args.room_uuid)
    openActionsFor(args)
  }
  const findParticipantByMembership = (membership_id: string | null): {
    participant_id: string | null; room_uuid: string | null
  } => {
    if (!membership_id) return { participant_id: null, room_uuid: null }
    for (const r of rooms) {
      for (const p of r.participants) {
        if (p.membership_id === membership_id) {
          return { participant_id: p.id, room_uuid: r.room_uuid }
        }
      }
    }
    return { participant_id: null, room_uuid: null }
  }

  const selectHomeWorker = (args: { membership_id: string; current_room_uuid: string | null }) => {
    setSelection({
      participant_id: null,
      membership_id: args.membership_id,
      hint_room_uuid: args.current_room_uuid,
    })
    if (args.current_room_uuid) setSelectedRoomUuid(args.current_room_uuid)
    const resolved = findParticipantByMembership(args.membership_id)
    if (resolved.participant_id) {
      openActionsFor({
        participant_id: resolved.participant_id,
        membership_id: args.membership_id,
        room_uuid: resolved.room_uuid,
      })
    }
  }
  const selectForeignWorker = (args: { membership_id: string | null; current_room_uuid: string | null }) => {
    setSelection({
      participant_id: null,
      membership_id: args.membership_id,
      hint_room_uuid: args.current_room_uuid,
    })
    if (args.current_room_uuid) setSelectedRoomUuid(args.current_room_uuid)
    const resolved = findParticipantByMembership(args.membership_id)
    if (resolved.participant_id) {
      openActionsFor({
        participant_id: resolved.participant_id,
        membership_id: args.membership_id,
        room_uuid: resolved.room_uuid,
      })
    }
  }
  const selectFeedParticipant = (participant_id: string, room_uuid: string | null) => {
    setSelection({ participant_id, membership_id: null, hint_room_uuid: room_uuid })
    if (room_uuid) setSelectedRoomUuid(room_uuid)
    openActionsFor({ participant_id, membership_id: null, room_uuid })
  }

  const toggleMap = () => { void update({ mapCollapsed: !prefs.mapCollapsed }) }
  const toggleDensity = () => { void update({ density: prefs.density === "compact" ? "comfortable" : "compact" }) }
  const togglePanel = (id: MonitorPanelId) => {
    void update({ panels: { ...prefs.panels, [id]: !prefs.panels[id] } })
  }
  const resetPrefs = () => { void reset() }

  const effectiveMapCollapsed = prefs.mapCollapsed
  const densityClass = prefs.density === "compact" ? "text-[11px]" : "text-[12px]"

  const confidenceMode: "basic" | "level" | "detail" =
    viewOptions.show_kpi_strip ? "detail" :
    viewOptions.show_ble_validation_info ? "level" :
    "basic"

  const roomListEl = (
    <RoomListPanel
      rooms={rooms}
      selectedRoomUuid={selectedRoomUuid}
      selectedParticipantId={selection.participant_id}
      onSelectRoom={setSelectedRoomUuid}
      onSelectWorker={selectRoomWorker}
      stateFilter={stateFilter}
      bleByMembership={bleByMembership}
      bleConfidenceByMembership={bleByMembershipRaw}
      confidenceMode={confidenceMode}
    />
  )
  const floorMapEl = (
    <FloorMap
      rooms={rooms}
      selectedRoomUuid={selectedRoomUuid}
      selectedWorker={selectedWorker}
      onSelect={setSelectedRoomUuid}
      onSelectWorker={selectRoomWorker}
      mode={data?.mode ?? "manual"}
      stateFilter={stateFilter}
      storeLabel={storeLabel}
      blePresence={blePresence}
      alertsByParticipantId={alertsPrefs.display.map_badges ? alertsByParticipantId : undefined}
      bleConfidenceByMembership={bleByMembershipRaw}
    />
  )
  const movementFeedEl = prefs.panels.movement_feed ? (
    <MovementFeed
      events={movement}
      rooms={rooms}
      onSelectParticipant={selectFeedParticipant}
      participantNameById={participantNameById}
    />
  ) : null
  const homePanelEl = prefs.panels.home_workers ? (
    <HomeWorkersPanel
      workers={homeWorkers}
      rooms={rooms}
      selectedMembershipId={selection.membership_id}
      onSelect={selectHomeWorker}
      storeLabel={storeLabel}
      bleByMembership={bleByMembership}
      bleConfidenceByMembership={bleByMembershipRaw}
      confidenceMode={confidenceMode}
    />
  ) : null
  const foreignPanelEl = prefs.panels.foreign_workers ? (
    <ForeignWorkersPanel
      workers={foreignWorkers}
      rooms={rooms}
      selectedMembershipId={selection.membership_id}
      onSelect={selectForeignWorker}
      bleByMembership={bleByMembership}
      bleConfidenceByMembership={bleByMembershipRaw}
      confidenceMode={confidenceMode}
    />
  ) : null
  const floorSummaryEl = prefs.panels.floor_summary ? (
    <FloorSummaryPanel rooms={rooms} storeLabel={storeLabel} />
  ) : null
  const absencePanelEl = prefs.panels.absence ? (
    <AbsencePanel
      rooms={rooms}
      movement={movement}
      canAct={canAct}
      selectedParticipantId={selection.participant_id}
      onSelectWorker={selectRoomWorker}
      bleByMembership={bleByMembership}
      bleConfidenceByMembership={bleByMembershipRaw}
      confidenceMode={confidenceMode}
      alertsByParticipantId={alertsByParticipantId}
      showRecommendations={alertsPrefs.display.recommendations && viewOptions.show_recommendation_hints}
    />
  ) : null

  const panelWrap = "rounded-xl border border-white/[0.06] bg-[#0b0e1c] p-3"
  const panelFlex = `${panelWrap} flex flex-col min-h-0`

  const renderDesktop = () => {
    const rightVisible = prefs.panels.right_column
    const showCenter = !effectiveMapCollapsed || !!movementFeedEl

    const cols = ["280px"]
    if (showCenter) cols.push("1fr")
    if (rightVisible && (homePanelEl || foreignPanelEl || floorSummaryEl || absencePanelEl)) {
      cols.push("340px")
    }
    const gridCols = cols.join(" ")

    return (
      <main
        className="flex-1 grid gap-3 p-3 min-h-0"
        style={{ gridTemplateColumns: gridCols }}
      >
        <section className={panelFlex}>{roomListEl}</section>

        {showCenter && (
          <section className="min-h-0 flex flex-col gap-3">
            {!effectiveMapCollapsed && (
              <div className={`${panelFlex} flex-1`}>{floorMapEl}</div>
            )}
            {movementFeedEl && (
              <div className={`${panelWrap} max-h-[240px]`}>{movementFeedEl}</div>
            )}
          </section>
        )}

        {rightVisible && (homePanelEl || foreignPanelEl || floorSummaryEl || absencePanelEl) && (
          <section className="min-h-0 flex flex-col gap-3">
            {homePanelEl && <div className={`${panelFlex} flex-1`}>{homePanelEl}</div>}
            {foreignPanelEl && (
              <div className="flex-1 min-h-0 rounded-xl border border-fuchsia-500/20 bg-[#0b0e1c] p-3 flex flex-col">
                {foreignPanelEl}
              </div>
            )}
            {floorSummaryEl && <div className={panelWrap}>{floorSummaryEl}</div>}
            {absencePanelEl && (
              <div className="flex-1 min-h-0 rounded-xl border border-amber-500/20 bg-[#0b0e1c] p-3 flex flex-col">
                {absencePanelEl}
              </div>
            )}
          </section>
        )}
      </main>
    )
  }

  const renderTablet = () => {
    const rightVisible = prefs.panels.right_column &&
      (!!homePanelEl || !!foreignPanelEl || !!floorSummaryEl || !!absencePanelEl)
    return (
      <main className="flex-1 flex flex-col gap-3 p-3 min-h-0 overflow-y-auto">
        <div
          className="grid gap-3 min-h-0"
          style={{ gridTemplateColumns: "260px 1fr" }}
        >
          <section className={panelFlex}>{roomListEl}</section>
          <section className="min-h-0 flex flex-col gap-3">
            {!effectiveMapCollapsed && (
              <div className={`${panelFlex} flex-1 min-h-[320px]`}>{floorMapEl}</div>
            )}
            {movementFeedEl && (
              <div className={`${panelWrap} max-h-[240px]`}>{movementFeedEl}</div>
            )}
          </section>
        </div>

        {rightVisible && (
          <section
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
          >
            {homePanelEl && <div className={`${panelFlex} min-h-[200px]`}>{homePanelEl}</div>}
            {foreignPanelEl && (
              <div className="rounded-xl border border-fuchsia-500/20 bg-[#0b0e1c] p-3 min-h-[200px] flex flex-col">
                {foreignPanelEl}
              </div>
            )}
            {floorSummaryEl && <div className={panelWrap}>{floorSummaryEl}</div>}
            {absencePanelEl && (
              <div className="rounded-xl border border-amber-500/20 bg-[#0b0e1c] p-3 min-h-[200px] flex flex-col">
                {absencePanelEl}
              </div>
            )}
          </section>
        )}
      </main>
    )
  }

  // Phase 6: 모바일 전용 렌더 함수 + 하단 탭바 컴포넌트 완전 제거.
  //   이 트리(Ops, `/counter/monitor`)는 이제 데스크톱/태블릿 전용.
  //   모바일 뷰포트 진입은 아래 wrapper 의 조기 배너 분기에서 처리하며,
  //   실제 모바일 UX 는 `/m/monitor` 트리가 전담한다.

  // Root wrapper — variant-dependent.
  //   page:     min-h-screen (owns viewport), bg background visible.
  //   embedded: h-full (fills parent container only), overflow-hidden
  //             so children scroll internally. No min-h-screen.
  const rootClass =
    variant === "page"
      ? `min-h-screen bg-[#07091A] text-slate-200 flex flex-col ${densityClass}`
      : `h-full w-full overflow-hidden bg-[#07091A] text-slate-200 flex flex-col rounded-xl border border-white/[0.06] ${densityClass}`

  return (
    <div className={rootClass}>
      {/* Chrome: MonitorHeader only in page variant. Embedded assumes the
          parent page owns the header and status badges. */}
      {variant === "page" && (
        <MonitorHeader
          summary={data?.summary ?? { present: 0, mid_out: 0, restroom: 0, external_floor: 0, waiting: 0 }}
          mode={data?.mode ?? "manual"}
          absenceCount={absenceCount}
          lastUpdatedAt={lastUpdatedAt}
          loading={loading}
          stateFilter={stateFilter}
          onFilterChange={setStateFilter}
          onRefresh={refresh}
          alertStateCounts={alertsPrefs.display.summary_highlight ? alertStateCounts : undefined}
        />
      )}

      {error && (
        <div className="px-4 py-2 text-[11px] text-red-300 bg-red-500/10 border-b border-red-500/30">
          {error}
        </div>
      )}

      {/* Workspace toolbar: desktop + tablet only. Mobile uses MobileTabBar.
          Rendered in BOTH variants — the toolbar is part of the panel, not
          page chrome. */}
      {breakpoint !== "mobile" && (
        <MonitorToolbar
          prefs={prefs}
          forcedActive={forcedActive}
          onToggleMap={toggleMap}
          onToggleDensity={toggleDensity}
          onTogglePanel={togglePanel}
          onReset={resetPrefs}
          compact={breakpoint === "tablet"}
          viewOptions={viewOptions}
          onToggleViewOption={toggleViewOption}
          onResetViewOptions={resetViewOptions}
        />
      )}

      {breakpoint !== "mobile" && viewOptions.show_kpi_strip && <BleKpiStrip />}

      {breakpoint === "desktop" && renderDesktop()}
      {breakpoint === "tablet" && renderTablet()}
      {/* Phase 6: breakpoint === "mobile" 분기 삭제.
          useDeviceMode === "mobile" 인 뷰포트는 파일 상단의 조기 배너
          반환이 처리하며, 이 지점에 도달하지 않는다. */}

      {/* Bottom strips: page variant only. Embedded defers bottom nav to
          the host page so we never conflict with /counter's own footer. */}
      {variant === "page" && breakpoint !== "mobile" && (
        <>
          <BottomNavStrip activeId="counter" manualEnabled />
          {breakpoint === "desktop" && <ModeHelpStrip mode={data?.mode ?? "manual"} />}
        </>
      )}

      {/* Modals are global overlays — identical in both variants. */}
      <ActionPopover
        open={!!actionSubject}
        subject={actionSubject}
        rooms={rooms}
        onClose={() => setActionSubject(null)}
        onActionSuccess={() => { void refresh() }}
        alertsByParticipantId={alertsByParticipantId}
        showRecommendations={alertsPrefs.display.recommendations && viewOptions.show_recommendation_hints}
        bleByMembership={bleByMembershipRaw}
        showFeedbackButtons={viewOptions.show_feedback_buttons}
        onFeedbackSubmitted={() => { void refresh() }}
        onRequestCorrection={() => {
          if (!actionSubject) return
          let membership_id: string | null = actionSubject.membership_id
          let original_zone: string = "unknown"
          let ble: MonitorBlePresence | null = null
          outer: for (const r of rooms) {
            for (const p of r.participants) {
              if (p.id === actionSubject.participant_id) {
                membership_id = membership_id ?? p.membership_id
                original_zone = p.status === "active"
                  ? "room"
                  : p.status === "mid_out"
                    ? "mid_out"
                    : p.status
                break outer
              }
            }
          }
          if (membership_id) ble = bleByMembership.get(membership_id) ?? null
          if (ble) original_zone = ble.zone
          if (!membership_id) return
          setCorrectionSubject({
            participant_id: actionSubject.participant_id,
            membership_id,
            room_uuid: actionSubject.room_uuid,
            display_name: actionSubject.display_name,
            original_zone,
            ble,
          })
        }}
      />

      <BleCorrectionModal
        open={!!correctionSubject}
        subject={correctionSubject}
        rooms={rooms}
        onClose={() => setCorrectionSubject(null)}
        onSuccess={() => { void refresh() }}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────
// Phase 6: MobileRedirectBanner
//
// Rendered instead of the full Ops UI when the current viewport is
// below 960px. Guides the user to the mobile tree (/m/monitor) and
// offers a "view anyway" escape hatch that stores an `ops` preference
// so the banner does not reappear on next visit until the user
// explicitly clears it.
// ────────────────────────────────────────────────────────────────

function MobileRedirectBanner() {
  return (
    <div className="min-h-screen bg-[#07091A] text-slate-200 flex items-center justify-center p-6">
      <div className="max-w-sm w-full rounded-2xl border border-amber-500/30 bg-[#0b0e1c] p-5 text-center">
        <div className="text-base font-bold text-amber-200 mb-2">모바일 뷰 권장</div>
        <p className="text-[12px] text-slate-300 leading-relaxed">
          이 페이지는 <b>960px 이상</b>의 PC / 태블릿 가로 화면에 최적화되어 있습니다.
          현재 뷰포트에서는 모바일 전용 경로가 권장됩니다.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <a
            href="/m/monitor"
            className="block w-full text-center px-3 py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-100 text-[12px] font-semibold"
          >
            📱 모바일 모니터로 이동
          </a>
          <button
            type="button"
            onClick={() => {
              setDeviceModePreference("ops")
              if (typeof window !== "undefined") window.location.reload()
            }}
            className="block w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-slate-300 text-[11px]"
          >
            그래도 데스크톱 UI 보기 (이 브라우저만)
          </button>
        </div>
        <div className="mt-3 text-[10px] text-slate-500 leading-snug">
          설정은 브라우저별로 저장됩니다. `/monitor?force=mobile` 로 언제든 모바일 뷰로 돌아갈 수 있습니다.
        </div>
      </div>
    </div>
  )
}
