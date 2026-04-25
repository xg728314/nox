"use client"

import type { FocusData } from "../../types"

/**
 * InterimModeModal — extracted from the inline interim-mode modal in
 * CounterPageV2. Same labels, same layout, same computed preview values.
 * The component receives the live FocusData and re-derives the preview
 * numbers locally (identical formulas to the original inline block).
 */

type Props = {
  open: boolean
  focusData: FocusData | null
  busy: boolean
  onClose: () => void
  onSelectElapsed: () => void
  onSelectHalf: () => void
}

export default function InterimModeModal({
  open, focusData, busy, onClose, onSelectElapsed, onSelectHalf,
}: Props) {
  if (!open || !focusData) return null

  const participants = focusData.participants.filter(p => p.category && p.time_minutes > 0)
  const elapsedTotal = participants.reduce((s, p) => s + (p.price_amount || 0), 0)
  // Rough half_ticket estimate: 반티 = half of the known public/shirts/harper defaults.
  // Real numbers come from server on submit; this preview is best-effort local math.
  const halfEstimate = participants.reduce((s, p) => {
    const full = p.price_amount || 0
    // 퍼블릭 13만 → 7만 / 셔츠 14만 → 7만 / 하퍼 12만 → 6만 — use explicit per-category table.
    const halfByCat: Record<string, number> = { "퍼블릭": 70000, "셔츠": 70000, "하퍼": 60000 }
    const h: number | undefined = p.category ? halfByCat[p.category] : undefined
    return s + (h ?? Math.floor(full / 2))
  }, 0)
  const maxMin = participants.reduce((m, p) => Math.max(m, p.time_minutes || 0), 0)
  const fmt = (n: number) => n.toLocaleString() + "원"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#0d1020] border border-white/10 rounded-2xl p-5 w-[360px] max-w-[92vw] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-sm font-semibold text-white mb-1">중간계산 기준 선택</div>
        <div className="text-[11px] text-slate-500 mb-4">계산 기준에 따라 스태프 타임 금액이 달라집니다.</div>
        <button
          type="button"
          disabled={busy}
          onClick={onSelectElapsed}
          className="w-full text-left p-3 mb-2 rounded-xl bg-white/5 hover:bg-cyan-500/15 border border-white/10 hover:border-cyan-500/30 transition-colors disabled:opacity-50"
        >
          <div className="text-sm font-semibold text-cyan-200">현재까지 논 시간 기준</div>
          <div className="text-[11px] text-slate-400 mt-0.5">{maxMin}분 경과 · 예상 {fmt(elapsedTotal)}</div>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onSelectHalf}
          className="w-full text-left p-3 mb-3 rounded-xl bg-white/5 hover:bg-cyan-500/15 border border-white/10 hover:border-cyan-500/30 transition-colors disabled:opacity-50"
        >
          <div className="text-sm font-semibold text-cyan-200">반티 기준</div>
          <div className="text-[11px] text-slate-400 mt-0.5">반티 금액 일괄 적용 · 예상 {fmt(halfEstimate)}</div>
        </button>
        <button
          type="button"
          onClick={onClose}
          className="w-full py-2 rounded-xl text-xs text-slate-400 hover:text-white border border-white/10 hover:border-white/20"
        >취소</button>
      </div>
    </div>
  )
}
