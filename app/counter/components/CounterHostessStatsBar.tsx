"use client"

/**
 * CounterHostessStatsBar — 카운터 헤더 아래 슬림 stats bar.
 *
 * 2026-05-03: CounterPageV2.tsx 분할.
 *   "총인원 / 출근 / 대기 / 접객" 4개 카운트만 보여주는 순수 표시 컴포넌트.
 *   useCounterBootstrap 의 hostessStats 가 null 이거나 managed_total 이 0이면
 *   부모에서 조건부 render 처리.
 */

import type { HostessStats } from "@/app/counter/hooks/useCounterBootstrap"

export default function CounterHostessStatsBar({ stats }: { stats: HostessStats }) {
  return (
    <div className="px-4 py-1.5 bg-[#0d1020]/80 border-b border-white/[0.05] flex items-center gap-3">
      <span className="text-[10px] text-slate-500">{stats.scope === "manager" ? "내 관리" : "매장"}</span>
      <div className="flex items-center gap-2.5 text-[11px]">
        <span className="text-slate-400">총인원 <span className="text-cyan-300 font-bold">{stats.managed_total}</span></span>
        <span className="text-slate-600">·</span>
        <span className="text-slate-400">출근 <span className="text-emerald-400 font-bold">{stats.on_duty_count}</span></span>
        <span className="text-slate-600">·</span>
        <span className="text-slate-400">대기 <span className="text-amber-300 font-bold">{stats.waiting_count}</span></span>
        <span className="text-slate-600">·</span>
        <span className="text-slate-400">접객 <span className="text-red-300 font-bold">{stats.in_room_count}</span></span>
      </div>
    </div>
  )
}
