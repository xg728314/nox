"use client"

/**
 * AbsencePanel — 이탈 알림 (right column, bottom).
 *
 * Target row: avatar · 이름(+소속) · 위치 · 경과 · [복귀 처리] [종료 처리].
 * Header has category filter tabs (전체 / 이탈 / 화장실 / 외부). Today
 * only 이탈 is derivable from manual data; 화장실 / 외부 counters are
 * BLE-only and populate once overlay lands — filter tabs remain usable
 * so the layout is stable.
 *
 * 복귀/종료 handlers are intentional stubs with explicit messages —
 * mutation endpoints are owned by /counter; this panel never writes.
 */

import { useMemo, useState } from "react"
import type { MonitorBlePresence, MonitorMovementEvent, MonitorRecommendation, MonitorRoom } from "../../types"
import { STATUS_STYLES, elapsedLabel, type WorkerState } from "../../statusStyles"
import { REC_LABEL } from "@/lib/counter/monitorAlertsTypes"
import BleHint from "../ble/BleHint"
import ConfidenceBadge from "../badges/ConfidenceBadge"

type AbsenceRow = {
  participant_id: string
  membership_id: string | null
  display_name: string
  is_foreign: boolean
  origin_store_name: string | null
  last_room_uuid: string | null
  last_room_name: string | null
  floor_no: number | null
  since_iso: string
  state: WorkerState
  /** Latest operator action for this participant (server-derived). */
  operator_status: "normal" | "still_working" | "ended" | "extended"
  extension_count: number
}

type Props = {
  rooms: MonitorRoom[]
  movement: MonitorMovementEvent[]
  canAct: boolean
  selectedParticipantId: string | null
  onSelectWorker: (args: { participant_id: string; membership_id: string | null; room_uuid: string | null }) => void
  bleByMembership?: Map<string, MonitorBlePresence>
  bleConfidenceByMembership?: Map<string, MonitorBlePresence>
  confidenceMode?: "basic" | "level" | "detail"
  /** Server-computed + user-filtered alert map. */
  alertsByParticipantId?: Map<string, MonitorRecommendation[]>
  /** Render recommendation chips inline — controlled by alert prefs. */
  showRecommendations?: boolean
}

type FilterTab = "all" | "mid_out" | "restroom" | "external_floor"

