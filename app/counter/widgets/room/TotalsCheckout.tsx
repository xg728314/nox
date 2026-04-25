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
    hasUnassignedManager, unassignedManagerCount,
    onSwipeStart, onSwipeMove, onSwipeEnd,
  } = useRoomContext()

  // 2026-04-24: 체크아웃 차단 조건 통합 — 스태프 미확정 + 실장 미지정.
  const blocked = hasUnresolved || hasUnassignedManager
  const blockMsg = hasUnresolved
    ? `스태프 ${unresolvedCount}명 확정 후 체크아웃 가능`
    : hasUnassignedManager
      ? `실장 미지정 (스태프 ${unassignedManagerCount}명). 실장 배정 후 체크아웃 가능`
      : ""

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

      {blocked && (
        <div className="mb-1.5 text-xs text-amber-400 text-center font-medium">{blockMsg}</div>
      )}
      {/* 2026-04-25: 슬라이드 진행률 숫자 + 완료 임계(240px) 표시.
          이전엔 얼마나 밀어야 완료되는지 시각적 피드백 없어서 2~3회 시도
          후 포기하는 문제. 진행률과 "놓으면 완료" 메시지로 개선. */}
      <div
        onPointerDown={blocked ? undefined : onSwipeStart}
        onPointerMove={blocked ? undefined : onSwipeMove}
        onPointerUp={blocked ? undefined : onSwipeEnd}
        onPointerCancel={blocked ? undefined : onSwipeEnd}
        className={`relative h-14 rounded-xl overflow-hidden select-none touch-none ${
          blocked
            ? "bg-slate-500/10 border border-slate-500/20 cursor-not-allowed"
            : "bg-orange-500/20 border border-orange-500/40 cursor-pointer"
        }`}
        role="button" aria-label="밀어서 체크아웃"
        aria-valuenow={Math.min(100, Math.round((swipeX / 240) * 100))}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {!blocked && (
          <>
            {/* 진행 배경 */}
            <div
              className={`absolute top-0 left-0 h-full transition-none ${
                swipeX >= 240 ? "bg-emerald-500/70" : "bg-orange-500/60"
              }`}
              style={{ width: `${Math.min(100, (swipeX / 240) * 100)}%` }}
            />
            {/* 완료 임계 마커 (240px 지점) */}
            <div className="absolute top-0 right-4 h-full w-0.5 bg-white/30 pointer-events-none" />
          </>
        )}
        <div className={`absolute inset-0 flex items-center justify-center gap-2 text-sm font-bold pointer-events-none ${blocked ? "text-slate-500" : "text-white"}`}>
          {busy
            ? "처리 중..."
            : hasUnresolved
              ? "스태프 확정 필요"
              : hasUnassignedManager
                ? "실장 배정 필요"
                : swipeX >= 240
                  ? "✓ 놓으면 체크아웃"
                  : swipeX > 0
                    ? `${Math.round((swipeX / 240) * 100)}% — 끝까지 미세요 →`
                    : "━ 밀어서 체크아웃 ━→"}
        </div>
      </div>
    </div>
  )
}
