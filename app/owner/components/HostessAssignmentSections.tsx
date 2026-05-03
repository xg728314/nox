"use client"

/**
 * HostessAssignmentSections — 미배정 + 배정된 스태프 두 섹션.
 *
 * 2026-05-03: app/owner/page.tsx 분할.
 *   순수 표시 + 클릭 콜백.
 */

import type { UnassignedHostess } from "../AssignManagerModal"

type AssignedHostess = {
  membership_id: string
  name: string
  manager_membership_id: string | null
  manager_name: string | null
}

export function UnassignedHostessSection({
  unassigned,
  loading,
  onClickAssign,
}: {
  unassigned: UnassignedHostess[]
  loading: boolean
  onClickAssign: (h: UnassignedHostess) => void
}) {
  if (unassigned.length === 0) return null
  return (
    <div className="rounded-2xl border border-pink-400/20 bg-pink-500/5 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium text-pink-200">미배정 스태프</div>
        <div className="text-[11px] text-slate-500">{unassigned.length}명</div>
      </div>
      <div className="space-y-2">
        {unassigned.map((h) => (
          <div
            key={h.membership_id}
            className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-3"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-100 truncate">
                {h.name}
                {h.stage_name && (
                  <span className="ml-2 text-xs text-pink-300">@{h.stage_name}</span>
                )}
              </div>
              <div className="text-[11px] text-slate-500">
                {h.phone ? `📞 ${h.phone} · ` : ""}
                {new Date(h.created_at).toLocaleDateString("ko-KR")}
              </div>
            </div>
            <button
              onClick={() => onClickAssign(h)}
              className="text-xs px-3 py-1.5 rounded-lg bg-pink-500/20 text-pink-200 border border-pink-500/30 hover:bg-pink-500/30"
            >
              실장 배정
            </button>
          </div>
        ))}
      </div>
      {loading && <div className="mt-2 text-[11px] text-slate-500">로딩 중...</div>}
    </div>
  )
}

export function AssignedHostessSection({
  assigned,
  expanded,
  onToggle,
  busyId,
  onUnassign,
}: {
  assigned: AssignedHostess[]
  expanded: boolean
  onToggle: () => void
  busyId: string | null
  onUnassign: (h: AssignedHostess) => void
}) {
  if (assigned.length === 0) return null
  return (
    <div className="rounded-2xl border border-purple-400/20 bg-purple-500/5 p-4">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between mb-0 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-slate-400 text-xs">{expanded ? "▼" : "▶"}</span>
          <span className="text-sm font-medium text-purple-200">배정된 스태프</span>
        </div>
        <span className="text-[11px] text-slate-500">총 {assigned.length}명</span>
      </button>
      {expanded && (
        <div className="mt-3 space-y-2">
          {assigned.map((h) => (
            <div
              key={h.membership_id}
              className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-100 truncate">{h.name}</div>
                <div className="text-[11px] text-slate-500">
                  담당 실장:{" "}
                  <span className="text-purple-300">
                    {h.manager_name || h.manager_membership_id?.slice(0, 8) || "-"}
                  </span>
                </div>
              </div>
              <button
                onClick={() => onUnassign(h)}
                disabled={busyId === h.membership_id}
                className="text-xs px-3 py-1.5 rounded-lg bg-white/5 text-slate-300 border border-white/10 hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/30 disabled:opacity-50"
              >
                {busyId === h.membership_id ? "해제 중..." : "배정 해제"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
