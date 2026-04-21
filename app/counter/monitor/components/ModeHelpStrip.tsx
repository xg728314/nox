"use client"

/**
 * ModeHelpStrip — 3-column explainer strip at the very bottom.
 *
 * Matches the target: 모드 안내 | 수동 입력 지원 | 운영 권한.
 * Purely informational — no interaction. Designed so operators can
 * glance at the policy without leaving the dashboard.
 */

import type { MonitorMode } from "../types"

type Props = {
  mode: MonitorMode
}

export default function ModeHelpStrip({ mode }: Props) {
  return (
    <div
      className="grid gap-4 px-4 py-3 border-t border-white/[0.06] bg-[#0a0c1a] text-[10.5px] leading-snug"
      style={{ gridTemplateColumns: "1fr 1fr 1fr" }}
    >
      {/* 모드 안내 */}
      <div className="flex items-start gap-3 min-w-0">
        <span className="text-[11px] text-slate-400 font-bold flex-shrink-0 w-[56px]">모드 안내</span>
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded border ${
              mode === "hybrid"
                ? "bg-cyan-500/25 text-cyan-200 border-cyan-400/40"
                : "text-slate-500 border-white/10"
            }`}>AUTO</span>
            <span className="text-slate-400">(BLE 모드)</span>
          </div>
          <div className="text-slate-500 truncate">태그 기반으로 자동 위치 추적 및 상태 업데이트</div>
          <div className="flex items-center gap-1.5 pt-0.5">
            <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded border ${
              mode === "manual"
                ? "bg-amber-500/20 text-amber-200 border-amber-500/45"
                : "text-slate-500 border-white/10"
            }`}>MANUAL</span>
            <span className="text-slate-400">(수동 모드)</span>
          </div>
          <div className="text-slate-500 truncate">수동으로 입력/수정 가능 (BLE 미사용 시)</div>
        </div>
      </div>

      {/* 수동 입력 지원 */}
      <div className="flex items-start gap-3 min-w-0">
        <span className="text-[11px] text-slate-400 font-bold flex-shrink-0 w-[72px]">수동 입력 지원</span>
        <div className="text-slate-500 space-y-1">
          <div>BLE 사용 전/도입 초기에는 수동으로 입력하며,</div>
          <div>BLE 적용 후에도 언제든 수동으로 수정 가능</div>
        </div>
      </div>

      {/* 운영 권한 */}
      <div className="flex items-start gap-3 min-w-0">
        <span className="text-[11px] text-slate-400 font-bold flex-shrink-0 w-[56px]">운영 권한</span>
        <div className="text-slate-500 space-y-1">
          <div>
            <span className="text-emerald-300 font-semibold">본점 사장/실장:</span>
            &nbsp;전체 가게 및 모든 소속/타가게 아가씨 위치 조회 가능
          </div>
          <div>
            <span className="text-fuchsia-300 font-semibold">타 가게 사장/실장:</span>
            &nbsp;본인 가게 진행중인 방 내 아가씨만 조회 가능
          </div>
        </div>
      </div>
    </div>
  )
}
