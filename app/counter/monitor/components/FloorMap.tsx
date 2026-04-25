"use client"

import { useLayoutEffect, useMemo, useRef, useState } from "react"
import type { MonitorBlePresence, MonitorRecommendation, MonitorRoom, MonitorRoomParticipant } from "../types"
import { FLOOR_LAYOUTS, FLOOR_TABS, type FloorId } from "../zones"
import { STATUS_STYLES, participantState, type WorkerState } from "../statusStyles"
import { LEVEL_LABEL, LEVEL_STYLE, REASON_LABEL, type ConfidenceLevel } from "./badges/confidenceStyles"

/**
 * FloorMap — 미니맵 & 위치 추적.
 *
 * Screenshot-matched layout:
 *   - header: title + floor tabs (5F/6F/7F/8F/전체층)
 *   - subheader: store/floor dropdown stub + "실시간 추적 ON" + 5-dot legend
 *   - zone grid: rooms + restroom (top-right) + elevator (center) +
 *                counter strip (bottom row, full width)
 *   - avatar markers inside each room cell
 *   - dotted directional path for the selected worker only
 */

export type SelectedWorker = {
  participant_id: string | null
  membership_id: string | null
  current_room_uuid: string | null
  destination_zone: "room" | "restroom" | "elevator" | "external_floor" | null
  source_room_uuid: string | null
  state: WorkerState
  display_name: string
}

type Props = {
  rooms: MonitorRoom[]
  selectedRoomUuid: string | null
  selectedWorker: SelectedWorker | null
  onSelect: (roomUuid: string) => void
  onSelectWorker: (args: { participant_id: string; membership_id: string | null; room_uuid: string | null }) => void
  mode: "manual" | "hybrid"
  stateFilter?: WorkerState | null
  storeLabel?: string
  /** BLE overlay presence rows (already scoped + TTL-filtered server-side). */
  blePresence?: MonitorBlePresence[]
  /** Server-computed + user-filtered alert map. When provided, avatars
   *  for participants with active alerts get a small `!` badge. Absent
   *  when `prefs.display.map_badges === false`. */
  alertsByParticipantId?: Map<string, MonitorRecommendation[]>
  /** Unfiltered BLE presence lookup used solely by the map avatars'
   *  confidence corner dot. Same lookup threaded into list panels so
   *  the map and list surfaces show identical confidence for the same
   *  worker. Separate from `blePresence` because the map confidence
   *  indicator is always visible (basic mode) and must not be gated
   *  by the `show_ble_validation_info` toggle. */
  bleConfidenceByMembership?: Map<string, MonitorBlePresence>
}

type ActiveFloor = FloorId | "all"

function Avatar({
  p, onClick, selected, dimmed, hasAlert, confidence,
}: {
  p: MonitorRoomParticipant
  onClick: () => void
  selected: boolean
  dimmed: boolean
  hasAlert: boolean
  /** BLE confidence for this participant's membership, if a presence
   *  row exists. Null when the participant has no BLE presence — the
   *  avatar MUST NOT invent a fallback indicator in that case. */
  confidence: {
    level: ConfidenceLevel
    score: number
    reasons: string[]
  } | null
}) {
  const state = participantState(p.status, p.zone)
  const style = STATUS_STYLES[state]
  const initial = p.display_name.slice(0, 1) || "?"
  // Tooltip extension — always appends level + first reason when
  // confidence exists, so the detail affordance is available without
  // any toggle. The primary at-a-glance signal is the corner dot.
  const confidenceTitlePart = confidence
    ? ` · 정확도 ${LEVEL_LABEL[confidence.level]} (${confidence.score.toFixed(2)})` +
      (confidence.reasons[0] ? ` · ${REASON_LABEL[confidence.reasons[0]] ?? confidence.reasons[0]}` : "")
    : ""
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={`relative w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border transition-all ${style.chip} ${
        selected
          ? "ring-2 ring-cyan-300/80 scale-110"
          : p.is_foreign
            ? "ring-1 ring-fuchsia-400/50"
            : "ring-1 ring-emerald-400/40"
      } ${dimmed ? "opacity-35" : ""}`}
      title={`${p.display_name}${p.is_foreign ? " (타점)" : " (소속)"} · ${style.label}${p.is_foreign && p.origin_store_name ? ` · ${p.origin_store_name}` : ""}${hasAlert ? " · 알림" : ""}${confidenceTitlePart}`}
    >
      {initial}
      {hasAlert && (
        <span
          className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-amber-400 border border-[#0b0e1c] text-[8px] font-bold text-black flex items-center justify-center leading-none"
          aria-label="알림"
        >!</span>
      )}
      {/* BLE confidence corner dot — bottom-right so it never overlaps
          with the amber alert badge at top-right and never occludes
          the initial letter. Dark ring against the map background so
          low / medium / high remain distinguishable at a glance. */}
      {confidence && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-[#0b0e1c] ${LEVEL_STYLE[confidence.level].dot}`}
          aria-label={`정확도 ${LEVEL_LABEL[confidence.level]}`}
        />
      )}
    </button>
  )
}

