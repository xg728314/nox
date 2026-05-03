/**
 * R-B: 한 방의 스태프 한 줄 — 인라인 편집 가능.
 *   필드: time / hostess_name / origin_store / service_type / time_tier
 *   confidence 신호등 좌측 표시.
 */

"use client"

import type { RoomStaffEntry, ServiceType, TimeTier } from "@/lib/reconcile/types"
import ConfidenceBadge from "./ConfidenceBadge"

export type StaffEntryRowProps = {
  entry: RoomStaffEntry
  onChange: (next: RoomStaffEntry) => void
  onRemove: () => void
  readOnly?: boolean
  /** R-A v5: 매장 호스티스 후보 — input datalist 자동완성. */
  knownHostesses?: string[]
  /** R-A v5: 매장 후보 — origin_store input 자동완성. */
  knownStores?: string[]
  /** datalist id 가 페이지 안에서 unique 해야 함. parent 가 row index 기반으로 prefix 줘야. */
  datalistIdPrefix?: string
}

const SERVICE_OPTIONS: ServiceType[] = ["퍼블릭", "셔츠", "하퍼"]
const TIER_OPTIONS: TimeTier[] = ["free", "차3", "반티", "반차3", "완티", "unknown"]

export default function StaffEntryRow({
  entry, onChange, onRemove, readOnly,
  knownHostesses, knownStores, datalistIdPrefix = "se",
}: StaffEntryRowProps) {
  function patch<K extends keyof RoomStaffEntry>(key: K, value: RoomStaffEntry[K]) {
    onChange({ ...entry, [key]: value })
  }

  const hostessListId = `${datalistIdPrefix}-hostess`
  const storeListId = `${datalistIdPrefix}-store`

  return (
    // 2026-05-01 R-AutoPrice UI: 카드 시각 구분 강화. 좌측 emerald 인디케이터 +
    //   진한 배경/테두리/큰 padding/넉넉한 여백으로 N개 entry 한 카드인지 명확.
    //   기존: bg/60 border/10 p-2 → 새: bg/80 border/15 + 좌측 4px 막대 + p-3 + space-y-2.
    <div className="relative rounded-xl border border-emerald-500/20 bg-[#0F1A2D] p-3 space-y-2 shadow-[0_2px_8px_rgba(0,0,0,0.25)] hover:border-emerald-500/40 transition-colors">
      <span
        aria-hidden="true"
        className="absolute left-0 top-2 bottom-2 w-1 rounded-r-md bg-emerald-500/60"
      />
      <div className="flex items-center gap-1.5 pl-2">
        <ConfidenceBadge value={entry.confidence} />
        <input
          type="text"
          value={entry.time ?? ""}
          onChange={(e) => patch("time", e.target.value)}
          placeholder="시간 HH:MM"
          disabled={readOnly}
          className="w-20 rounded bg-[#030814] border border-white/10 px-2 py-1 text-[11px] disabled:opacity-50"
        />
        <input
          type="text"
          value={entry.hostess_name ?? ""}
          onChange={(e) => patch("hostess_name", e.target.value)}
          placeholder="이름"
          disabled={readOnly}
          list={knownHostesses && knownHostesses.length > 0 ? hostessListId : undefined}
          className="flex-1 min-w-0 rounded bg-[#030814] border border-white/10 px-2 py-1 text-[11px] disabled:opacity-50"
        />
        {!readOnly && (
          <button
            onClick={onRemove}
            className="text-[10px] text-red-400 hover:text-red-300 px-1.5 py-0.5"
            aria-label="삭제"
          >❌</button>
        )}
      </div>
      <div className="flex items-center gap-1.5 pl-2">
        <input
          type="text"
          value={entry.origin_store ?? ""}
          onChange={(e) => patch("origin_store", e.target.value)}
          placeholder="소속 매장"
          disabled={readOnly}
          list={knownStores && knownStores.length > 0 ? storeListId : undefined}
          className="flex-1 min-w-0 rounded bg-[#030814] border border-white/10 px-2 py-1 text-[11px] disabled:opacity-50"
        />
        <select
          value={entry.service_type ?? ""}
          onChange={(e) => patch("service_type", (e.target.value || undefined) as ServiceType | undefined)}
          disabled={readOnly}
          className="rounded bg-[#030814] border border-white/10 px-2 py-1 text-[11px] disabled:opacity-50"
        >
          <option value="">종목</option>
          {SERVICE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={entry.time_tier ?? ""}
          onChange={(e) => patch("time_tier", (e.target.value || undefined) as TimeTier | undefined)}
          disabled={readOnly}
          className="rounded bg-[#030814] border border-white/10 px-2 py-1 text-[11px] disabled:opacity-50"
        >
          <option value="">등급</option>
          {TIER_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      {/* Phase A2: 개인 정산금 (받을 금액 / 실장 수익) — 카운터 schema 와 동일 */}
      <div className="grid grid-cols-2 gap-1.5 pl-2">
        <div>
          <label className="block text-[9px] text-slate-500 mb-0.5 px-0.5">받을 금액 (개인)</label>
          <div className="flex items-center gap-1 rounded bg-[#030814] border border-white/10 px-2 py-1">
            <span className="text-[10px] text-slate-500">₩</span>
            <input
              type="text"
              inputMode="numeric"
              value={entry.hostess_payout_won != null ? entry.hostess_payout_won.toLocaleString() : ""}
              onChange={(e) => {
                const v = parseInt(e.target.value.replace(/[^\d]/g, "") || "0", 10)
                patch("hostess_payout_won", v > 0 ? v : undefined)
              }}
              disabled={readOnly}
              className="flex-1 min-w-0 bg-transparent text-[11px] text-right tabular-nums outline-none disabled:opacity-50"
            />
          </div>
        </div>
        <div>
          <label className="block text-[9px] text-slate-500 mb-0.5 px-0.5">실장 수익</label>
          <div className="flex items-center gap-1 rounded bg-[#030814] border border-white/10 px-2 py-1">
            <span className="text-[10px] text-slate-500">₩</span>
            <input
              type="text"
              inputMode="numeric"
              value={entry.manager_payout_won != null ? entry.manager_payout_won.toLocaleString() : ""}
              onChange={(e) => {
                const v = parseInt(e.target.value.replace(/[^\d]/g, "") || "0", 10)
                patch("manager_payout_won", v > 0 ? v : undefined)
              }}
              disabled={readOnly}
              placeholder="0/5천/1만"
              className="flex-1 min-w-0 bg-transparent text-[11px] text-right tabular-nums outline-none disabled:opacity-50 placeholder:text-slate-700"
            />
          </div>
        </div>
      </div>
      {entry.raw_text && (
        <div className="text-[10px] text-slate-500 italic truncate pl-2">원본: {entry.raw_text}</div>
      )}
      {/* R-A v5: 자동완성 datalist (브라우저 native, mobile 친화). */}
      {knownHostesses && knownHostesses.length > 0 && (
        <datalist id={hostessListId}>
          {knownHostesses.map((n) => <option key={n} value={n} />)}
        </datalist>
      )}
      {knownStores && knownStores.length > 0 && (
        <datalist id={storeListId}>
          {knownStores.map((n) => <option key={n} value={n} />)}
        </datalist>
      )}
    </div>
  )
}
