"use client"

/**
 * SelectionBar — Phase A scaffold.
 * visibility: selection_active (isFocused && isActive && selectedIds.size > 0).
 * 원본: RoomCardV2 L559-573. extendOpen 일 때는 원본도 숨김 처리.
 */

import { useRoomContext } from "../RoomContext"

export default function SelectionBar() {
  const {
    selectedIds, busy, extendOpen, setExtendOpen, onMidOut,
  } = useRoomContext()

  // visibility hint 가 selection_active 이므로 selectedIds.size > 0 는 보장됨.
  // extendOpen 시에는 숨겨야 함 (원본과 동일).
  if (extendOpen) return null

  return (
    <div className="px-4 py-2 bg-white/[0.02] border-y border-white/[0.06] flex items-center gap-2">
      <span className="text-xs text-slate-300 font-semibold">{selectedIds.size}명 선택</span>
      <button onClick={() => setExtendOpen(true)} disabled={busy} className="ml-auto text-xs py-1.5 px-3 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 disabled:opacity-50">
        개별 연장
      </button>
      <button
        onClick={() => [...selectedIds].forEach(pid => onMidOut(pid))}
        disabled={busy}
        className="text-xs py-1.5 px-3 rounded-lg bg-red-500/20 text-red-300 border border-red-500/30 disabled:opacity-50"
      >
        팅기기
      </button>
    </div>
  )
}
