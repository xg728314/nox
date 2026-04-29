"use client"

/**
 * TimeScopeToggle — segmented control for `time_range`.
 *
 * Phase 2.1e: 4 quick buttons (today / yesterday / last_7_days / this_month).
 * Phase 2.1j: 'custom' button + inline date inputs (≤ 30 day window,
 * audit-retention safe). Server enforces max range; client just gates
 * obvious mistakes (from > to, > 30 days).
 */

import type { NetworkTimeRange } from "@/lib/visualize/shapes"

type Option = { value: NetworkTimeRange; label: string }

const OPTIONS: ReadonlyArray<Option> = [
  { value: "today", label: "오늘" },
  { value: "yesterday", label: "어제" },
  { value: "last_7_days", label: "7일" },
  { value: "this_month", label: "이번달" },
  { value: "custom", label: "직접지정" },
]

const CUSTOM_RANGE_MAX_DAYS = 30
const AUDIT_HOT_DAYS = 90

type Props = {
  value: NetworkTimeRange
  onChange: (next: NetworkTimeRange) => void
  /** Required for `value='custom'`. yyyy-mm-dd KST. */
  customFrom?: string
  customTo?: string
  onCustomChange?: (next: { from: string; to: string }) => void
  disabled?: boolean
}

function todayKstYmd(): string {
  // KST = UTC+9. Build from UTC parts then offset.
  const d = new Date()
  const utcMs = d.getTime() + 9 * 60 * 60 * 1000
  const k = new Date(utcMs)
  const y = k.getUTCFullYear()
  const m = String(k.getUTCMonth() + 1).padStart(2, "0")
  const day = String(k.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function addDaysYmd(ymd: string, delta: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd
  const [y, m, d] = ymd.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + delta)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(dt.getUTCDate()).padStart(2, "0")
  return `${yy}-${mm}-${dd}`
}

function daysBetween(a: string, b: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return 0
  const [ya, ma, da] = a.split("-").map(Number)
  const [yb, mb, db] = b.split("-").map(Number)
  const ms = Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)
  return Math.round(ms / 86_400_000)
}

export default function TimeScopeToggle({
  value,
  onChange,
  customFrom,
  customTo,
  onCustomChange,
  disabled,
}: Props) {
  const today = todayKstYmd()
  const minDate = addDaysYmd(today, -AUDIT_HOT_DAYS)

  // Range validation hint (server is source of truth; this is UX only).
  let rangeHint: string | null = null
  if (value === "custom" && customFrom && customTo) {
    if (customFrom > customTo) rangeHint = "시작 ≤ 종료 가 필요합니다"
    else {
      const days = daysBetween(customFrom, customTo) + 1
      if (days > CUSTOM_RANGE_MAX_DAYS) rangeHint = `최대 ${CUSTOM_RANGE_MAX_DAYS}일 (현재 ${days}일)`
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="tablist"
        aria-label="시간 범위"
        className="inline-flex rounded border border-slate-700 bg-slate-900 overflow-hidden"
      >
        {OPTIONS.map((opt) => {
          const active = opt.value === value
          return (
            <button
              key={opt.value}
              role="tab"
              aria-selected={active}
              disabled={disabled}
              onClick={() => {
                if (opt.value === "custom" && onCustomChange) {
                  // First entry into custom: seed with today/today.
                  if (!customFrom || !customTo) {
                    onCustomChange({ from: today, to: today })
                  }
                }
                onChange(opt.value)
              }}
              className={[
                "text-xs px-2.5 py-1 transition-colors",
                active
                  ? "bg-cyan-500/20 text-cyan-200"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200",
                disabled ? "opacity-50 cursor-not-allowed" : "",
              ].join(" ")}
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      {value === "custom" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="date"
            value={customFrom ?? today}
            min={minDate}
            max={today}
            onChange={(e) => onCustomChange?.({ from: e.target.value, to: customTo ?? today })}
            disabled={disabled}
            className="text-[11px] bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-slate-100"
          />
          <span className="text-slate-500 text-[11px]">→</span>
          <input
            type="date"
            value={customTo ?? today}
            min={minDate}
            max={today}
            onChange={(e) => onCustomChange?.({ from: customFrom ?? today, to: e.target.value })}
            disabled={disabled}
            className="text-[11px] bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-slate-100"
          />
          {rangeHint && (
            <span className="text-[10px] text-amber-300 ml-1">{rangeHint}</span>
          )}
        </div>
      )}
    </div>
  )
}
