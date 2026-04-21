"use client"

/**
 * OperationSummary — Phase A scaffold.
 * visibility: active_expanded.
 * 원본: RoomCardV2 L459-497.
 */

import { useRoomContext } from "../RoomContext"
import { fmtTime } from "../../helpers"

export default function OperationSummary() {
  const {
    room, cats,
    customerPartySize, hostessCount, totalHeadcount,
    expectedEndIso, onOpenCustomerModal,
  } = useRoomContext()

  return (
    <div className="px-4 py-2 border-b border-white/[0.06]">
      <div className="flex items-center gap-3 mb-1 flex-wrap">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenCustomerModal() }}
          className="text-[11px] text-slate-400 hover:text-cyan-300 transition-colors"
          title="손님 정보 편집"
        >
          손님 <span className="text-cyan-300 font-bold">{customerPartySize}</span>
        </button>
        <span className="text-[11px] text-slate-400">스태프 <span className="text-cyan-300 font-bold">{hostessCount}</span></span>
        <span className="text-[11px] text-slate-400">총인원 <span className="text-white font-bold">{totalHeadcount}</span></span>
        {room.session?.started_at && (
          <>
            <span className="text-slate-700 text-[11px]">·</span>
            <span className="text-[11px] text-slate-500">
              시작 <span className="text-slate-300 font-medium">{fmtTime(room.session.started_at)}</span>
              {expectedEndIso && (
                <> / 종료 <span className="text-slate-300 font-medium">{fmtTime(expectedEndIso)}</span></>
              )}
            </span>
          </>
        )}
      </div>
      {cats.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {cats.map(([cat, cnt]) => (
            <span key={cat} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-300">
              {cat}<span className="text-cyan-400 font-bold ml-0.5">{Number(cnt) || 0}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
