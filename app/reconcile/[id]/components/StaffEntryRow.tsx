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
    <div className="rounded-lg border border-white/10 bg-[#0A1222]/60 p-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
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
      <div className="flex items-center gap-1.5">
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
      {entry.raw_text && (
        <div className="text-[10px] text-slate-500 italic truncate">원본: {entry.raw_text}</div>
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