export default function AbsencePanel({
  rooms, movement, canAct, selectedParticipantId, onSelectWorker, bleByMembership,
  bleConfidenceByMembership, confidenceMode = "basic",
  alertsByParticipantId, showRecommendations = true,
}: Props) {
  const [filter, setFilter] = useState<FilterTab>("all")
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())

  const rows: AbsenceRow[] = useMemo(() => {
    const out: AbsenceRow[] = []
    for (const r of rooms) {
      for (const p of r.participants) {
        if (p.status === "active") continue
        // Mute absence alerts for participants the operator has marked
        // as 일중이다 (still_working). They're excluded entirely — this
        // is the documented mute behavior, not just a style change.
        if (p.operator_status === "still_working") continue
        const lastMidOut = movement.find(
          m => m.kind === "participant_mid_out" && m.entity_id === p.id,
        )
        out.push({
          participant_id: p.id,
          membership_id: p.membership_id,
          display_name: p.display_name,
          is_foreign: p.is_foreign,
          origin_store_name: p.origin_store_name,
          last_room_uuid: r.room_uuid,
          last_room_name: r.room_name,
          floor_no: r.floor_no,
          since_iso: lastMidOut?.at ?? p.entered_at,
          state: "mid_out",
          operator_status: p.operator_status,
          extension_count: p.extension_count,
        })
      }
    }
    return out
  }, [rooms, movement])

  const counts = {
    all: rows.length,
    mid_out: rows.filter(r => r.state === "mid_out").length,
    restroom: 0,        // BLE-only today
    external_floor: 0,  // BLE-only today
  }

  const visibleRows = rows.filter(r => filter === "all" || r.state === filter)

  const handleReturn = async (row: AbsenceRow) => {
    setBusyIds(prev => new Set(prev).add(row.participant_id))
    await new Promise(res => setTimeout(res, 120))
    setBusyIds(prev => { const n = new Set(prev); n.delete(row.participant_id); return n })
    alert("복귀 처리 엔드포인트는 아직 준비되지 않았습니다. /counter 의 세션 화면에서 수동으로 복귀 처리해주세요.")
  }

  const handleTerminate = async (row: AbsenceRow) => {
    setBusyIds(prev => new Set(prev).add(row.participant_id))
    await new Promise(res => setTimeout(res, 120))
    setBusyIds(prev => { const n = new Set(prev); n.delete(row.participant_id); return n })
    alert("종료 처리는 /counter 의 체크아웃 흐름을 따릅니다. 이 화면에서 직접 마감하지 않습니다.")
  }

  const tabs: Array<{ id: FilterTab; label: string; count: number; state?: WorkerState; bleOnly?: boolean }> = [
    { id: "all", label: "전체", count: counts.all },
    { id: "mid_out", label: "이탈", count: counts.mid_out, state: "mid_out" },
    { id: "restroom", label: "화장실", count: counts.restroom, state: "restroom", bleOnly: true },
    { id: "external_floor", label: "외부", count: counts.external_floor, state: "external_floor", bleOnly: true },
  ]

  return (
    <div className="h-full flex flex-col">
      <div className="px-1 mb-2 flex items-center justify-between">
        <span className="text-[11px] text-slate-100 font-bold">이탈 알림</span>
        <div className="flex items-center gap-1">
          {tabs.map(t => {
            const s = t.state ? STATUS_STYLES[t.state] : null
            const active = filter === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilter(t.id)}
                className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border transition-all ${
                  active
                    ? (s ? `${s.chip} ring-1 ring-white/10` : "bg-white/[0.08] border-white/20 text-slate-100")
                    : "border-white/[0.06] bg-white/[0.02] text-slate-400 hover:text-slate-200"
                } ${t.bleOnly ? "opacity-80" : ""}`}
                title={t.bleOnly ? "BLE 비활성 — 0 으로 집계" : undefined}
              >
                {s && <span className={`w-1 h-1 rounded-full ${s.dot}`} />}
                <span>{t.label}</span>
                <span className="tabular-nums font-bold">{t.count}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-1 space-y-1">
        {visibleRows.length === 0 ? (
          <div className="text-center text-xs text-slate-500 py-6">
            현재 이탈/자리 비움 상태가 없습니다.
          </div>
        ) : (
          visibleRows.map(row => {
            const s = STATUS_STYLES[row.state]
            const selected = row.participant_id === selectedParticipantId
            const busy = busyIds.has(row.participant_id)
            const location = row.last_room_name
              ? `${row.floor_no ? `${row.floor_no}F ` : ""}${row.is_foreign && row.origin_store_name ? row.origin_store_name : "마블"} ${row.last_room_name}`
              : "—"
            const recs = alertsByParticipantId?.get(row.participant_id) ?? []
            const hasLongMidOut = recs.some(r => r.code === "long_mid_out")
            return (
              <div
                key={row.participant_id}
                className={`flex flex-col gap-1 rounded-md px-2 py-1.5 border transition-all ${
                  selected
                    ? "bg-cyan-500/[0.08] border-cyan-300/40 ring-1 ring-cyan-300/40"
                    : hasLongMidOut
                      ? "border-red-500/45 bg-red-500/[0.04] ring-1 ring-red-500/30"
                      : `${s.border} bg-white/[0.02]`
                }`}
              >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSelectWorker({
                    participant_id: row.participant_id,
                    membership_id: row.membership_id,
                    room_uuid: row.last_room_uuid,
                  })}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left"
                >
                  <span className={`w-6 h-6 rounded-full border flex items-center justify-center text-[10px] font-bold ${s.chip} flex-shrink-0`}>
                    {row.display_name.slice(0, 1) || "?"}
                  </span>
                  <span className="text-[12px] text-slate-100 font-semibold truncate w-[70px] flex-shrink-0">
                    {row.display_name}
                    {row.is_foreign && row.origin_store_name && (
                      <span className="text-[10px] text-fuchsia-300 font-normal ml-1">({row.origin_store_name})</span>
                    )}
                    {row.operator_status === "extended" && row.extension_count > 0 && (
                      <span
                        className="ml-1 text-[9.5px] font-semibold px-1.5 py-0.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 align-middle"
                        title="연장이 기록된 참여자"
                      >연장 {row.extension_count}회</span>
                    )}
                  </span>
                  <span className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-slate-400 truncate">{location}</span>
                    {row.membership_id && bleConfidenceByMembership?.get(row.membership_id) && (
                      <ConfidenceBadge
                        data={bleConfidenceByMembership.get(row.membership_id)!}
                        showLevel={confidenceMode !== "basic"}
                        showDetail={confidenceMode === "detail"}
                      />
                    )}
                    {row.membership_id && bleByMembership?.get(row.membership_id) && (
                      <BleHint
                        zone={bleByMembership.get(row.membership_id)!.zone}
                        source={bleByMembership.get(row.membership_id)!.source}
                      />
                    )}
                  </span>
                  <span className={`text-[10px] ${s.text} tabular-nums w-10 text-right flex-shrink-0`}>
                    {elapsedLabel(row.since_iso).replace(" 전", " 경과")}
                  </span>
                </button>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    disabled={!canAct || busy}
                    onClick={() => handleReturn(row)}
                    className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold text-emerald-200 bg-emerald-500/10 border border-emerald-500/35 hover:bg-emerald-500/20 disabled:opacity-35 disabled:cursor-not-allowed"
                    title="복귀 처리 — 수동 엔드포인트 준비 중"
                  >복귀 처리</button>
                  <button
                    type="button"
                    disabled={!canAct || busy}
                    onClick={() => handleTerminate(row)}
                    className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold text-red-200 bg-red-500/10 border border-red-500/35 hover:bg-red-500/20 disabled:opacity-35 disabled:cursor-not-allowed"
                    title="종료 처리 — /counter 체크아웃 흐름 사용"
                  >종료 처리</button>
                </div>
              </div>
              {showRecommendations && recs.length > 0 && (
                <div className="flex flex-wrap gap-1 pl-8">
                  {recs.map(r => (
                    <span
                      key={r.code}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-semibold ${
                        r.code === "long_mid_out"
                          ? "bg-red-500/15 border-red-500/40 text-red-200"
                          : r.code === "overdue"
                            ? "bg-orange-500/15 border-orange-500/40 text-orange-200"
                            : r.code === "long_session"
                              ? "bg-amber-500/15 border-amber-500/40 text-amber-200"
                              : "bg-cyan-500/15 border-cyan-500/40 text-cyan-200"
                      }`}
                      title={REC_LABEL[r.code]}
                    >
                      <span aria-hidden>⚠</span>
                      <span>{r.message}</span>
                    </span>
                  ))}
                </div>
              )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
