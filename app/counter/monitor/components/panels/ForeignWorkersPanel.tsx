"use client"

import type { MonitorBlePresence, MonitorForeignWorker, MonitorRoom } from "../../types"
import { STATUS_STYLES, elapsedLabel } from "../../statusStyles"
import BleHint from "../ble/BleHint"
import ConfidenceBadge from "../badges/ConfidenceBadge"

/**
 * ForeignWorkersPanel — 다른 가게 스태프 (진행중인 방만).
 *
 * Row layout matches the home panel but accents in fuchsia to mark
 * cross-store context. Server already gates these rows to current active
 * sessions only; they disappear from the next poll after session end.
 */

type Props = {
  workers: MonitorForeignWorker[]
  rooms: MonitorRoom[]
  selectedMembershipId: string | null
  onSelect: (args: { membership_id: string | null; current_room_uuid: string | null }) => void
  bleByMembership?: Map<string, MonitorBlePresence>
  bleConfidenceByMembership?: Map<string, MonitorBlePresence>
  confidenceMode?: "basic" | "level" | "detail"
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="w-6 h-6 rounded-full border border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-100 flex items-center justify-center text-[10px] font-bold">
      {name.slice(0, 1) || "?"}
    </span>
  )
}

export default function ForeignWorkersPanel({
  workers, rooms, selectedMembershipId, onSelect, bleByMembership,
  bleConfidenceByMembership, confidenceMode = "basic",
}: Props) {
  const roomByUuid = new Map<string, MonitorRoom>()
  for (const r of rooms) roomByUuid.set(r.room_uuid, r)

  return (
    <div className="flex flex-col h-full">
      <div className="px-1 mb-2 flex items-center justify-between">
        <span className="text-[11px] text-slate-100 font-bold">다른 가게 스태프 <span className="text-slate-500 font-normal">(진행중인 방만)</span></span>
        <span className="text-[10px] text-slate-600">※ 방 종료 시 자동 숨김</span>
      </div>
      <div className="flex-1 overflow-y-auto pr-1 space-y-1">
        {workers.length === 0 ? (
          <div className="text-center text-xs text-slate-500 py-6">진행중인 타점 근무자가 없습니다.</div>
        ) : (
          workers.map(w => {
            const room = w.current_room_uuid ? roomByUuid.get(w.current_room_uuid) ?? null : null
            const location =
              room
                ? `${room.floor_no ? `${room.floor_no}F ` : ""}${w.origin_store_name ?? "타점"} ${room.room_name}`
                : (w.origin_store_name ?? "타점")
            const selected = !!w.membership_id && w.membership_id === selectedMembershipId
            const ble = w.membership_id && bleByMembership ? bleByMembership.get(w.membership_id) ?? null : null
            const bleConfidence = w.membership_id && bleConfidenceByMembership
              ? bleConfidenceByMembership.get(w.membership_id) ?? null
              : null
            const presentStyle = STATUS_STYLES.present
            return (
              <button
                key={`${w.session_id}:${w.membership_id ?? "placeholder"}`}
                type="button"
                onClick={() => onSelect({ membership_id: w.membership_id, current_room_uuid: w.current_room_uuid })}
                className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-all ${
                  selected
                    ? "bg-cyan-500/[0.08] ring-1 ring-cyan-300/50"
                    : "hover:bg-fuchsia-500/[0.06]"
                }`}
              >
                <Avatar name={w.display_name} />
                <span className="text-[12px] text-slate-100 font-semibold truncate w-[70px] flex-shrink-0">
                  {w.display_name}
                  {w.origin_store_name && (
                    <span className="text-[10px] text-fuchsia-300 font-normal ml-1">({w.origin_store_name})</span>
                  )}
                </span>
                <span className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-slate-400 truncate">{location}</span>
                  {bleConfidence && (
                    <ConfidenceBadge
                      data={bleConfidence}
                      showLevel={confidenceMode !== "basic"}
                      showDetail={confidenceMode === "detail"}
                    />
                  )}
                  {ble && <BleHint zone={ble.zone} source={ble.source} />}
                </span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md border flex-shrink-0 ${presentStyle.chip}`}>
                  {presentStyle.label}
                </span>
                <span className="text-[10px] text-slate-400 tabular-nums w-10 text-right flex-shrink-0">
                  {elapsedLabel(w.entered_at).replace(" 전", "")}
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
