"use client"

/**
 * EmptyRoomPanel — Phase A scaffold.
 * visibility: empty_expanded (isFocused && !isActive).
 * 원본: RoomCardV2 L289-453. 로직은 변경 없이 그대로 복사.
 */

import { useRoomContext } from "../RoomContext"
import StaffChatInput from "../../components/StaffChatInput"
import { parseStaffChat } from "../../helpers/staffChatParser"
import { ticketToPreset } from "../../hooks/useParticipantMutations"

export default function EmptyRoomPanel() {
  const ctx = useRoomContext()
  const {
    room, focusData, busy,
    staffChatValue, setStaffChatValue,
    staffChatSubmitting, setStaffChatSubmitting,
    staffChatError, setStaffChatError,
    dominantCategory,
    onAddHostess, onAddHostessWithName, onEnsureSession, onRefreshAfterStaffChat,
    onOpenSheet, onOpenBulkManagerPicker, onSetOrderOpen,
  } = ctx

  if (!focusData) return null

  return (
    <div className="border-t border-white/10 bg-black/20 px-4 py-3 space-y-2">
      <div className="text-xs text-slate-500">첫 작업 시 자동으로 세션이 생성됩니다.</div>

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
          let ensuredSessionId: string | null = null
          try {
            ensuredSessionId = await onEnsureSession(room.id)
          } catch {
            setStaffChatSubmitting(false)
            setStaffChatError("세션 생성에 실패했습니다. 다시 시도해주세요.")
            return
          }
          if (!ensuredSessionId) {
            setStaffChatSubmitting(false)
            setStaffChatError("세션 정보를 가져오지 못했습니다. 다시 시도해주세요.")
            return
          }
          const failures: string[] = []
          const addWarnings: string[] = []
          let successCount = 0
          let lastParticipantId: string | null = null
          const successParticipantIds: string[] = []
          for (const entry of entries) {
            const res = await onAddHostessWithName({
              external_name: entry.name,
              session_id: ensuredSessionId,
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
            try { await onRefreshAfterStaffChat(room.id, ensuredSessionId) }
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
              sessionId: ensuredSessionId,
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
        <div className="px-1 -mt-1 text-[11px] text-red-400 leading-tight">
          {staffChatError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button onClick={onAddHostess} disabled={busy} className="h-11 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-sm font-semibold text-cyan-300 disabled:opacity-50 active:scale-95 transition-all">
          + 스태프
        </button>
        <button onClick={async () => { await onEnsureSession(room.id); onSetOrderOpen(true) }} disabled={busy} className="h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-sm font-semibold text-emerald-300 disabled:opacity-50 active:scale-95 transition-all">
          + 주문
        </button>
      </div>
    </div>
  )
}
