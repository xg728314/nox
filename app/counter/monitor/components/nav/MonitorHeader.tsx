"use client"

import Link from "next/link"

/**
 * MonitorHeader — top row of /counter/monitor.
 *
 * Three zones (screenshot-matched):
 *   LEFT   : NOX tile · 카운터 title · 운영중 pill
 *   CENTER : five horizontal CountPill (재실 / 이탈 / 화장실 / 외부(타층) / 대기)
 *   RIGHT  : 모드 전환 AUTO|MANUAL · 💬 · 🔔 (absence count) · user avatar
 *
 * The count pills double as state filters for the lower panels. The mode
 * segmented is visual today — AUTO actually means "server returned
 * mode=hybrid" which only happens once BLE overlay is wired. Today it is
 * always MANUAL.
 */

import type { MonitorMode, MonitorSummary } from "../../types"
import type { WorkerState } from "../../statusStyles"
import CountPill from "../badges/CountPill"

type Props = {
  summary: MonitorSummary
  mode: MonitorMode
  absenceCount: number
  lastUpdatedAt: string | null
  loading: boolean
  stateFilter: WorkerState | null
  onFilterChange: (s: WorkerState | null) => void
  onRefresh: () => void
  /** When provided, CountPills corresponding to these states get a
   *  subtle amber halo + alert badge indicating participants in that
   *  bucket currently have active alerts under the user's prefs.
   *  `undefined` disables halo entirely (prefs.display.summary_highlight=false). */
  alertStateCounts?: { present: number; mid_out: number }
}

function fmtClock(iso: string | null): string {
  if (!iso) return "—"
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  } catch { return "—" }
}

export default function MonitorHeader({
  summary, mode, absenceCount, lastUpdatedAt, loading,
  stateFilter, onFilterChange, onRefresh, alertStateCounts,
}: Props) {
  const toggle = (s: WorkerState) => onFilterChange(stateFilter === s ? null : s)
  const alertPresent = alertStateCounts?.present ?? 0
  const alertMidOut  = alertStateCounts?.mid_out ?? 0

  return (
    <header className="flex items-center gap-4 px-4 py-2.5 border-b border-white/[0.06] bg-[#0b0e1c]">
      {/* LEFT */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="w-10 h-10 rounded-lg bg-cyan-500/25 border border-cyan-400/40 flex items-center justify-center text-cyan-200 text-sm font-extrabold tracking-wide">
          NOX
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-bold text-slate-100">카운터</span>
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/35 text-emerald-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            운영중
          </span>
        </div>
      </div>

      {/* CENTER — five count pills */}
      <div className="flex items-center gap-2 flex-1 justify-center flex-wrap">
        <CountPill state="present"        count={summary.present}        active={stateFilter === "present"}        onClick={() => toggle("present")}        alertCount={alertPresent} />
        <CountPill state="mid_out"        count={summary.mid_out}        active={stateFilter === "mid_out"}        onClick={() => toggle("mid_out")}        alertCount={alertMidOut} />
        <CountPill state="restroom"       count={summary.restroom}       active={stateFilter === "restroom"}       onClick={() => toggle("restroom")}       bleOnly mode={mode} />
        <CountPill state="external_floor" count={summary.external_floor} active={stateFilter === "external_floor"} onClick={() => toggle("external_floor")} bleOnly mode={mode} />
        <CountPill state="waiting"        count={summary.waiting}        active={stateFilter === "waiting"}        onClick={() => toggle("waiting")} />
      </div>

      {/* RIGHT */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-[10px] text-slate-500 hidden lg:inline">모드 전환</span>
        <div className="flex items-center rounded-lg border border-white/10 bg-white/[0.04] overflow-hidden">
          <span
            className={`px-3 py-1 text-[11px] font-semibold ${
              mode === "hybrid"
                ? "bg-cyan-500/30 text-cyan-100"
                : "text-slate-500"
            }`}
            title="BLE 태그 기반 자동 추적 (현재 비활성)"
          >AUTO</span>
          <span
            className={`px-3 py-1 text-[11px] font-semibold ${
              mode === "manual"
                ? "bg-amber-500/25 text-amber-100"
                : "text-slate-500"
            }`}
            title="현재 수동 운영 모드"
          >MANUAL</span>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="w-8 h-8 rounded-md border border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] flex items-center justify-center disabled:opacity-40"
          title={`갱신 ${fmtClock(lastUpdatedAt)}`}
        >⟳</button>
        <span
          className="relative w-8 h-8 rounded-md border border-white/10 bg-white/[0.03] text-slate-300 flex items-center justify-center"
          title="채팅 (플레이스홀더)"
          aria-hidden
        >💬</span>
        <span
          className="relative w-8 h-8 rounded-md border border-white/10 bg-white/[0.03] text-slate-300 flex items-center justify-center"
          title={`이탈 알림 ${absenceCount}건`}
        >
          🔔
          {absenceCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
              {absenceCount}
            </span>
          )}
        </span>
        <Link
          href="/counter"
          className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500/40 to-emerald-500/40 border border-white/20 text-[11px] font-bold text-white flex items-center justify-center hover:ring-2 hover:ring-cyan-400/50"
          title="← 카운터로"
        >E</Link>
      </div>
    </header>
  )
}
