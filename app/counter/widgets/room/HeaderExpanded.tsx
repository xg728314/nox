"use client"

/**
 * HeaderExpanded — Phase A scaffold.
 * visibility: expanded_only (isFocused).
 * 원본: RoomCardV2 L225-287 의 isFocused 경로.
 */

import { useRoomContext } from "../RoomContext"
import { remainingColor, fmtRemaining } from "../../helpers"
import { formatRoomLabel } from "@/lib/rooms/formatRoomLabel"

export default function HeaderExpanded() {
  const {
    room, isActive, isFocused, collapsedRemMs,
    dominantCategory,
    onFocus, onBlurFocus, onOpenMgrModal,
  } = useRoomContext()

  return (
    <div
      onClick={() => (isFocused ? onBlurFocus() : onFocus(room))}
      className={`px-4 cursor-pointer ${isActive ? "py-3" : "py-2.5"}`}
    >
      {isActive && room.session ? (
        <div className="flex items-center justify-between mb-1.5 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[15px] font-bold flex-shrink-0">{formatRoomLabel(room)}</span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/80 text-white flex-shrink-0">사용</span>
            <button
              onClick={async e => { e.stopPropagation(); if (!isFocused) await onFocus(room); onOpenMgrModal() }}
              className={`text-[13px] font-medium truncate max-w-[6rem] ${room.session.manager_name ? "text-purple-300 hover:text-purple-200" : "text-amber-400 hover:text-amber-300"}`}
            >
              {room.session.manager_name || "실장 미지정"}
            </button>
            <span className="text-[11px] text-slate-500 flex-shrink-0">·</span>
            <span className="text-[12px] font-semibold text-slate-200 flex-shrink-0">{dominantCategory}</span>
          </div>
          <span className={`text-xl font-bold flex-shrink-0 ${remainingColor(collapsedRemMs)}`}>{fmtRemaining(collapsedRemMs)}</span>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-bold text-slate-400">{formatRoomLabel(room)}</span>
            <span className="text-xs text-slate-600">비어있음</span>
          </div>
        </div>
      )}
    </div>
  )
}
