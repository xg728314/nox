"use client"

/**
 * ActionRow — Phase A scaffold.
 * visibility: active_expanded.
 * 원본: RoomCardV2 L708-728.
 */

import { useRoomContext } from "../RoomContext"

export default function ActionRow() {
  const { busy, onAddHostess, onSetOrderOpen, onInterimReceipt } = useRoomContext()

  return (
    <div className="px-4 py-1.5 border-t border-white/10 flex justify-center">
      <div className="grid grid-cols-3 gap-1 max-w-[320px] w-full">
        <button onClick={onAddHostess} className="h-8 rounded-lg bg-white/[0.06] border border-white/10 text-[12px] text-slate-200 hover:bg-white/10 active:scale-95 transition-all">+ 스태프</button>
        <button onClick={() => onSetOrderOpen((v: boolean) => !v)} className="h-8 rounded-lg bg-white/[0.06] border border-white/10 text-[12px] text-slate-200 hover:bg-white/10 active:scale-95 transition-all">+ 주문</button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onInterimReceipt()
          }}
          disabled={busy}
          className="h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 text-[12px] text-amber-300 hover:bg-amber-500/20 active:scale-95 transition-all disabled:opacity-50"
        >계산</button>
      </div>
    </div>
  )
}
