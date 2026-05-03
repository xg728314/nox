"use client"

import Link from "next/link"
import type { MonitorBlePresence, MonitorRoom, MonitorRoomParticipant } from "../../types"
import { STATUS_STYLES, elapsedLabel, participantState, type WorkerState } from "../../statusStyles"
import BleHint from "../ble/BleHint"
import ConfidenceBadge from "../badges/ConfidenceBadge"
import { useServerClock } from "@/lib/time/serverClock"

/**
 * RoomListPanel — left column.
 *
 * Visual target (screenshot):
 *   - header row with aggregate counts: 전체 N · 사용 N · 대기 N · 비어있음 N
 *   - first room (or the selected active room) is expanded with
 *     participant rows (avatar · name+origin · state badge · elapsed);
 *     elapsed shows location hint when mid-out ("카운터" / "화장실" etc.)
 *   - other rooms collapsed to a single thin row
 *   - "+ 방 추가" footer (disabled — room creation is in /counter)
 *
 * Read-only. Selecting a participant bubbles up to the map + right
 * panels via onSelectWorker. Room click focuses the row on the map.
 */

type Props = {
  rooms: MonitorRoom[]
  selectedRoomUuid: string | null
  selectedParticipantId: string | null
  onSelectRoom: (roomUuid: string) => void
  onSelectWorker: (args: { participant_id: string; membership_id: string | null; room_uuid: string | null }) => void
  stateFilter: WorkerState | null
  bleByMembership?: Map<string, MonitorBlePresence>
  /** Unfiltered BLE presence lookup used solely by ConfidenceBadge
   *  so the confidence dot is visible even when the operator has
   *  `show_ble_validation_info` OFF. */
  bleConfidenceByMembership?: Map<string, MonitorBlePresence>
  /** basic → dot only; level → dot + 높음/중간/낮음; detail → dot + label + first reason + score. */
  confidenceMode?: "basic" | "level" | "detail"
}

function Avatar({ name, state }: { name: string; state: WorkerState }) {
  const s = STATUS_STYLES[state]
  const initial = name.slice(0, 1) || "?"
  return (
    <span
      className={`relative w-7 h-7 rounded-full border flex items-center justify-center text-[10px] font-bold ${s.chip}`}
      aria-hidden
    >
      {initial}
    </span>
  )
}