function RoomBlock({
  room, isSelected, isHighlighted, stateFilter, selectedParticipantId,
  onSelect, onSelectWorker, setCellEl, alertsByParticipantId,
  bleConfidenceByMembership,
}: {
  room: MonitorRoom
  isSelected: boolean
  isHighlighted: boolean
  stateFilter: WorkerState | null
  selectedParticipantId: string | null
  onSelect: (id: string) => void
  onSelectWorker: (args: { participant_id: string; membership_id: string | null; room_uuid: string | null }) => void
  setCellEl: (key: string, el: HTMLElement | null) => void
  alertsByParticipantId?: Map<string, MonitorRecommendation[]>
  bleConfidenceByMembership?: Map<string, MonitorBlePresence>
}) {
  const active = room.status === "active"
  const cellKey = `room:${room.room_uuid}`
  const activate = () => onSelect(room.room_uuid)
  return (
    // NOTE: this wrapper was previously a <button>, but it contains inner
    // <Avatar> buttons (participant markers). Nested buttons are invalid
    // HTML and trigger a React hydration error. We use a semantic
    // div[role=button] so keyboard (Enter / Space) + click activation
    // still work without creating a button-in-button tree.
    <div
      ref={(el) => setCellEl(cellKey, el)}
      data-cell={cellKey}
      role="button"
      tabIndex={0}
      aria-label={`${room.room_name} 선택`}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          activate()
        }
      }}
      className={`relative aspect-[1.4/1] rounded-xl border p-2 flex flex-col text-left transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 ${
        isSelected
          ? "ring-2 ring-cyan-400/70 border-cyan-400/60 bg-cyan-500/[0.08]"
          : isHighlighted
            ? "ring-2 ring-emerald-400/70 border-emerald-400/60 bg-emerald-500/[0.08]"
            : active
              ? "border-emerald-500/40 bg-emerald-500/[0.04] hover:bg-emerald-500/[0.08]"
              : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]"
      }`}
    >
      <div className="absolute top-1.5 left-2 text-[11px] font-bold text-slate-100">
        {room.room_name}
      </div>
      <div className="flex-1 flex items-center justify-center gap-1 pt-4">
        {room.participants.slice(0, 4).map(p => {
          const state = participantState(p.status, p.zone)
          const dimmed = !!stateFilter && state !== stateFilter
          const hasAlert = !!alertsByParticipantId?.get(p.id)?.length
          // Confidence is emitted by the server per membership_id. No
          // membership_id → no BLE presence → no confidence indicator
          // (we never invent a fallback from unrelated state).
          const presence = p.membership_id && bleConfidenceByMembership
            ? bleConfidenceByMembership.get(p.membership_id) ?? null
            : null
          const confidence = presence
            ? {
                level: presence.confidence_level,
                score: presence.confidence_score,
                reasons: presence.confidence_reasons,
              }
            : null
          return (
            <Avatar
              key={p.id}
              p={p}
              selected={selectedParticipantId === p.id}
              dimmed={dimmed}
              hasAlert={hasAlert}
              confidence={confidence}
              onClick={() => onSelectWorker({
                participant_id: p.id,
                membership_id: p.membership_id,
                room_uuid: room.room_uuid,
              })}
            />
          )
        })}
        {room.participants.length > 4 && (
          <span className="text-[10px] text-slate-400">+{room.participants.length - 4}</span>
        )}
      </div>
    </div>
  )
}

