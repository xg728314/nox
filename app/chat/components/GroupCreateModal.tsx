"use client"

import type { StaffMember } from "../hooks/useChatRooms"
import type { CreateFormState } from "../hooks/useGroupChat"
import MemberPicker from "./MemberPicker"

/**
 * GroupCreateModal — group chat creation form. Pure UI.
 * Fetch / validation / API call all live in useGroupChat.
 */

type Props = {
  open: boolean
  form: CreateFormState
  staff: StaffMember[]
  staffLoading: boolean
  creating: boolean
  error: string
  onClose: () => void
  onNameChange: (v: string) => void
  onToggleMember: (membershipId: string) => void
  onSubmit: () => void
}

export default function GroupCreateModal({
  open, form, staff, staffLoading, creating, error,
  onClose, onNameChange, onToggleMember, onSubmit,
}: Props) {
  if (!open) return null

  const selectedCount = form.selectedMemberIds.size

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#0d1020] border border-white/10 rounded-2xl p-5 w-[440px] max-w-[94vw] max-h-[90vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-sm font-semibold text-white mb-1">그룹 채팅 생성</div>
        <div className="text-[11px] text-slate-500 mb-3">이름을 입력하고 초대할 멤버를 선택하세요.</div>

        {error && (
          <div className="mb-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[11px]">{error}</div>
        )}

        <div className="mb-3">
          <label className="block text-[10px] text-slate-400 mb-1">그룹 이름</label>
          <input
            type="text"
            value={form.name}
            onChange={e => onNameChange(e.target.value)}
            placeholder="예: 매장 실장 그룹"
            maxLength={100}
            className="w-full rounded-lg bg-white/5 border border-white/10 text-white px-3 py-2 text-xs focus:outline-none focus:border-cyan-500/40 placeholder:text-slate-600"
          />
        </div>

        <div className="flex-1 min-h-0 flex flex-col mb-3">
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] text-slate-400">초대할 멤버</label>
            <span className="text-[10px] text-slate-500">{selectedCount}명 선택</span>
          </div>
          <MemberPicker
            staff={staff}
            loading={staffLoading}
            selectedIds={form.selectedMemberIds}
            onToggle={onToggleMember}
            emptyText="등록된 스태프가 없습니다."
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="py-2 rounded-xl text-xs text-slate-400 hover:text-white border border-white/10 hover:border-white/20 disabled:opacity-50"
          >취소</button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={creating}
            className="py-2 rounded-xl text-xs font-semibold text-white bg-cyan-500/80 hover:bg-cyan-500 disabled:opacity-50"
          >{creating ? "생성 중..." : "생성"}</button>
        </div>
      </div>
    </div>
  )
}
