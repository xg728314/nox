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
          for (const entry of entries) {
            const res = await onAddHostessWithName({
              external_name: entry.name,
              session_id: activeSessionId,
              origin_store_name: entry.origin_store_name,
              category: entry.category,
              ticket_type: entry.ticket_type,
            })
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
    </>
  )
}
