"use client"

/**
 * ExtendPanel — Phase A scaffold.
 * visibility: active_expanded + extendOpen gate.
 * 원본: RoomCardV2 L527-556.
 */

import { useRoomContext } from "../RoomContext"
import type { ExtendType } from "../../helpers"

export default function ExtendPanel() {
  const {
    selectedIds, busy, cats, extendRef,
    extendOpen, setExtendOpen,
    onExtendRoom,
  } = useRoomContext()

  if (!extendOpen) return null

  return (
    <div className="px-4 py-2.5 bg-cyan-500/5 border-y border-cyan-500/20">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-cyan-300 font-bold">
          {selectedIds.size > 0 ? `${selectedIds.size}명 개별 연장` : "방 전체 연장"}
        </span>
        <button onClick={() => setExtendOpen(false)} className="text-xs text-slate-500 hover:text-slate-300">닫기</button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(["완티", "반티", "차3"] as ExtendType[]).map(type => (
          <button
            key={type}
            onClick={() => {
              const ids = selectedIds.size > 0 ? [...selectedIds] : undefined
              onExtendRoom(type, ids)
              setExtendOpen(false)
            }}
            disabled={busy}
            className="py-2.5 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/25 active:scale-95 transition-all disabled:opacity-50"
          >
            <div>{type}</div>
            <div className="text-[11px] text-cyan-400/70 font-normal mt-0.5">{extendRef[type]}분</div>
          </button>
        ))}
      </div>
      {cats.length > 1 && (
        <div className="text-[10px] text-slate-500 mt-1.5 text-center">종목별 시간이 다를 수 있습니다 (개인 종목 기준 적용)</div>
      )}
    </div>
  )
}
