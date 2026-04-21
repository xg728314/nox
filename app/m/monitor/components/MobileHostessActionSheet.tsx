"use client"

/**
 * MobileHostessActionSheet — 아바타 탭 시 열리는 바텀 액션 시트.
 * 3 옵션: 현재 위치 보기 / 위치 오류 수정 / 이동 기록 보기.
 * 실제 데이터 연결은 부모가 담당(선택한 participant 정보만 전달).
 */

export type ActionSubject = {
  participant_id: string | null
  membership_id: string | null
  room_uuid: string | null
  display_name: string
  current_location_text: string
}

type Props = {
  open: boolean
  subject: ActionSubject | null
  onClose: () => void
  onViewLocation: () => void
  onCorrect: () => void
  onHistory: () => void
}

export default function MobileHostessActionSheet({
  open, subject, onClose,
  onViewLocation, onCorrect, onHistory,
}: Props) {
  if (!open || !subject) return null

  const canCorrect = !!subject.membership_id
  const canHistory = !!subject.membership_id

  return (
    <div className="fixed inset-0 z-40 flex items-end" role="dialog" aria-modal="true" aria-label="작업 선택">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div
        className="relative w-full bg-[#0b0e1c] border-t border-white/[0.08] rounded-t-2xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <header className="px-4 py-3 border-b border-white/[0.06]">
          <div className="text-[13px] font-bold text-slate-100">{subject.display_name}</div>
          <div className="text-[10px] text-slate-500">현재: {subject.current_location_text}</div>
        </header>
        <div className="p-2 grid gap-1">
          <Action onClick={onViewLocation}>📍 현재 위치 보기</Action>
          <Action onClick={onCorrect} disabled={!canCorrect} disabledHint="membership 정보 없음">
            ✏️ 위치 오류 수정
          </Action>
          <Action onClick={onHistory} disabled={!canHistory} disabledHint="membership 정보 없음">
            🕐 이동 기록 보기
          </Action>
        </div>
        <div className="p-2 border-t border-white/[0.06]">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-lg bg-white/[0.04] border border-white/10 text-slate-300 text-[13px]"
          >취소</button>
        </div>
      </div>
    </div>
  )
}

function Action({
  onClick, disabled, disabledHint, children,
}: {
  onClick: () => void
  disabled?: boolean
  disabledHint?: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full text-left px-4 py-3 rounded-lg bg-white/[0.03] border border-white/10 text-slate-100 text-[13px] hover:bg-white/[0.06] disabled:opacity-40"
    >
      <span>{children}</span>
      {disabled && disabledHint && (
        <span className="block text-[10px] text-slate-500 mt-0.5">{disabledHint}</span>
      )}
    </button>
  )
}
