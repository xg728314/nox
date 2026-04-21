"use client"

/**
 * TimeBasisToggle — Phase A scaffold.
 * visibility: active_expanded.
 * 원본: RoomCardV2 L499-524. 시간 기준 토글 + 채팅 진입 + 연장 버튼.
 */

import { useRoomContext } from "../RoomContext"

export default function TimeBasisToggle() {
  const {
    room, basis, busy, hostesses,
    extendOpen, setExtendOpen,
    onSetBasis, onNavigate,
  } = useRoomContext()

  const canExtend = hostesses.filter(h => h.status === "active" && h.category && h.time_minutes > 0).length > 0

  return (
    <div className="flex items-center justify-between px-4 py-1.5 border-b border-white/10 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-slate-500">시간</span>
        <div className="flex gap-1">
          <button onClick={() => onSetBasis(room.id, "room")} className={`px-2.5 py-0.5 rounded-md ${basis === "room" ? "bg-cyan-500/20 text-cyan-300" : "bg-white/5 text-slate-400"}`}>방</button>
          <button onClick={() => onSetBasis(room.id, "individual")} className={`px-2.5 py-0.5 rounded-md ${basis === "individual" ? "bg-cyan-500/20 text-cyan-300" : "bg-white/5 text-slate-400"}`}>개별</button>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <button onClick={() => onNavigate(`/chat?room=${room.id}`)} className="px-2 py-1 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/25 hover:bg-cyan-500/25">
          💬
        </button>
        <button
          onClick={() => setExtendOpen(v => !v)}
          disabled={busy || !canExtend}
          className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            extendOpen
              ? "bg-cyan-500/30 text-cyan-200 border border-cyan-500/40"
              : "bg-cyan-500/15 text-cyan-300 border border-cyan-500/25 hover:bg-cyan-500/25"
          }`}
        >
          {extendOpen ? "연장 닫기" : "연장"}
        </button>
      </div>
    </div>
  )
}
