"use client"

import type { MonitorBlePresence, MonitorHomeWorker, MonitorRoom } from "../types"
import { STATUS_STYLES, elapsedLabel, type WorkerState } from "../statusStyles"
import BleHint from "./BleHint"
import ConfidenceBadge from "./ConfidenceBadge"

/**
 * HomeWorkersPanel — 소속 아가씨 위치 현황 (multi-floor, cross-store).
 *
 * Shows every home-store hostess with rich current-session info:
 *   avatar · 이름 · 매장 · 방(층) · 종목 · 시간(분/분) · 진입 시각.
 * Applies to own-store workers AND own workers currently working at
 * OTHER stores — the server already enriched the `MonitorHomeWorker`
 * shape with `current_store_name / current_floor / current_room_name /
 * category / current_time_minutes / entered_at / extension_count`.
 *
 * Foreign-store internals (customer, settlement, etc.) are not exposed
 * by the server; this panel only renders what the API sent.
 *
 * Policy:
 *   - own workers visible across all stores (working_store_uuid varies)
 *   - foreign workers are NOT in this panel — they appear in
 *     ForeignWorkersPanel only while participating in OUR active
 *     sessions.
 */

type Props = {
  workers: MonitorHomeWorker[]
  rooms: MonitorRoom[]
  selectedMembershipId: string | null
  onSelect: (args: { membership_id: string; current_room_uuid: string | null }) => void
  storeLabel?: string
  bleByMembership?: Map<string, MonitorBlePresence>
  bleConfidenceByMembership?: Map<string, MonitorBlePresence>
  confidenceMode?: "basic" | "level" | "detail"
}

function zoneToState(zone: MonitorHomeWorker["current_zone"]): WorkerState {
  if (zone === "room") return "present"
  if (zone === "away") return "away"
  return "waiting"
}

function fmtTimeShort(iso: string | null): string {
  if (!iso) return ""
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ""
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  } catch { return "" }
}

function elapsedMinutes(entered: string | null, now: number = Date.now()): number {
  if (!entered) return 0
  const t = new Date(entered).getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((now - t) / 60_000))
}

function Avatar({ name, state, isAway }: { name: string; state: WorkerState; isAway: boolean }) {
  const s = STATUS_STYLES[state]
  // "Own worker" visual affordance — both working-here and working-away
  // rows share the same emerald family rim so the operator can tell at
  // a glance this is their roster person, not a foreign worker (who
  // appears in ForeignWorkersPanel in fuchsia).
  const ring = isAway ? "ring-1 ring-fuchsia-400/40" : "ring-1 ring-emerald-400/40"
  return (
    <span className={`w-6 h-6 rounded-full border flex items-center justify-center text-[10px] font-bold ${s.chip} ${ring}`}>
      {name.slice(0, 1) || "?"}
    </span>
  )
}

export default function HomeWorkersPanel({
  workers, rooms, selectedMembershipId, onSelect, storeLabel = "마블", bleByMembership,
  bleConfidenceByMembership, confidenceMode = "basic",
}: Props) {
  // Sort: working now (home) → working elsewhere → waiting.
  const sorted = [...workers].sort((a, b) => {
    const rank: Record<MonitorHomeWorker["current_zone"], number> = { room: 0, away: 1, waiting: 2 }
    if (rank[a.current_zone] !== rank[b.current_zone]) return rank[a.current_zone] - rank[b.current_zone]
    return a.display_name.localeCompare(b.display_name, "ko")
  })

  return (
    <div className="flex flex-col h-full">
      <div className="px-1 mb-2 flex items-center justify-between">
        <span className="text-[11px] text-slate-100 font-bold">{storeLabel} 소속 아가씨 위치 현황</span>
        <span className="text-[10px] text-slate-500">{workers.length}명</span>
      </div>
      <div className="flex-1 overflow-y-auto pr-1 space-y-1">
        {sorted.length === 0 ? (
          <div className="text-center text-xs text-slate-500 py-6">소속 아가씨가 없습니다.</div>
        ) : (
          sorted.map(w => {
            const state = zoneToState(w.current_zone)
            const s = STATUS_STYLES[state]
            const selected = w.membership_id === selectedMembershipId
            const ble = bleByMembership?.get(w.membership_id) ?? null
            const bleConfidence = bleConfidenceByMembership?.get(w.membership_id) ?? null
            const isAway = w.current_zone === "away"
            const isWorking = w.current_zone !== "waiting"

            const storeName = w.current_store_name ?? (isAway ? "타점" : storeLabel)
            const floorPart = w.current_floor !== null ? `${w.current_floor}F` : ""
            const roomPart = w.current_room_name ?? ""
            const locationParts = [floorPart, storeName, roomPart].filter(Boolean)
            const locationLine = isWorking ? locationParts.join(" · ") : "대기"

            const elapsed = elapsedMinutes(w.entered_at)
            const timeTotal = w.current_time_minutes > 0 ? w.current_time_minutes : null
            const timeLine = isWorking && (timeTotal !== null || elapsed > 0)
              ? timeTotal !== null
                ? `${elapsed}/${timeTotal}분`
                : `${elapsed}분 경과`
              : null

            return (
              <button
                key={w.membership_id}
                type="button"
                onClick={() => onSelect({ membership_id: w.membership_id, current_room_uuid: w.current_room_uuid })}
                className={`w-full rounded-md px-2 py-1.5 text-left transition-all ${
                  selected
                    ? "bg-cyan-500/[0.08] ring-1 ring-cyan-300/50"
                    : "hover:bg-white/[0.04]"
                }`}
              >
                {/* Line 1: name + BLE hint + state badge */}
                <div className="flex items-center gap-2">
                  <Avatar name={w.display_name} state={state} isAway={isAway} />
                  <span className="text-[12px] text-slate-100 font-semibold truncate flex-1 min-w-0">
                    {w.display_name}
                    {isAway && (
                      <span className="ml-1 text-[10px] text-fuchsia-300 font-normal">·타점</span>
                    )}
                  </span>
                  {bleConfidence && (
                    <ConfidenceBadge
                      data={bleConfidence}
                      showLevel={confidenceMode !== "basic"}
                      showDetail={confidenceMode === "detail"}
                    />
                  )}
                  {ble && <BleHint zone={ble.zone} source={ble.source} />}
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md border flex-shrink-0 ${s.chip}`}>
                    {s.label}
                  </span>
                </div>
                {/* Line 2: location */}
                <div className="mt-0.5 ml-8 text-[10px] text-slate-400 truncate">
                  {locationLine}
                </div>
                {/* Line 3: category · time · entered */}
                {isWorking && (w.category || timeLine || w.entered_at) && (
                  <div className="mt-0.5 ml-8 flex items-center gap-2 text-[10px] text-slate-500 flex-wrap">
                    {w.category && (
                      <span className="text-slate-300">{w.category}</span>
                    )}
                    {timeLine && (
                      <span className="tabular-nums text-slate-300">{timeLine}</span>
                    )}
                    {w.entered_at && (
                      <span className="tabular-nums">
                        진입 {fmtTimeShort(w.entered_at)}
                        <span className="text-slate-600">
                          {` (${elapsedLabel(w.entered_at).replace(" 전", "")})`}
                        </span>
                      </span>
                    )}
                    {w.extension_count > 0 && (
                      <span className="px-1 py-0.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 text-[9.5px] font-semibold">
                        연장 {w.extension_count}회
                      </span>
                    )}
                  </div>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
