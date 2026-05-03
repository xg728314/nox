"use client"

/**
 * Kpi — 매장 모니터 KPI 카드 (작은 박스 1개).
 *
 * 2026-05-03: page.tsx 분할.
 */

export default function Kpi({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: "cyan" | "emerald" | "amber"
}) {
  const color =
    accent === "emerald" ? "text-emerald-300" :
    accent === "cyan" ? "text-cyan-300" :
    accent === "amber" ? "text-amber-300" :
    "text-white"
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className={`mt-1 text-base font-bold ${color}`}>{value}</div>
    </div>
  )
}
