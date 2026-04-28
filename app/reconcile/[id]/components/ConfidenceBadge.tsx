/**
 * R-B: confidence 0~1 → 신호등 배지.
 *   ≥ 0.85 → 🟢 / 0.6~0.85 → 🟡 / <0.6 → 🔴 / undefined → ⚪ (모름)
 */

"use client"

import { confidenceLevel } from "@/lib/reconcile/qualityHints"

export type ConfidenceBadgeProps = {
  value?: number | null
  /** 짧은 형 (작은 row 옆) vs 긴 형 (카드 헤더). default short. */
  variant?: "short" | "long"
}

export default function ConfidenceBadge({ value, variant = "short" }: ConfidenceBadgeProps) {
  const lvl = confidenceLevel(value)
  const cls =
    lvl === "green" ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300" :
    lvl === "amber" ? "bg-amber-500/15 border-amber-500/40 text-amber-300" :
    lvl === "red"   ? "bg-red-500/15 border-red-500/40 text-red-300" :
                      "bg-white/[0.05] border-white/10 text-slate-400"
  const icon =
    lvl === "green" ? "🟢" :
    lvl === "amber" ? "🟡" :
    lvl === "red"   ? "🔴" :
                      "⚪"
  const pct = value != null && Number.isFinite(value) ? Math.round(value * 100) : null

  if (variant === "short") {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${cls}`}
        title={pct != null ? `신뢰도 ${pct}%` : "신뢰도 정보 없음"}
      >
        <span>{icon}</span>
        {pct != null && <span className="font-mono">{pct}</span>}
      </span>
    )
  }

  // long
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md border ${cls}`}
    >
      <span>{icon}</span>
      <span>신뢰도</span>
      {pct != null ? <span className="font-mono font-semibold">{pct}%</span> : <span>—</span>}
    </span>
  )
}
