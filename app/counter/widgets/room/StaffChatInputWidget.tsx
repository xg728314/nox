"use client"

/**
 * StaffChatInputWidget — Phase A scaffold.
 * visibility: active_expanded.
 * 원본: RoomCardV2 L575-706.
 */

import { useRoomContext } from "../RoomContext"
import StaffChatInput from "../../components/StaffChatInput"
import { parseStaffChat } from "../../helpers/staffChatParser"
import { ticketToPreset } from "../../hooks/useParticipantMutations"
import CafeOrderButton from "@/components/cafe/CafeOrderButton"

export default function StaffChatInputWidget() {
  const {
    room, busy, dominantCategory,
    staffChatValue, setStaffChatValue,
    staffChatSubmitting, setStaffChatSubmitting,
    staffChatError, setStaffChatError,
    onAddHostessWithName, onRefreshAfterStaffChat,
    onOpenSheet, onOpenBulkManagerPicker,
  } = useRoomContext()

  return (
    <>
      <StaffChatInput
        value={staffChatValue}
        onChange={(v) => { setStaffChatValue(v); if (staffChatError) setStaffChatError("") }}
        onSubmit={async () => {
          if (staffChatSubmitting) return
          setStaffChatError("")
          const { entries, warnings } = parseStaffChat(staffChatValue, dominantCategory || null)
          if (entries.length === 0) {
            setStaffChatError(
              warnings.length > 0
                ? `이름 토큰이 없어 추가하지 않았습니다. (${warnings.length}개 경고)`
                : "이름 토큰이 없어 추가하지 않았습니다."
            )
            return
          }
          if (!onAddHostessWithName) {
            setStaffChatError("일괄 추가 기능이 연결되지 않았습니다. + 스태프 버튼을 사용해주세요.")
            return
          }
          setStaffChatSubmitting(true)
          const activeSessionId = room.session?.id ?? null
          const failures: string[] = []
          const addWarnings: string[] = []
          let successCount = 0
          let lastParticipantId: string | null = null
          const successParticipantIds: string[] = []
          // 2026-05-01 R-Counter-Speed: 직렬 for-of → Promise.all 병렬.
          //   서버는 각 POST 가 독립 INSERT 라 순서 의존 없음. 4명 entry 면
          //   직렬 4× RTT → 1× RTT (max-of-4).
          const results = await Promise.all(
            entries.map((entry) =>
              onAddHostessWithName({
                external_name: entry.name,
                session_id: activeSessionId,
                origin_store_name: entry.origin_store_name,
                category: entry.category,
                ticket_type: entry.ticket_type,
              }).then((res) => ({ entry, res }))
            )
          )
          for (const { entry, res } of results) {
            if (res.ok) {
              successCount++
              if (res.participant_id) {
                lastParticipantId = res.participant_id
                successParticipantIds.push(res.participant_id)
              }
              if (res.warning) addWarnings.push(`${entry.name}: ${res.warning}`)
            } else {
              failures.push(`${entry.name}: ${res.error ?? "실패"}`)
            }
          }
          setStaffChatSubmitting(false)
          if (successCount > 0 && onRefreshAfterStaffChat) {
            try { await onRefreshAfterStaffChat(room.id, activeSessionId) }
            catch { /* ignore — polling will catch up */ }
          }
          const firstEntry = entries[0]
          const firstStore = firstEntry?.origin_store_name ?? null
          const allSameStore =
            !!firstStore &&
            entries.every(e => (e.origin_store_name ?? null) === firstStore)
          const sharedStoreName = allSameStore ? firstStore : null
          if (
            entries.length === 1 &&
            successCount === 1 &&
            lastParticipantId &&
            sharedStoreName
          ) {
            const presetForHint = ticketToPreset(firstEntry.ticket_type, firstEntry.category)
            onOpenSheet(lastParticipantId, {
              storeName: sharedStoreName,
              category: firstEntry.category,
              timeMinutes: presetForHint?.time_minutes ?? null,
              ticketType: firstEntry.ticket_type ?? null,
            })
          } else if (
            entries.length > 1 &&
            successParticipantIds.length > 0 &&
            sharedStoreName &&
            onOpenBulkManagerPicker
          ) {
            // 2026-05-03 R-Privacy: 매장명만 알고 uuid 모르는 경로.
            //   server 가 POST body 로 받아 internal 해석 — URL log 에 매장명 안 남음.
            onOpenBulkManagerPicker({
              roomId: room.id,
              sessionId: activeSessionId,
              storeName: sharedStoreName,
              participantIds: successParticipantIds,
            })
          }
          if (failures.length === 0 && addWarnings.length === 0) {
            setStaffChatValue("")
          } else if (failures.length === 0) {
            setStaffChatValue("")
            setStaffChatError(
              `경고 ${addWarnings.length}건: ${addWarnings.slice(0, 3).join(" / ")}${addWarnings.length > 3 ? " …" : ""}`
            )
          } else {
            setStaffChatError(
              `${successCount}명 추가, ${failures.length}명 실패: ${failures.slice(0, 3).join(" / ")}${failures.length > 3 ? " …" : ""}`
            )
          }
        }}
        disabled={busy || staffChatSubmitting}
      />
      {staffChatError && (
        <div className="px-3 pb-2 -mt-1 text-[11px] text-red-400 leading-tight">
          {staffChatError}
        </div>
      )}
      {/* 2026-05-02 R-Cafe: 룸채팅 옆에 카페 주문 버튼.
          현재 active session 이 있어야 의미 있음 (room/session id 필요). */}
      {room.session?.id && (
        <div className="px-3 pb-2 flex justify-end">
          <CafeOrderButton
            room_uuid={room.id}
            session_id={room.session.id}
            room_label={`${room.room_no}번방`}
          />
        </div>
      )}
    </>
  )
}
