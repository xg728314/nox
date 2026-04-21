"use client"

/**
 * MonitorToolbar — workspace-level toggles for /counter/monitor.
 *
 * Desktop + tablet: renders under the header as a single horizontal
 * strip. Controls:
 *   - 미니맵 접기/펼치기
 *   - 밀도 토글 (컴팩트 / 기본)
 *   - 패널 표시 토글 dropdown (소속 / 타점 / 층별 요약 / 알림 / 피드 / 우측)
 *   - 기본값 복구
 *
 * Mobile: not rendered (the mobile shell uses a bottom tab bar instead).
 *
 * Every button writes through `useMonitorPreferences` which uses the
 * same shared store as the rest of the customization system.
 */

import { useState } from "react"
import type {
  MonitorLayoutPrefs, MonitorPanelId,
} from "@/lib/counter/monitorLayoutTypes"
import type { MonitorViewOptions } from "@/lib/counter/monitorViewOptionsTypes"
import { VIEW_OPTION_LABELS } from "@/lib/counter/monitorViewOptionsTypes"

type Props = {
  prefs: MonitorLayoutPrefs
  forcedActive: boolean
  onToggleMap: () => void
  onToggleDensity: () => void
  onTogglePanel: (id: MonitorPanelId) => void
  onReset: () => void
  /** Hide the density control on tablet for space economy. */
  compact?: boolean
  // ── BLE validation view options (additive) ────────────────────────
  viewOptions?: MonitorViewOptions
  onToggleViewOption?: (key: keyof Omit<MonitorViewOptions, "version">) => void
  onResetViewOptions?: () => void
}

const PANEL_LABELS: Record<MonitorPanelId, string> = {
  home_workers: "소속",
  foreign_workers: "타점",
  floor_summary: "층별 요약",
  absence: "이탈 알림",
  movement_feed: "이동 피드",
  right_column: "우측 전체",
}

const PANEL_ORDER: MonitorPanelId[] = [
  "home_workers",
  "foreign_workers",
  "floor_summary",
  "absence",
  "movement_feed",
  "right_column",
]

export default function MonitorToolbar({
  prefs, forcedActive, onToggleMap, onToggleDensity, onTogglePanel, onReset, compact = false,
  viewOptions, onToggleViewOption, onResetViewOptions,
}: Props) {
  const [panelsOpen, setPanelsOpen] = useState(false)
  const [viewOpen, setViewOpen] = useState(false)
  const viewOptKeys: Array<keyof Omit<MonitorViewOptions, "version">> = [
    "show_ble_validation_info",
    "show_correction_indicators",
    "show_feedback_buttons",
    "show_recommendation_hints",
    "show_kpi_strip",
  ]
  const activeViewCount = viewOptions
    ? viewOptKeys.filter(k => !!viewOptions[k]).length
    : 0

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-white/[0.06] bg-[#0a0c1a] text-[11px]">
      <div className="flex items-center gap-2 flex-wrap">
        {forcedActive && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-200"
            title="관리자 강제 override 적용 중 — 개인 저장이 현재 무시됩니다."
          >
            관리자 강제
          </span>
        )}
        <button
          type="button"
          onClick={onToggleMap}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md border font-semibold transition-all ${
            prefs.mapCollapsed
              ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
              : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.06]"
          }`}
          title={prefs.mapCollapsed ? "미니맵 펼치기" : "미니맵 접기"}
        >
          <span aria-hidden>{prefs.mapCollapsed ? "▸" : "▾"}</span>
          {prefs.mapCollapsed ? "미니맵 펼치기" : "미니맵 접기"}
        </button>

        {!compact && (
          <button
            type="button"
            onClick={onToggleDensity}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.06]"
            title="표시 밀도 전환"
          >
            밀도 · <span className="text-slate-100 font-semibold">{prefs.density === "compact" ? "컴팩트" : "기본"}</span>
          </button>
        )}

        <div className="relative">
          <button
            type="button"
            onClick={() => setPanelsOpen(v => !v)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.06]"
          >
            패널 <span aria-hidden>▾</span>
          </button>
          {panelsOpen && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setPanelsOpen(false)}
                aria-hidden
              />
              <div className="absolute top-full left-0 mt-1 z-40 rounded-lg border border-white/10 bg-[#0b0e1c] shadow-2xl p-2 min-w-[180px] space-y-0.5">
                {PANEL_ORDER.map(id => {
                  const visible = prefs.panels[id]
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onTogglePanel(id)}
                      className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-[11px] hover:bg-white/[0.05]"
                    >
                      <span className={visible ? "text-slate-100" : "text-slate-500"}>{PANEL_LABELS[id]}</span>
                      <span
                        className={`inline-flex items-center justify-center w-8 h-4 rounded-full border text-[8px] font-bold ${
                          visible
                            ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-200"
                            : "bg-white/[0.04] border-white/10 text-slate-500"
                        }`}
                      >{visible ? "ON" : "OFF"}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* ── BLE 검증 뷰 옵션 ─────────────────────────────────────
            Per-user visibility toggles for BLE-validation surfaces.
            Defaults keep the monitor simple; operators participating in
            BLE validation can enable advanced tools here. */}
        {viewOptions && onToggleViewOption && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setViewOpen(v => !v)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md border font-semibold transition-all ${
                activeViewCount > 0
                  ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
                  : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.06]"
              }`}
              title="BLE 검증 도구 표시 여부"
            >
              검증 뷰
              {activeViewCount > 0 && (
                <span className="ml-0.5 inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full bg-cyan-500/50 text-white text-[9px] font-bold">
                  {activeViewCount}
                </span>
              )}
              <span aria-hidden>▾</span>
            </button>
            {viewOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setViewOpen(false)} aria-hidden />
                <div className="absolute top-full left-0 mt-1 z-40 rounded-lg border border-white/10 bg-[#0b0e1c] shadow-2xl p-2 min-w-[220px] space-y-0.5">
                  <div className="px-2 py-1 text-[10px] text-slate-500">
                    BLE 검증 도구 — 기본값은 모두 꺼짐입니다.
                  </div>
                  {viewOptKeys.map(k => {
                    const on = !!viewOptions[k]
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => onToggleViewOption(k)}
                        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-[11px] hover:bg-white/[0.05]"
                      >
                        <span className={on ? "text-slate-100" : "text-slate-500"}>
                          {VIEW_OPTION_LABELS[k]}
                        </span>
                        <span
                          className={`inline-flex items-center justify-center w-8 h-4 rounded-full border text-[8px] font-bold ${
                            on
                              ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-200"
                              : "bg-white/[0.04] border-white/10 text-slate-500"
                          }`}
                        >{on ? "ON" : "OFF"}</span>
                      </button>
                    )
                  })}
                  {onResetViewOptions && (
                    <button
                      type="button"
                      onClick={() => { onResetViewOptions(); setViewOpen(false) }}
                      className="w-full text-left mt-1 pt-1 border-t border-white/[0.06] px-2 py-1 text-[10px] text-slate-500 hover:text-slate-200"
                    >전체 끄기 / 기본값으로</button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onReset}
          className="text-[10px] text-slate-500 hover:text-slate-200 underline-offset-2 hover:underline"
          title="기본 레이아웃으로 되돌림"
        >기본값으로</button>
      </div>
    </div>
  )
}
