"use client"

/**
 * MySettlementSummary — placeholder monthly settlement summary card.
 *
 * STEP-010: stub only. Real numbers will come from a future
 * /api/me/settlements/monthly endpoint; for now we render a static
 * structure so the 월 정산 tab has a UI to mount.
 */

type Props = {
  monthLabel?: string
  grossTotal?: number
  payoutTotal?: number
  sessionCount?: number
}

function formatWon(n: number | undefined): string {
  if (n === undefined) return "—"
  return `${n.toLocaleString("ko-KR")}원`
}

export default function MySettlementSummary({
  monthLabel, grossTotal, payoutTotal, sessionCount,
}: Props) {
  const label = monthLabel ?? new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long" })
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-white">월 정산</div>
        <span className="text-[10px] text-slate-500">{label}</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatBox label="총 매출" value={formatWon(grossTotal)} />
        <StatBox label="지급액" value={formatWon(payoutTotal)} accent />
        <StatBox label="세션" value={sessionCount !== undefined ? `${sessionCount}건` : "—"} />
      </div>

      <div className="mt-3 text-[10px] text-slate-500 italic">
        * 월 정산 집계는 준비 중입니다. (placeholder)
      </div>
    </div>
  )
}

function StatBox({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className={`text-sm font-semibold mt-1 ${accent ? "text-purple-300" : "text-white"}`}>
        {value}
      </div>
    </div>
  )
}