function FixedZone({
  cellKey, kind, label, setCellEl, isPathEndpoint, colspan, bleDots,
}: {
  cellKey: string
  kind: string
  label: string
  setCellEl: (key: string, el: HTMLElement | null) => void
  isPathEndpoint: boolean
  colspan?: number
  bleDots?: MonitorBlePresence[]
}) {
  const clsByKind: Record<string, string> = {
    counter:  "border-cyan-500/25 bg-cyan-500/[0.04] text-cyan-200",
    restroom: "border-purple-500/40 bg-purple-500/[0.06] text-purple-200",
    elevator: "border-slate-500/30 bg-slate-500/[0.04] text-slate-300",
    lounge:   "border-amber-500/30 bg-amber-500/[0.04] text-amber-200",
  }
  const ring = isPathEndpoint ? "ring-2 ring-amber-300/60" : ""
  const style: React.CSSProperties = colspan && colspan > 1
    ? { gridColumn: `span ${colspan} / span ${colspan}` }
    : {}
  return (
    <div
      ref={(el) => setCellEl(cellKey, el)}
      data-cell={cellKey}
      style={style}
      className={`relative rounded-xl border px-3 py-3 flex items-center justify-center text-[12px] font-semibold ${clsByKind[kind] ?? "border-white/10 bg-white/[0.02] text-slate-400"} ${ring} ${kind === "counter" ? "min-h-[56px]" : "aspect-[1.4/1]"}`}
    >
      <span>{label}</span>
      {bleDots && bleDots.length > 0 && (
        <span className="absolute bottom-1 right-1 inline-flex items-center gap-1 bg-cyan-500/15 border border-cyan-400/30 text-cyan-200 rounded-md px-1 py-0.5 text-[9px] font-bold">
          <span className="w-1 h-1 rounded-full bg-cyan-300 animate-pulse" />
          BLE ·&nbsp;{bleDots.length}
        </span>
      )}
    </div>
  )
}

