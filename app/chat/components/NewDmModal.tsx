"use client"

import type { StaffMember } from "../hooks/useChatRooms"

/**
 * NewDmModal — 1:1 채팅 시작 패널. Pure UI.
 * All fetch + create logic lives in useChatRooms.
 */

type Props = {
  open: boolean
  staff: StaffMember[]
  creating: boolean
  onPick: (targetMembershipId: string) => void
}

function roleLabel(role: string): string {
  return role === "owner" ? "사장" : role === "manager" ? "실장" : "스태프"
}

export default function NewDmModal({ open, staff, creating, onPick }: Props) {
  if (!open) return null
  return (
    <div className="mx-4 mt-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-2">
      <div className="text-xs text-slate-400 mb-2">1:1 채팅 시작</div>
      {staff.length === 0 && <div className="text-xs text-slate-500">스태프 로딩 중...</div>}
      {staff.map((s) => (
        <button
          key={s.membership_id}
          onClick={() => onPick(s.membership_id)}
          disabled={creating}
          className="w-full flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors disabled:opacity-50"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm">{s.name}</span>
            <span className="text-xs text-slate-500">{roleLabel(s.role)}</span>
          </div>
          <span className="text-xs text-cyan-400">채팅 →</span>
        </button>
      ))}
    </div>
  )
}
