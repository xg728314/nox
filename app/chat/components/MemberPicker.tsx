"use client"

import type { StaffMember } from "../hooks/useChatRooms"

/**
 * MemberPicker — reusable staff-picker list. Pure UI.
 *
 * Renders a scrollable list of store staff. Each row is a toggle / single-
 * select depending on the parent's usage. All fetch lives in useGroupChat.
 */

type Props = {
  staff: StaffMember[]
  loading: boolean
  selectedIds: Set<string>
  excludeIds?: Set<string>
  onToggle: (membershipId: string) => void
  emptyText?: string
}

function roleLabel(role: string): string {
  return role === "owner" ? "사장" : role === "manager" ? "실장" : "스태프"
}

export default function MemberPicker({
  staff, loading, selectedIds, excludeIds, onToggle, emptyText,
}: Props) {
  const visible = excludeIds
    ? staff.filter(s => !excludeIds.has(s.membership_id))
    : staff

  return (
    <div className="space-y-1 max-h-[240px] overflow-y-auto pr-0.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded">
      {loading && (
        <div className="py-6 text-center text-slate-500 text-xs animate-pulse">불러오는 중...</div>
      )}
      {!loading && visible.length === 0 && (
        <div className="py-6 text-center text-slate-500 text-xs">{emptyText ?? "표시할 멤버가 없습니다."}</div>
      )}
      {!loading && visible.map((s) => {
        const picked = selectedIds.has(s.membership_id)
        return (
          <button
            key={s.membership_id}
            type="button"
            onClick={() => onToggle(s.membership_id)}
            className={`w-full flex items-center justify-between p-3 rounded-xl border transition-colors ${
              picked
                ? "bg-cyan-500/15 border-cyan-500/40 text-white"
                : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/[0.08]"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{s.name}</span>
              <span className="text-[10px] text-slate-500">{roleLabel(s.role)}</span>
            </div>
            <span className={`text-[10px] ${picked ? "text-cyan-300" : "text-slate-600"}`}>
              {picked ? "✓ 선택" : "선택"}
            </span>
          </button>
        )
      })}
    </div>
  )
}
