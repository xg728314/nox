"use client"

/**
 * ROUND-CLEANUP-002: extracted from app/staff/page.tsx
 *
 * "조회 범위" 토글 — manager 에게만 노출.
 * owner / super_admin 은 항상 전체 조회라 표시하지 않음.
 *
 * 비즈니스 로직 변경 없음. props 로만 받는 presentational component.
 */

type VisibilityMode = "mine_only" | "store_shared"

type Props = {
  userRole: string | null
  mode: VisibilityMode
  busy: boolean
  onChange: (mode: VisibilityMode) => void
}

export default function VisibilityControl({ userRole, mode, busy, onChange }: Props) {
  if (userRole !== "manager") return null
  return (
    <div className="flex items-center gap-1 text-[11px]">
      <span className="text-slate-500">조회 범위:</span>
      <button
        onClick={() => onChange("mine_only")}
        disabled={busy}
        className={`px-2.5 py-1 rounded-md border transition-colors disabled:opacity-50 ${
          mode === "mine_only"
            ? "bg-pink-500/20 text-pink-200 border-pink-500/30"
            : "bg-white/[0.03] text-slate-400 border-white/10 hover:bg-white/[0.08]"
        }`}
      >
        내 스태프만
      </button>
      <button
        onClick={() => onChange("store_shared")}
        disabled={busy}
        className={`px-2.5 py-1 rounded-md border transition-colors disabled:opacity-50 ${
          mode === "store_shared"
            ? "bg-emerald-500/20 text-emerald-200 border-emerald-500/30"
            : "bg-white/[0.03] text-slate-400 border-white/10 hover:bg-white/[0.08]"
        }`}
      >
        같은 매장 전체
      </button>
      <span className="text-[10px] text-slate-600 ml-auto">조작은 자기 담당만</span>
    </div>
  )
}
