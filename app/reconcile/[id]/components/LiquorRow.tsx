/**
 * R-B: 양주 한 줄 — brand + amount_won 인라인 편집.
 */

"use client"

import type { RoomLiquor } from "@/lib/reconcile/types"

export type LiquorRowProps = {
  liquor: RoomLiquor
  onChange: (next: RoomLiquor) => void
  onRemove: () => void
  readOnly?: boolean
}

function formatWon(n: number): string {
  if (!Number.isFinite(n)) return ""
  return n.toLocaleString()
}

export default function LiquorRow({ liquor, onChange, onRemove, readOnly }: LiquorRowProps) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        value={liquor.brand}
        onChange={(e) => onChange({ ...liquor, brand: e.target.value })}
        placeholder="양주 브랜드"
        disabled={readOnly}
        className="flex-1 min-w-0 rounded bg-[#030814] border border-white/10 px-2 py-1 text-[11px] disabled:opacity-50"
      />
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-slate-500">₩</span>
        <input
          type="text"
          inputMode="numeric"
          value={formatWon(liquor.amount_won)}
          onChange={(e) => {
            const num = parseInt(e.target.value.replace(/[^\d]/g, "") || "0", 10)
            onChange({ ...liquor, amount_won: num })
          }}
          disabled={readOnly}
          className="w-24 rounded bg-[#030814] border border-white/10 px-2 py-1 text-[11px] text-right tabular-nums disabled:opacity-50"
        />
      </div>
      {!readOnly && (
        <button
          onClick={onRemove}
          className="text-[10px] text-red-400 hover:text-red-300 px-1.5"
          aria-label="삭제"
        >❌</button>
      )}
    </div>
  )
}
