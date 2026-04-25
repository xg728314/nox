"use client"

import { STATUS_STYLES, type WorkerState } from "../../statusStyles"

/**
 * CountPill — compact horizontal count chip used in MonitorHeader.
 * Label on the left, large number on the right, optional colored dot
 * for state. Designed for glance reading at the top of the dashboard.
 */

type Props = {
  state: WorkerState
  count: number
  active?: boolean
  onClick?: () => void
  bleOnly?: boolean
  mode?: "manual" | "hybrid"
  /** When > 0, the pill gets a subtle amber ring halo and shows a
   *  small alert dot. Intended for "users with alerts in this state
   *  bucket" — driven by user alert prefs upstream. */
  alertCount?: number
}

export default function CountPill({
  state, count, active = false, onClick, bleOnly = false, mode = "manual",
  alertCount = 0,
}: Props) {
  const s = STATUS_STYLES[state]
  const hasAlert = alertCount > 0
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`group inline-flex items-center gap-2 h-9 rounded-lg border px-3 transition-all ${
        active
          ? `${s.border} bg-white/[0.06] ring-1 ring-white/10`
          : hasAlert
            ? "border-amber-500/40 bg-amber-500/[0.05] ring-1 ring-amber-500/30"
            : "border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.05]"
      } ${onClick ? "cursor-pointer" : "cursor-default"}`}
      title={
        hasAlert ? `알림 ${alertCount}건` :
        onClick ? "클릭해서 필터 토글" : s.label
      }
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${s.dot}`} />
      <span className="text-[11px] text-slate-400">{s.label}</span>
      <span className={`text-[15px] font-bold tabular-nums ${s.count}`}>{count}</span>
      {hasAlert && (
        <span
          className="ml-0.5 inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full bg-amber-500 text-black text-[9px] font-bold"
          aria-label={`알림 ${alertCount}건`}
        >!</span>
      )}
      {bleOnly && (
        <span
          className={`ml-0.5 text-[8.5px] uppercase tracking-wide px-1 py-0.5 rounded ${
            mode === "hybrid"
              ? "bg-cyan-500/25 text-cyan-200 border border-cyan-400/40"
              : "bg-white/[0.05] text-slate-500 border border-white/10"
          }`}
        >
          {mode === "hybrid" ? "LIVE" : "BLE"}
        </span>
      )}
    </button>
  )
}
