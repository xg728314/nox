"use client"

import type { MonitorMovementEvent, MonitorRoom } from "../types"
import { STATUS_STYLES, elapsedLabel, type WorkerState } from "../statusStyles"

/**
 * MovementFeed — 최근 이동 이벤트.
 *
 * Screenshot row layout: time (monospace) · avatar+name (with origin) ·
 * path "A → B" · state badge · "N분 경과". Rows referencing a
 * `session_participants` entity are clickable — click selects the worker
 * and draws their path on the floor map.
 */

type Props = {
  events: MonitorMovementEvent[]
  rooms: MonitorRoom[]
  onSelectParticipant?: (participant_id: string, room_uuid: string | null) => void
  participantNameById?: Map<string, { name: string; origin_store_name: string | null }>
  onOpenAll?: () => void
}

const KIND_META: Record<string, {
  label: string
  state: WorkerState | null
  path: (roomName: string | null) => string
  badge: string
}> = {
  session_checkin:     { label: "세션 시작",   state: "present", path: r => `${r ?? "방"} 입장`,       badge: "입장" },
  session_checkout:    { label: "세션 종료",   state: "waiting", path: r => `${r ?? "방"} 종료`,       badge: "종료" },
  participant_added:   { label: "참여자 추가", state: "present", path: r => `${r ?? "방"} 입장`,       badge: "입장" },
  participant_mid_out: { label: "중간 퇴장",   state: "mid_out", path: r => `${r ?? "방"} → 카운터`,   badge: "이탈" },
  participant_deleted: { label: "참여자 삭제", state: "waiting", path: r => `${r ?? "방"} 삭제`,       badge: "삭제" },
}

function fmtClock(iso: string): string {
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ""
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map(n => String(n).padStart(2, "0"))
      .join(":")
  } catch { return "" }
}

export default function MovementFeed({
  events, rooms, onSelectParticipant, participantNameById, onOpenAll,
}: Props) {
  const roomNameByUuid = new Map<string, string>()
  for (const r of rooms) roomNameByUuid.set(r.room_uuid, r.room_name)

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-1 mb-2">
        <span className="text-[12px] font-bold text-slate-100">최근 이동 이벤트</span>
        <button
          type="button"
          onClick={onOpenAll}
          className="text-[10px] text-slate-500 hover:text-slate-200 underline-offset-2 hover:underline"
        >전체 보기</button>
      </div>
      {events.length === 0 ? (
        <div className="text-center text-xs text-slate-500 py-6">최근 이벤트 없음</div>
      ) : (
        <div className="flex-1 overflow-y-auto pr-1 space-y-0.5">
          {events.map((e, idx) => {
            const roomLabel = e.room_uuid ? roomNameByUuid.get(e.room_uuid) ?? null : null
            const meta = KIND_META[e.kind] ?? {
              label: e.kind, state: null, path: () => e.kind, badge: e.kind,
            }
            const style = meta.state ? STATUS_STYLES[meta.state] : null
            const isParticipant =
              e.entity_table === "session_participants" &&
              typeof e.entity_id === "string" &&
              e.entity_id.length > 0
            const clickable = isParticipant && !!onSelectParticipant
            const nameInfo = isParticipant ? participantNameById?.get(e.entity_id as string) : undefined
            return (
              <button
                type="button"
                key={`${e.at}:${idx}`}
                disabled={!clickable}
                onClick={() => clickable && onSelectParticipant?.(e.entity_id as string, e.room_uuid)}
                className={`w-full text-left grid items-center gap-2 rounded-md px-2 py-1.5 text-[11px] transition-all ${
                  clickable ? "hover:bg-white/[0.04] cursor-pointer" : "cursor-default"
                }`}
                style={{ gridTemplateColumns: "62px 1.1fr 1.5fr 56px 68px" }}
              >
                <span className="text-slate-500 font-mono text-[10px] tabular-nums">{fmtClock(e.at)}</span>
                <span className="flex items-center gap-1.5 truncate min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full ${style?.dot ?? "bg-slate-400"} flex-shrink-0`} />
                  <span className="text-slate-100 font-semibold truncate">
                    {nameInfo?.name ?? meta.label}
                    {nameInfo?.origin_store_name && (
                      <span className="text-[10px] text-slate-500 font-normal ml-1">({nameInfo.origin_store_name})</span>
                    )}
                  </span>
                </span>
                <span className="text-[11px] text-slate-300 truncate">
                  {meta.path(roomLabel)}
                </span>
                <span className={`text-[10px] font-semibold text-center px-1.5 py-0.5 rounded-md border ${style?.chip ?? "border-white/10 bg-white/[0.03] text-slate-300"}`}>
                  {meta.badge}
                </span>
                <span className="text-[10px] text-slate-500 tabular-nums text-right">
                  {elapsedLabel(e.at).replace(" 전", " 경과")}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
