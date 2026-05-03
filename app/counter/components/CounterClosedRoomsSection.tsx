"use client"

/**
 * CounterClosedRoomsSection — "완료" 그리드 (마감된 세션이 있는 방 모음).
 *
 * 2026-05-03: CounterPageV2.tsx 분할.
 *   목록이 비어있으면 부모에서 조건부 render. 여기선 항상 그려도 안전한 형태.
 */

import type { Room } from "../types"
import ClosedRoomCardV2 from "./cards/ClosedRoomCardV2"

type Props = {
  closedRooms: Room[]
  effectiveMode: "mobile" | "pc"
  onClickClosed: (sessionId: string) => void
  onReopened: () => void
}

export default function CounterClosedRoomsSection({
  closedRooms,
  effectiveMode,
  onClickClosed,
  onReopened,
}: Props) {
  if (closedRooms.length === 0) return null
  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="text-[10px] text-slate-500 font-semibold">완료</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-500 font-medium">
          {closedRooms.length}건
        </span>
      </div>
      <div className={`grid ${effectiveMode === "mobile" ? "grid-cols-3" : "grid-cols-4"} gap-1.5`}>
        {closedRooms.map(room => (
          <ClosedRoomCardV2
            key={`closed-${room.id}`}
            room={room}
            onClickClosed={onClickClosed}
            onReopened={onReopened}
          />
        ))}
      </div>
    </div>
  )
}
