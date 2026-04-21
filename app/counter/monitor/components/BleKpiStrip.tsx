"use client"

/**
 * BleKpiStrip — thin operator-facing KPI row.
 *
 * Three store-scoped stats + one per-user contribution counter:
 *   · 정확도 N%        (positive / (positive + negative + corrections))
 *   · 오늘 수정 N건    (total corrections today)
 *   · 주 문제 <zone>   (most-frequent original_zone across corrections + neg feedback)
 *   · 오늘 내 기여 N건 (me: corrections + positives + negatives)
 *
 * Renders only when KPI is loaded so the header doesn't flash empty
 * values on first paint.
 */

import { useBleKpi } from "../hooks/useBleKpi"
import { BLE_ZONE_LABEL } from "./BleHint"
import type { MonitorBleZone } from "../types"

function zoneLabel(zone: string | null): string {
  if (!zone) return "—"
  const l = BLE_ZONE_LABEL[zone as MonitorBleZone]
  return l ?? zone
}

/** Exported so page.tsx can trigger a refresh after a correction /
 *  feedback tap without re-instantiating the hook elsewhere. */
export function useKpiForStrip() {
  return useBleKpi()
}

export default function BleKpiStrip({ refreshSignal }: { refreshSignal?: number } = {}) {
  // NOTE: page.tsx may pass a changing `refreshSignal` to re-sync the
  // KPI instantly after a feedback/correction write. When signal
  // changes, the hook below is also refreshed by the parent via its
  // own refresh() call — this prop is a hint for future orchestration.
  // The hook itself polls every 30s independently.
  void refreshSignal
  const { kpi, loading, error } = useBleKpi()

  if (loading && !kpi) return null
  if (error && !kpi) return null
  if (!kpi) return null

  const pct = Math.round(Math.max(0, Math.min(1, kpi.store.accuracy_rate)) * 100)
  const acc = (
    pct >= 90 ? "text-emerald-300" :
    pct >= 70 ? "text-amber-300" :
                "text-red-300"
  )

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-1.5 border-b border-white/[0.04] bg-[#09091A] text-[11px] flex-wrap">
      <div className="flex items-center gap-5 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">정확도</span>
          <span className={`font-bold tabular-nums ${acc}`}>{pct}%</span>
          <span className="text-slate-600 text-[10px]">
            (+{kpi.store.positive_today} / −{kpi.store.negative_today + kpi.store.corrections_today})
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">오늘 수정</span>
          <span className="font-bold tabular-nums text-amber-300">{kpi.store.corrections_today}건</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">주 문제</span>
          <span className="font-semibold text-red-300">
            {zoneLabel(kpi.store.top_problem_zone)}
          </span>
          {kpi.store.top_problem_count > 0 && (
            <span className="text-slate-600 text-[10px]">× {kpi.store.top_problem_count}</span>
          )}
        </div>
      </div>
      <div
        className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/40 bg-cyan-500/15 px-2 py-0.5 text-[10px] text-cyan-100"
        title="오늘 내가 기록한 정확도 피드백 + 위치 수정 총합"
      >
        <span>🏅</span>
        <span className="text-slate-300">오늘 내 기여</span>
        <span className="font-bold tabular-nums">{kpi.me.contribution_score}건</span>
      </div>
    </div>
  )
}
