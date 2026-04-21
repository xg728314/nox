"use client"

/**
 * MobileMiniMap — 세로 배치 단일-매장 미니맵.
 *
 * 설계 규칙:
 *   - PC `FloorMap.tsx` 재사용 절대 금지 (CI grep 강제).
 *   - 공유 허용 import: statusStyles / zones / types / confidenceStyles.
 *   - BLE 실데이터 없을 때도 정상 렌더: BLE 마커만 비워지고 participant
 *     기반 방 점유/이탈은 그대로 표시.
 *   - 선택된 1명만 동선(점선) 표시 (Ops 는 항상 표시와 대조).
 */

import type {
  MonitorRoom,
  MonitorRoomParticipant,
  MonitorBlePresence,
} from "@/app/counter/monitor/types"
import { STATUS_STYLES, participantState, type WorkerState } from "@/app/counter/monitor/statusStyles"

type Props = {
  rooms: MonitorRoom[]
  blePresence: MonitorBlePresence[]
  selectedParticipantId: string | null
  onSelectParticipant: (args: {
    participant_id: string
    membership_id: string | null
    room_uuid: string | null
    display_name: string
  }) => void
}

function bleByMembership(ble: MonitorBlePresence[]): Map<string, MonitorBlePresence> {
  const m = new Map<string, MonitorBlePresence>()
  for (const p of ble) m.set(p.membership_id, p)
  return m
}

export default function MobileMiniMap({
  rooms, blePresence, selectedParticipantId, onSelectParticipant,
}: Props) {
  const bleMap = bleByMembership(blePresence)

  // Aggregate zone counts from BLE (elevator/restroom/external_floor).
  const bleZoneCounts = {
    restroom: blePresence.filter(p => p.zone === "restroom").length,
    elevator: blePresence.filter(p => p.zone === "elevator").length,
    external: blePresence.filter(p => p.zone === "external_floor").length,
    counter: blePresence.filter(p => p.zone === "counter").length,
  }

  if (rooms.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-[#0b0e1c] p-6 text-center text-[12px] text-slate-500">
        매장에 활성 방이 없습니다.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0b0e1c] overflow-hidden">
      {/* BLE 공용 존 요약 (화장실 / 엘리베이터 / 타층 / 카운터) */}
      <div className="px-3 py-2 border-b border-white/[0.06] flex items-center gap-2 text-[10px]">
        <ZoneChip label="화장실" value={bleZoneCounts.restroom} tone="amber" />
        <ZoneChip label="엘리베이터" value={bleZoneCounts.elevator} tone="violet" />
        <ZoneChip label="타층" value={bleZoneCounts.external} tone="slate" />
        <ZoneChip label="카운터" value={bleZoneCounts.counter} tone="slate" />
        {blePresence.length === 0 && (
          <span className="ml-auto text-[10px] text-slate-500">BLE 신호 없음</span>
        )}
      </div>

      {/* 방 그리드 — 세로 스택 2열. 각 방이 터치 타겟. */}
      <div className="grid gap-1.5 p-2" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        {rooms.map(r => (
          <RoomCell
            key={r.room_uuid}
            room={r}
            bleByMem={bleMap}
            selectedParticipantId={selectedParticipantId}
            onSelectParticipant={onSelectParticipant}
          />
        ))}
      </div>
    </div>
  )
}

function RoomCell({
  room, bleByMem, selectedParticipantId, onSelectParticipant,
}: {
  room: MonitorRoom
  bleByMem: Map<string, MonitorBlePresence>
  selectedParticipantId: string | null
  onSelectParticipant: Props["onSelectParticipant"]
}) {
  const participants = room.participants.filter(p =>
    (p.status === "active" || p.status === "mid_out") && p.operator_status !== "ended",
  )
  const active = participants.filter(p => p.status === "active" && p.zone === "room").length
  const midOut = participants.filter(p => p.status === "mid_out" || p.zone === "mid_out").length
  const total = active + midOut
  const occupied = total > 0

  return (
    <div
      className={`rounded-lg border px-2 py-2 min-h-[76px] ${
        occupied
          ? midOut > 0
            ? "bg-amber-500/[0.08] border-amber-500/25"
            : "bg-cyan-500/[0.08] border-cyan-500/25"
          : "bg-white/[0.02] border-white/[0.06]"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-slate-100 truncate">{room.room_name}</span>
        <span className="text-[9px] text-slate-500">{room.floor_no != null ? `${room.floor_no}F` : ""}</span>
      </div>
      <div className="text-[11px] font-semibold mt-0.5">
        <span className={occupied ? (midOut > 0 ? "text-amber-300" : "text-cyan-300") : "text-slate-500"}>
          {active}/{total}
        </span>
        {midOut > 0 && <span className="ml-1 text-[9px] text-amber-300/80">· 화장실 {midOut}</span>}
      </div>

      {/* Avatar 마커들 — touch target 28×28 */}
      {participants.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {participants.map(p => (
            <AvatarButton
              key={p.id}
              participant={p}
              roomUuid={room.room_uuid}
              selected={selectedParticipantId === p.id}
              hasBle={!!(p.membership_id && bleByMem.has(p.membership_id))}
              onClick={() => onSelectParticipant({
                participant_id: p.id,
                membership_id: p.membership_id,
                room_uuid: room.room_uuid,
                display_name: p.display_name,
              })}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function AvatarButton({
  participant: p, selected, hasBle, onClick,
}: {
  participant: MonitorRoomParticipant
  roomUuid: string
  selected: boolean
  hasBle: boolean
  onClick: () => void
}) {
  const state: WorkerState = participantState(p.status, p.zone)
  const style = STATUS_STYLES[state]
  const initial = p.display_name.slice(0, 1) || "?"
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={`${p.display_name} · ${state}`}
      className={`relative w-7 h-7 rounded-full text-[10px] font-bold border-2 flex items-center justify-center ${style.chip} ${
        selected ? "ring-2 ring-cyan-400" : ""
      }`}
    >
      {initial}
      {hasBle && (
        <span className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400" aria-label="BLE 신호" />
      )}
    </button>
  )
}

function ZoneChip({ label, value, tone }: { label: string; value: number; tone: "amber" | "violet" | "slate" }) {
  const cls =
    tone === "amber"  ? "bg-amber-500/10 border-amber-500/25 text-amber-200" :
    tone === "violet" ? "bg-violet-500/10 border-violet-500/25 text-violet-200" :
                        "bg-white/[0.04] border-white/10 text-slate-300"
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${cls}`}>
      <span className="opacity-70">{label}</span>
      <b className="tabular-nums">{value}</b>
    </span>
  )
}
