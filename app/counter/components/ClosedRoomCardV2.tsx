"use client"

import type { Room } from "../types"
import { fmtWon, fmtTime } from "../helpers"

type Props = {
  room: Room
  onClickClosed: (sessionId: string) => void
}

export default function ClosedRoomCardV2({ room, onClickClosed }: Props) {
  const s = room.closed_session
  if (!s) return null

  return (
    <div
      onClick={() => onClickClosed(s.id)}
      className="flex flex-col items-center justify-center px-2 py-2 rounded-lg bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/15 transition-all cursor-pointer group min-h-[56px]"
    >
      {/* Line 1: Room name + badge */}
      <div className="flex items-center gap-1 mb-0.5">
        <span className="text-[12px] font-bold text-slate-500">
          {room.room_name || room.room_no}
        </span>
        <span className="text-[8px] px-1 py-px rounded bg-slate-500/20 text-slate-500 font-semibold">
          완료
        </span>
      </div>

      {/* Line 2: Amount */}
      <span className="text-[11px] font-semibold text-slate-400">
        {fmtWon(s.gross_total)}
      </span>

      {/* Line 3: End time */}
      {s.ended_at && (
        <span className="text-[9px] text-slate-600 group-hover:text-cyan-400 transition-colors">
          {fmtTime(s.ended_at)}
        </span>
      )}
    </div>
  )
}
