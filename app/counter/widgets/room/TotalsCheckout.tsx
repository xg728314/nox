"use client"

/**
 * TotalsCheckout — Phase A scaffold.
 * visibility: active_expanded.
 * 원본: RoomCardV2 L780-814.
 */

import { useRoomContext } from "../RoomContext"
import { fmtWon } from "../../helpers"

export default function TotalsCheckout() {
  const {
    participantTotal, orderTotal, grandTotal,
    hasUnresolved, unresolvedCount, busy, swipeX,
    onSwipeStart, onSwipeMove, onSwipeEnd,
  } = useRoomContext()

  return (
    <div className="px-4 py-3 border-t border-white/10 bg-black/30">
      <div className="text-[10px] text-slate-500 mb-1.5">정산 확인</div>
      <div className="space-y-1 text-sm mb-3">
        <div className="flex justify-between text-slate-400"><span>스태프 타임</span><span>{fmtWon(participantTotal)}</span></div>
        <div className="flex justify-between text-slate-400"><span>주문 합계</span><span>{fmtWon(orderTotal)}</span></div>
        <div className="flex justify-between text-emerald-300 font-bold pt-1 border-t border-white/10">
          <span>현재 합계</span>
          <span className="text-lg">{fmtWon(grandTotal)}</span>
        </div>
      </div>

      {hasUnresolved && (
        <div className="mb-1.5 text-xs text-amber-400 text-center font-medium">스태프 {unresolvedCount}명 확정 후 체크아웃 가능</div>
      )}
      <div
        onPointerDown={hasUnresolved ? undefined : onSwipeStart}
        onPointerMove={hasUnresolved ? undefined : onSwipeMove}
        onPointerUp={hasUnresolved ? undefined : onSwipeEnd}
        onPointerCancel={hasUnresolved ? undefined : onSwipeEnd}
        className={`relative h-12 rounded-xl overflow-hidden select-none touch-none ${
          hasUnresolved
            ? "bg-slate-500/10 border border-slate-500/20 cursor-not-allowed"
            : "bg-orange-500/20 border border-orange-500/40 cursor-pointer"
        }`}
        role="button" aria-label="밀어서 체크아웃"
      >
        {!hasUnresolved && (
          <div className="absolute top-0 left-0 h-full bg-orange-500/60 transition-none" style={{ width: `${Math.min(100, (swipeX / 240) * 100)}%` }} />
        )}
        <div className={`absolute inset-0 flex items-center justify-center text-sm font-bold pointer-events-none ${hasUnresolved ? "text-slate-500" : "text-white"}`}>
          {busy ? "처리 중..." : hasUnresolved ? "스태프 확정 필요" : "━ 밀어서 체크아웃 ━→"}
        </div>
      </div>
    </div>
  )
}
