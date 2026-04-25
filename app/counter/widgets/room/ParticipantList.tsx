"use client"

/**
 * ParticipantList — Phase A scaffold.
 * visibility: active_expanded.
 * 원본: RoomCardV2 L745-778.
 */

import { useRoomContext } from "../RoomContext"
import ParticipantCardV2 from "../../components/cards/ParticipantCardV2"
import type { Participant } from "../../types"

export default function ParticipantList() {
  const {
    focusData, hostesses, selectedIds, currentStoreUuid, basis, now,
    hostessNamePool, dominantManagerMembershipId,
    onToggleSelect, onOpenSheet, onNameBlur, onMidOut, onDeleteParticipant,
    onInlineEditParticipant,
  } = useRoomContext()

  if (!focusData) return null

  return (
    <div className="py-1.5 px-4 border-t border-white/10">
      {focusData.loading ? (
        <div className="py-4 text-center text-slate-500 text-sm animate-pulse">불러오는 중...</div>
      ) : hostesses.length === 0 ? (
        <div className="py-3 text-center text-slate-600 text-sm">등록된 스태프가 없습니다.</div>
      ) : (
        <div className={`flex flex-col gap-0.5 ${hostesses.length > 6 ? "max-h-[200px] overflow-y-auto overscroll-contain pr-0.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded" : ""}`}>
          {hostesses.map((h: Participant) => (
            <ParticipantCardV2
              key={h.id}
              h={h}
              selected={selectedIds.has(h.id)}
              currentStoreUuid={currentStoreUuid}
              basis={basis}
              now={now}
              participants={focusData.participants}
              sessionStartedAt={focusData.started_at}
              onToggle={onToggleSelect}
              onOpenEdit={onOpenSheet}
              onNameBlur={onNameBlur}
              onMidOut={onMidOut}
              onDelete={onDeleteParticipant}
              hostessNamePool={hostessNamePool}
              currentManagerMembershipId={dominantManagerMembershipId}
              onInlineEdit={onInlineEditParticipant}
            />
          ))}
        </div>
      )}
      {hostesses.length > 6 && (
        <div className="text-center text-[10px] text-slate-600 mt-0.5">↕ 스크롤 ({hostesses.length}명)</div>
      )}
    </div>
  )
}
