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
    dominantCategory, customerPartySize,
    onFocus, onBlurFocus, onOpenMgrModal, onOpenCustomerModal,
  } = useRoomContext()

  return (
    <div
      onClick={() => (isFocused ? onBlurFocus() : onFocus(room))}
      className={`px-4 cursor-pointer ${isActive ? "py-3" : "py-2.5"}`}
    >
      {isActive && room.session ? (
        // 2026-04-25: 3-column 레이아웃 (left · center · right).
        //   - left: 방번호 + 사용 + 실장 + 손님 (펼침 상태에서도 손님 버튼 접근 가능)
        //   - center: 종목(퍼블릭 등) — collapsed 와 같은 위치 유지
        //   - right: 남은 시간 (58분)
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 mb-1.5">
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
            <button
              onClick={async e => { e.stopPropagation(); if (!isFocused) await onFocus(room); onOpenCustomerModal() }}
              className={`text-[12px] truncate max-w-[7rem] ${room.session.customer_name_snapshot ? "text-cyan-300 hover:text-cyan-200" : "text-slate-500 hover:text-slate-400"}`}
            >
              {room.session.customer_name_snapshot
                ? `${room.session.customer_name_snapshot}${customerPartySize > 0 ? ` ${customerPartySize}인` : ""}`
                : "손님 미입력"}
            </button>
          </div>
          <span className="text-[13px] font-semibold text-slate-200 text-center">{dominantCategory}</span>
          <span className={`text-xl font-bold text-right ${remainingColor(collapsedRemMs)}`}>{fmtRemaining(collapsedRemMs)}</span>
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