function ParticipantRow({
  p, selected, dimmed, ble, bleConfidence, confidenceMode, onClick,
}: {
  p: MonitorRoomParticipant
  selected: boolean
  dimmed: boolean
  ble: MonitorBlePresence | null
  bleConfidence: MonitorBlePresence | null
  confidenceMode: "basic" | "level" | "detail"
  onClick: () => void
}) {
  const state = participantState(p.status, p.zone)
  const s = STATUS_STYLES[state]
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={`w-full flex items-center gap-2 rounded-md px-1.5 py-1 text-left transition-all ${
        selected ? "bg-white/[0.06] ring-1 ring-cyan-300/50" : "hover:bg-white/[0.04]"
      } ${dimmed ? "opacity-35" : ""}`}
    >
      <Avatar name={p.display_name} state={state} />
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1 min-w-0">
          <span className="block text-[12px] font-semibold text-slate-100 truncate">
            {p.display_name}
            {p.origin_store_name && (
              <span className="text-[10px] text-slate-500 font-normal ml-1">
                ({p.origin_store_name})
              </span>
            )}
          </span>
          {bleConfidence && (
            <ConfidenceBadge
              data={bleConfidence}
              showLevel={confidenceMode !== "basic"}
              showDetail={confidenceMode === "detail"}
            />
          )}
        </span>
        {ble && (
          <span className="mt-0.5 block">
            <BleHint zone={ble.zone} source={ble.source} />
          </span>
        )}
      </span>
      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${s.chip} flex-shrink-0`}>
        {s.label}
      </span>
      <span className="text-[10px] text-slate-400 tabular-nums w-10 text-right flex-shrink-0">
        {elapsedLabel(p.entered_at).replace(" 전", "")}
      </span>
    </button>
  )
}

export default function RoomListPanel({
  rooms, selectedRoomUuid, selectedParticipantId,
  onSelectRoom, onSelectWorker, stateFilter, bleByMembership,
  bleConfidenceByMembership, confidenceMode = "basic",
}: Props) {
  // 2026-05-03: 매장 PC 시계 어긋남 보정. 30초 tick — 분 단위 표시라 충분.
  const now = useServerClock(30_000)
  const totals = {
    all: rooms.length,
    using: rooms.filter(r => r.status === "active").length,
    waiting: 0,       // "대기" 방 (= 미배정 + 비활성) — 현재 derived data 에서는 0 으로 표기
    empty: rooms.filter(r => r.status !== "active").length,
  }

  // If the user selected a room, expand that one. Otherwise expand the
  // first active room (if any). All other rooms render collapsed.
  const expandedId =
    selectedRoomUuid ??
    rooms.find(r => r.status === "active")?.room_uuid ??
    rooms[0]?.room_uuid ?? null

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-1 pb-2 border-b border-white/[0.04] mb-2">
        <span className="text-[13px] font-bold text-slate-100">방 목록</span>
        <div className="flex items-center gap-2 text-[10px] text-slate-400">
          <span>전체 <span className="text-slate-200 font-bold">{totals.all}</span></span>
          <span className="text-slate-600">·</span>
          <span>사용 <span className="text-emerald-300 font-bold">{totals.using}</span></span>
          <span className="text-slate-600">·</span>
          <span>대기 <span className="text-amber-300 font-bold">{totals.waiting}</span></span>
          <span className="text-slate-600">·</span>
          <span>비어있음 <span className="text-slate-300 font-bold">{totals.empty}</span></span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-1 space-y-1.5">
        {rooms.map(r => {
          const active = r.status === "active"
          const isExpanded = r.room_uuid === expandedId
          const isSelected = r.room_uuid === selectedRoomUuid
          const startedMinutes = r.session?.started_at
            ? Math.max(0, Math.floor((now - new Date(r.session.started_at).getTime()) / 60_000))
            : 0
          return (
            <div
              key={r.room_uuid}
              className={`rounded-lg border transition-all ${
                isSelected || (isExpanded && active)
                  ? "border-emerald-500/50 bg-emerald-500/[0.04] ring-1 ring-emerald-500/30"
                  : active
                    ? "border-white/[0.08] bg-white/[0.02]"
                    : "border-white/[0.05] bg-white/[0.015]"
              }`}
            >
              {/* Row header (always visible) */}
              <button
                type="button"
                onClick={() => onSelectRoom(r.room_uuid)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[13px] font-bold text-slate-100">{r.room_name}</span>
                  {active ? (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/80 text-white leading-none">사용</span>
                  ) : (
                    <span className="text-[10px] text-slate-500">비어있음</span>
                  )}
                  {r.floor_no !== null && (
                    <span className="text-[10px] text-slate-500 ml-auto">{r.floor_no}F</span>
                  )}
                </div>
                {active ? (
                  <span className="text-[11px] font-bold text-emerald-300 tabular-nums">{startedMinutes}분</span>
                ) : (
                  <span className="text-[10px] text-slate-500">—</span>
                )}
              </button>

              {/* Expanded body */}
              {isExpanded && active && (
                <div className="px-2 pb-2 space-y-0.5">
                  {r.participants.length === 0 ? (
                    <div className="text-[10px] text-slate-500 px-1.5 py-1">참여자 없음</div>
                  ) : (
                    r.participants.map(p => {
                      const state = participantState(p.status, p.zone)
                      const dimmed = !!stateFilter && state !== stateFilter
                      const ble = p.membership_id && bleByMembership
                        ? bleByMembership.get(p.membership_id) ?? null
                        : null
                      const bleConfidence = p.membership_id && bleConfidenceByMembership
                        ? bleConfidenceByMembership.get(p.membership_id) ?? null
                        : null
                      return (
                        <ParticipantRow
                          key={p.id}
                          p={p}
                          selected={p.id === selectedParticipantId}
                          dimmed={dimmed}
                          ble={ble}
                          bleConfidence={bleConfidence}
                          confidenceMode={confidenceMode}
                          onClick={() => onSelectWorker({
                            participant_id: p.id,
                            membership_id: p.membership_id,
                            room_uuid: r.room_uuid,
                          })}
                        />
                      )
                    })
                  )}
                  <div className="flex items-center justify-between pt-2 mt-1 border-t border-white/[0.04] text-[10px] text-slate-500 px-1.5">
                    <span>
                      주문 {r.session ? "—" : "0"}건
                    </span>
                    <span className="text-slate-600">·</span>
                    <span>계산 ₩{Number(0).toLocaleString("ko-KR")}</span>
                  </div>
                </div>
              )}

              {/* Collapsed / empty room stub row */}
              {isExpanded === false && !active && (
                <div className="px-3 pb-2 -mt-1 flex items-center justify-between text-[10px] text-slate-500">
                  <span className="text-slate-600">+ 스태프 추가</span>
                  <span>주문 0건 · 계산 ₩0</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-2 pt-2 border-t border-white/[0.04]">
        <Link
          href="/counter"
          className="block w-full text-center py-1.5 rounded-lg border border-dashed border-white/10 text-[11px] text-slate-500 hover:text-slate-200 hover:border-white/20"
          title="방 추가는 카운터에서 진행합니다."
        >+ 방 추가</Link>
      </div>
    </div>
  )
}