function FloorGrid({
  rooms, floor, selectedRoomUuid, selectedWorker, stateFilter,
  blePresence, alertsByParticipantId, bleConfidenceByMembership,
  onSelect, onSelectWorker,
}: {
  rooms: MonitorRoom[]
  floor: FloorId
  selectedRoomUuid: string | null
  selectedWorker: SelectedWorker | null
  stateFilter: WorkerState | null
  blePresence: MonitorBlePresence[]
  alertsByParticipantId?: Map<string, MonitorRecommendation[]>
  bleConfidenceByMembership?: Map<string, MonitorBlePresence>
  onSelect: (id: string) => void
  onSelectWorker: (args: { participant_id: string; membership_id: string | null; room_uuid: string | null }) => void
}) {
  const layout = FLOOR_LAYOUTS[floor]
  const floorRooms = useMemo(
    () => rooms
      .filter(r => r.floor_no === floor)
      .sort((a, b) => a.sort_order - b.sort_order),
    [rooms, floor],
  )

  // Build set of occupied cells (including colspans) so free cells are correct.
  const occupied = new Set<string>()
  for (const z of layout.fixedZones) {
    const span = z.colspan ?? 1
    for (let c = z.col; c < z.col + span; c++) occupied.add(`${z.row}:${c}`)
  }
  const freeCells: Array<{ row: number; col: number }> = []
  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.cols; c++) {
      if (!occupied.has(`${r}:${c}`)) freeCells.push({ row: r, col: c })
    }
  }
  const roomByCell = new Map<string, MonitorRoom>()
  floorRooms.slice(0, freeCells.length).forEach((room, i) => {
    const cell = freeCells[i]
    roomByCell.set(`${cell.row}:${cell.col}`, room)
  })
  const overflow = floorRooms.slice(freeCells.length)

  const gridRef = useRef<HTMLDivElement>(null)
  const cellEls = useRef<Map<string, HTMLElement>>(new Map())
  const setCellEl = (key: string, el: HTMLElement | null) => {
    if (el) cellEls.current.set(key, el)
    else cellEls.current.delete(key)
  }

  const pathCellKeys = useMemo(() => {
    if (!selectedWorker) return null
    const sw = selectedWorker
    const sourceKey = sw.source_room_uuid ? `room:${sw.source_room_uuid}` : null
    let destKey: string | null = null
    if (sw.state === "present" && sw.current_room_uuid) destKey = `room:${sw.current_room_uuid}`
    else if (sw.destination_zone === "room" && sw.current_room_uuid) destKey = `room:${sw.current_room_uuid}`
    else if (sw.destination_zone === "restroom") destKey = `f${floor}-restroom`
    else if (sw.destination_zone === "elevator" || sw.destination_zone === "external_floor") destKey = `f${floor}-elevator`
    else if (sw.state === "mid_out") destKey = `f${floor}-restroom`
    if (!sourceKey && !destKey) return null
    return { sourceKey, destKey }
  }, [selectedWorker, floor])

  const [pathCoords, setPathCoords] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)

  useLayoutEffect(() => {
    if (!pathCellKeys || !gridRef.current) { setPathCoords(null); return }
    const container = gridRef.current
    const cRect = container.getBoundingClientRect()
    const src = pathCellKeys.sourceKey ? cellEls.current.get(pathCellKeys.sourceKey) : null
    const dst = pathCellKeys.destKey ? cellEls.current.get(pathCellKeys.destKey) : null
    if (!src || !dst) { setPathCoords(null); return }
    if (src === dst) { setPathCoords(null); return }
    const s = src.getBoundingClientRect()
    const d = dst.getBoundingClientRect()
    setPathCoords({
      x1: s.left + s.width / 2 - cRect.left,
      y1: s.top + s.height / 2 - cRect.top,
      x2: d.left + d.width / 2 - cRect.left,
      y2: d.top + d.height / 2 - cRect.top,
    })
  }, [pathCellKeys, floorRooms, layout])

  const selectedRoomHighlight = selectedWorker?.state === "present" && selectedWorker.current_room_uuid
    ? selectedWorker.current_room_uuid
    : null

  // Group BLE presence by fixed zone kind for this floor. Room-bound
  // BLE rows are handled separately (they don't produce overlay dots on
  // the room cell — the underlying participant avatar already shows the
  // member). Restroom / elevator / external_floor / counter get a small
  // count badge when any BLE rows resolve there.
  const bleByFixedKind: Record<string, MonitorBlePresence[]> = {}
  for (const p of blePresence) {
    if (p.zone === "restroom" || p.zone === "elevator" || p.zone === "external_floor" || p.zone === "counter" || p.zone === "lounge") {
      const k = p.zone
      if (!bleByFixedKind[k]) bleByFixedKind[k] = []
      bleByFixedKind[k].push(p)
    }
  }

  return (
    <div className="space-y-2">
      <div ref={gridRef} className="relative">
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: layout.rows * layout.cols }).map((_, idx) => {
            const row = Math.floor(idx / layout.cols)
            const col = idx % layout.cols
            const fixed = layout.fixedZones.find(z => {
              const span = z.colspan ?? 1
              return z.row === row && col >= z.col && col < z.col + span
            })
            if (fixed) {
              // Only render the cell at the starting column of a spanning zone
              if (col !== fixed.col) return null
              const endpointKey = pathCellKeys?.destKey ?? pathCellKeys?.sourceKey ?? null
              const dots = bleByFixedKind[fixed.kind] ?? []
              return (
                <FixedZone
                  key={fixed.id}
                  cellKey={fixed.id}
                  kind={fixed.kind}
                  label={fixed.label ?? ""}
                  setCellEl={setCellEl}
                  isPathEndpoint={endpointKey === fixed.id}
                  colspan={fixed.colspan}
                  bleDots={dots.length > 0 ? dots : undefined}
                />
              )
            }
            const room = roomByCell.get(`${row}:${col}`)
            if (room) {
              return (
                <RoomBlock
                  key={room.room_uuid}
                  room={room}
                  isSelected={room.room_uuid === selectedRoomUuid}
                  isHighlighted={room.room_uuid === selectedRoomHighlight}
                  stateFilter={stateFilter}
                  selectedParticipantId={selectedWorker?.participant_id ?? null}
                  onSelect={onSelect}
                  onSelectWorker={onSelectWorker}
                  setCellEl={setCellEl}
                  alertsByParticipantId={alertsByParticipantId}
                  bleConfidenceByMembership={bleConfidenceByMembership}
                />
              )
            }
            return (
              <div
                key={`empty:${row}:${col}`}
                className="aspect-[1.4/1] rounded-xl border border-dashed border-white/[0.04]"
              />
            )
          })}
        </div>
        {pathCoords && selectedWorker && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
            <defs>
              <marker id="monitor-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
              </marker>
            </defs>
            <g className={STATUS_STYLES[selectedWorker.state].text}>
              <line
                x1={pathCoords.x1} y1={pathCoords.y1} x2={pathCoords.x2} y2={pathCoords.y2}
                stroke="currentColor" strokeWidth={2} strokeDasharray="6 5"
                markerEnd="url(#monitor-arrow)" opacity={0.85}
              />
              {/* SVG <text> does not inherit the body-level antialiasing
                  rules that keep HTML Korean crisp. At 10 px hangul strokes
                  thin out and look broken. Bumping to 11 px + semibold +
                  explicit font-family makes the path label readable in
                  Korean. */}
              <text
                x={(pathCoords.x1 + pathCoords.x2) / 2}
                y={(pathCoords.y1 + pathCoords.y2) / 2 - 8}
                textAnchor="middle"
                className="text-[11px] fill-current"
                style={{
                  fontFamily: "var(--font-sans)",
                  fontWeight: 600,
                  paintOrder: "stroke",
                  stroke: "#07091A",
                  strokeWidth: 3,
                }}
              >
                {selectedWorker.display_name} · {STATUS_STYLES[selectedWorker.state].label}
              </text>
            </g>
          </svg>
        )}
      </div>
      {overflow.length > 0 && (
        <div className="grid gap-2 grid-cols-4">
          {overflow.map(r => (
            <RoomBlock
              key={r.room_uuid}
              room={r}
              isSelected={r.room_uuid === selectedRoomUuid}
              isHighlighted={r.room_uuid === selectedRoomHighlight}
              stateFilter={stateFilter}
              selectedParticipantId={selectedWorker?.participant_id ?? null}
              onSelect={onSelect}
              onSelectWorker={onSelectWorker}
              setCellEl={setCellEl}
              alertsByParticipantId={alertsByParticipantId}
              bleConfidenceByMembership={bleConfidenceByMembership}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function LegendDot({ state, label }: { state: WorkerState; label: string }) {
  const s = STATUS_STYLES[state]
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {label}
    </span>
  )
}

export default function FloorMap({
  rooms, selectedRoomUuid, selectedWorker, onSelect, onSelectWorker, mode, stateFilter = null,
  storeLabel = "우리 매장", blePresence = [], alertsByParticipantId, bleConfidenceByMembership,
}: Props) {
  const [floor, setFloor] = useState<ActiveFloor>(5)

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Title + floor tabs */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[13px] font-bold text-slate-100">미니맵 & 위치 추적</span>
        <div className="flex items-center gap-1 rounded-lg bg-white/[0.04] border border-white/10 p-1">
          {FLOOR_TABS.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setFloor(t.id)}
              className={`px-3 py-1 rounded-md text-[11px] font-semibold ${
                floor === t.id
                  ? "bg-emerald-500/25 text-emerald-100 border border-emerald-400/50"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >{t.label}</button>
          ))}
        </div>
      </div>

      {/* Subheader: store / floor dropdown + live indicator + legend */}
      <div className="flex items-center justify-between gap-3 flex-wrap bg-white/[0.02] border border-white/[0.06] rounded-lg px-3 py-2">
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-slate-300 font-semibold inline-flex items-center gap-1">
            {floor === "all" ? "전체층" : `${floor}F`} · {storeLabel}
            <span className="text-slate-500">▾</span>
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {mode === "hybrid" ? "실시간 추적 ON" : "수동 데이터 기반"}
          </span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <LegendDot state="present" label="마블 소속" />
          <LegendDot state="away" label="다른 가게(진행중)" />
          <LegendDot state="mid_out" label="이탈/이동중" />
          <LegendDot state="restroom" label="화장실" />
          <LegendDot state="external_floor" label="외부(타층)" />
        </div>
      </div>

      {/* Grid body */}
      <div className="flex-1 overflow-y-auto">
        {floor === "all" ? (
          <div className="space-y-4">
            {([5, 6, 7, 8] as FloorId[]).map(f => {
              const count = rooms.filter(r => r.floor_no === f).length
              if (count === 0) return null
              return (
                <div key={f} className="space-y-2">
                  <div className="text-[11px] text-slate-400 font-bold px-1">{f}F</div>
                  <FloorGrid
                    rooms={rooms}
                    floor={f}
                    selectedRoomUuid={selectedRoomUuid}
                    selectedWorker={selectedWorker}
                    stateFilter={stateFilter}
                    blePresence={blePresence}
                    alertsByParticipantId={alertsByParticipantId}
                    bleConfidenceByMembership={bleConfidenceByMembership}
                    onSelect={onSelect}
                    onSelectWorker={onSelectWorker}
                  />
                </div>
              )
            })}
            {rooms.every(r => r.floor_no === null) && (
              <div className="text-center text-xs text-slate-500 py-8">
                floor_no 가 지정된 방이 없습니다.
              </div>
            )}
          </div>
        ) : (
          <FloorGrid
            rooms={rooms}
            floor={floor}
            selectedRoomUuid={selectedRoomUuid}
            selectedWorker={selectedWorker}
            stateFilter={stateFilter}
            blePresence={blePresence}
            alertsByParticipantId={alertsByParticipantId}
            bleConfidenceByMembership={bleConfidenceByMembership}
            onSelect={onSelect}
            onSelectWorker={onSelectWorker}
          />
        )}
      </div>
    </div>
  )
}
