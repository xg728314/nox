"use client"

import { useMemo, useState } from "react"
import type { StaffMember } from "../hooks/useChatRooms"
import type { GroupMember } from "../hooks/useGroupChat"
import MemberPicker from "./MemberPicker"

/**
 * GroupMembersPanel — manage members of an existing group chat. Pure UI.
 * Fetch / validation / API call all live in useGroupChat.
 *
 * Displays current active members with a remove (×) button per row.
 * Below the list, MemberPicker is used in "add" mode to invite new members.
 */

type Props = {
  open: boolean
  members: GroupMember[]
  membersLoading: boolean
  staff: StaffMember[]
  staffLoading: boolean
  error: string
  onClose: () => void
  onAdd: (ids: string[]) => void | Promise<void>
  onRemove: (membershipId: string) => void | Promise<void>
  // STEP-009.4: group close — creator/owner only. Parent computes canClose
  // from the current user's membership vs the room's creator/owner and passes
  // the async action through. The panel just renders the button + confirm.
  canClose?: boolean
  closing?: boolean
  onCloseGroup?: () => void | Promise<void>
}

function roleLabel(role: string | null): string {
  if (!role) return "-"
  return role === "owner" ? "사장" : role === "manager" ? "실장" : "스태프"
}

export default function GroupMembersPanel({
  open, members, membersLoading, staff, staffLoading, error,
  onClose, onAdd, onRemove,
  canClose = false, closing = false, onCloseGroup,
}: Props) {
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const currentMemberIds = useMemo(() => {
    const s = new Set<string>()
    for (const m of members) s.add(m.membership_id)
    return s
  }, [members])

  if (!open) return null

  const togglePick = (mid: string) => {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(mid)) next.delete(mid)
      else next.add(mid)
      return next
    })
  }

  const handleAdd = async () => {
    const ids = Array.from(picked)
    if (ids.length === 0) return
    await onAdd(ids)
    setPicked(new Set())
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#0d1020] border border-white/10 rounded-2xl p-5 w-[440px] max-w-[94vw] max-h-[90vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-semibold text-white">그룹 멤버</div>
          <button onClick={onClose} className="text-slate-500 text-xl hover:text-white">×</button>
        </div>
        <div className="text-[11px] text-slate-500 mb-3">현재 멤버를 관리하거나 새 멤버를 초대하세요.</div>

        {error && (
          <div className="mb-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[11px]">{error}</div>
        )}

        {/* Current members */}
        <div className="mb-3">
          <div className="text-[10px] text-slate-400 mb-1">현재 멤버 ({members.length})</div>
          <div className="space-y-1 max-h-[180px] overflow-y-auto pr-0.5">
            {membersLoading && (
              <div className="py-4 text-center text-slate-500 text-xs animate-pulse">불러오는 중...</div>
            )}
            {!membersLoading && members.length === 0 && (
              <div className="py-4 text-center text-slate-500 text-xs">멤버가 없습니다.</div>
            )}
            {!membersLoading && members.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/10"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm text-white truncate">{m.name ?? "(이름 없음)"}</span>
                  <span className="text-[10px] text-slate-500 flex-shrink-0">{roleLabel(m.role)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(m.membership_id)}
                  className="text-[10px] text-red-400 hover:text-red-300 px-2 py-0.5"
                >제거</button>
              </div>
            ))}
          </div>
        </div>

        {/* Add members */}
        <div className="flex-1 min-h-0 flex flex-col mb-3">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[10px] text-slate-400">멤버 초대</div>
            <span className="text-[10px] text-slate-500">{picked.size}명 선택</span>
          </div>
          <MemberPicker
            staff={staff}
            loading={staffLoading}
            selectedIds={picked}
            excludeIds={currentMemberIds}
            onToggle={togglePick}
            emptyText="추가할 수 있는 멤버가 없습니다."
          />
        </div>

        <button
          type="button"
          onClick={handleAdd}
          disabled={picked.size === 0}
          className="py-2 rounded-xl text-xs font-semibold text-white bg-cyan-500/80 hover:bg-cyan-500 disabled:opacity-40"
        >{picked.size > 0 ? `${picked.size}명 추가` : "멤버 선택"}</button>

        {canClose && onCloseGroup && (
          <button
            type="button"
            onClick={async () => {
              if (closing) return
              if (typeof window !== "undefined" && !window.confirm("이 그룹을 닫으시겠습니까?\n(모든 참여자에게 보이지 않게 되며 되돌릴 수 없습니다.)")) {
                return
              }
              await onCloseGroup()
            }}
            disabled={closing}
            className="mt-2 py-2 rounded-xl text-xs font-semibold text-red-300 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40"
          >{closing ? "닫는 중..." : "그룹 닫기"}</button>
        )}
      </div>
    </div>
  )
}
