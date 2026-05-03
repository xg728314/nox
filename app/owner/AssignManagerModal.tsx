"use client"

/**
 * AssignManagerModal — 미배정 스태프 1명에 실장 배정.
 *
 * 2026-05-03: app/owner/page.tsx 분할.
 *   순수 UI + 콜백 — fetch 는 부모.
 */

type StaffOption = { membership_id: string; name: string }

export type UnassignedHostess = {
  membership_id: string
  name: string
  stage_name: string | null
  phone: string | null
  created_at: string
}

type Props = {
  hostess: UnassignedHostess
  selectedManagerId: string
  managerOptions: StaffOption[]
  submitting: boolean
  onClose: () => void
  onSelect: (id: string) => void
  onSubmit: () => void
}

export default function AssignManagerModal({
  hostess,
  selectedManagerId,
  managerOptions,
  submitting,
  onClose,
  onSelect,
  onSubmit,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="w-full max-w-sm rounded-2xl border border-pink-400/25 bg-[#0A1222] p-5 space-y-3">
        <div>
          <div className="text-xs text-slate-400">실장 배정</div>
          <div className="text-base font-semibold text-pink-200 mt-0.5">
            {hostess.name}
            {hostess.stage_name && (
              <span className="ml-2 text-xs text-pink-300">@{hostess.stage_name}</span>
            )}
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">실장 선택</label>
          <select
            value={selectedManagerId}
            onChange={(e) => onSelect(e.target.value)}
            className="w-full bg-[#030814] border border-white/10 rounded-lg px-3 py-2 text-sm [&>option]:bg-[#030814]"
          >
            <option value="">실장을 선택하세요</option>
            {managerOptions.map((m) => (
              <option key={m.membership_id} value={m.membership_id}>
                {m.name || m.membership_id.slice(0, 8)}
              </option>
            ))}
          </select>
          {managerOptions.length === 0 && (
            <p className="mt-1 text-[11px] text-amber-300/80">
              승인된 실장이 없습니다. 먼저 실장 계정을 승인하세요.
            </p>
          )}
        </div>
        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 h-10 rounded-xl bg-white/5 text-slate-300 text-sm border border-white/10"
            disabled={submitting}
          >
            취소
          </button>
          <button
            onClick={onSubmit}
            disabled={!selectedManagerId || submitting}
            className="flex-1 h-10 rounded-xl bg-pink-500/25 text-pink-100 text-sm font-medium border border-pink-500/40 disabled:opacity-50"
          >
            {submitting ? "배정 중..." : "확인"}
          </button>
        </div>
      </div>
    </div>
  )
}
