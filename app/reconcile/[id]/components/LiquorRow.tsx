/**
 * R-B + Phase A: 양주 한 줄.
 *   brand + sale price (판매가) + paid-to-store (입금가, 선택) + qty (선택).
 */

"use client"

import type { RoomLiquor } from "@/lib/reconcile/types"

export type LiquorRowProps = {
  liquor: RoomLiquor
  onChange: (next: RoomLiquor) => void
  onRemove: () => void
  readOnly?: boolean
}

function formatWon(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return ""
  return n.toLocaleString()
}

function parseWon(raw: string): number {
  const num = parseInt(raw.replace(/[^\d]/g, "") || "0", 10)
  return Number.isFinite(num) ? num : 0
}

export default function LiquorRow({ liquor, onChange, onRemove, readOnly }: LiquorRowProps) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#0A1222]/60 p-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={liquor.brand}
          onChange={(e) => onChange({ ...liquor, brand: e.target.value })}
          placeholder="양주 브랜드"
          disabled={readOnly}
          className="flex-1 min-w-0 rounded bg-[#030814] border border-white/10 px-2 py-1 text-[11px] disabled:opacity-50"
        />
        <input
          type="text"
          inputMode="numeric"
          value={liquor.qty ?? ""}
          onChange={(e) => {
            const v = parseWon(e.target.value)
            onChange({ ...liquor, qty: v > 0 ? v : undefined })
          }}
          placeholder="수량"
          disabled={readOnly}
          className="w-12 rounded bg-[#030814] border border-white/10 px-1.5 py-1 text-[11px] text-center tabular-nums disabled:opacity-50"
        />
        {!readOnly && (
          <button
            onClick={onRemove}
            className="text-[10px] text-red-400 hover:text-red-300 px-1.5"
            aria-label="삭제"
          >❌</button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <div>
          <label className="block text-[9px] text-slate-500 mb-0.5 px-0.5">판매가 (손님 청구)</label>
          <div className="flex items-center gap-1 rounded bg-[#030814] border border-white/10 px-2 py-1">
            <span className="text-[10px] text-slate-500">₩</span>
            <input
              type="text"
              inputMode="numeric"
              value={formatWon(liquor.amount_won)}
              onChange={(e) => onChange({ ...liquor, amount_won: parseWon(e.target.value) })}
              disabled={readOnly}
              className="flex-1 min-w-0 bg-transparent text-[11px] text-right tabular-nums outline-none disabled:opacity-50"
            />
          </div>
        </div>
        <div>
          <label className="block text-[9px] text-slate-500 mb-0.5 px-0.5">입금가 (가게 매출)</label>
          <div className="flex items-center gap-1 rounded bg-[#030814] border border-white/10 px-2 py-1">
            <span className="text-[10px] text-slate-500">₩</span>
            <input
              type="text"
              inputMode="numeric"
              value={formatWon(liquor.paid_to_store_won)}
              onChange={(e) => {
                const v = parseWon(e.target.value)
                onChange({ ...liquor, paid_to_store_won: v > 0 ? v : undefined })
              }}
              placeholder="(같으면 비움)"
              disabled={readOnly}
              className="flex-1 min-w-0 bg-transparent text-[11px] text-right tabular-nums outline-none disabled:opacity-50 placeholder:text-slate-700"
            />
          </div>
        </div>
      </div>
      {/* 마진 자동 계산 표시 (실장 수익) */}
      {liquor.paid_to_store_won != null && liquor.paid_to_store_won < liquor.amount_won && (
        <div className="text-[10px] text-amber-400/80 text-right tabular-nums">
          실장 마진: ₩{(liquor.amount_won - liquor.paid_to_store_won).toLocaleString()}
        </div>
      )}
    </div>
  )
}
