/**
 * R-B: 한 방의 모든 정보 카드 — 인라인 편집 가능.
 *   - 헤더: 방번호 + ConfidenceBadge (long)
 *   - 상단 입력: customer_name / manager_name / headcount / waiter_tip_won / misu_won / rt_count
 *   - 스태프 리스트 (추가/제거 가능)
 *   - 양주 리스트 (추가/제거 가능)
 *   - notes (raw_text 보조)
 *
 * 카드 색깔 (좌측 border) 은 confidence 신호등 따라 자동.
 */

"use client"

import type { PaperRoomCell, RoomLiquor, RoomStaffEntry } from "@/lib/reconcile/types"
import { confidenceLevel } from "@/lib/reconcile/qualityHints"
import ConfidenceBadge from "./ConfidenceBadge"
import StaffEntryRow from "./StaffEntryRow"
import LiquorRow from "./LiquorRow"

export type RoomCardProps = {
  room: PaperRoomCell
  onChange: (next: PaperRoomCell) => void
  onRemoveRoom: () => void
  readOnly?: boolean
}

export default function RoomCard({ room, onChange, onRemoveRoom, readOnly }: RoomCardProps) {
  const lvl = confidenceLevel(room.confidence)
  const borderCls =
    lvl === "green" ? "border-l-emerald-500/60" :
    lvl === "amber" ? "border-l-amber-500/60" :
    lvl === "red"   ? "border-l-red-500/60" :
                      "border-l-white/20"

  function patch<K extends keyof PaperRoomCell>(key: K, value: PaperRoomCell[K]) {
    onChange({ ...room, [key]: value })
  }

  // 숫자 patch (빈 입력 → 0)
  function patchNum<K extends keyof PaperRoomCell>(key: K, raw: string) {
    const n = parseInt(raw.replace(/[^\d]/g, "") || "0", 10)
    patch(key, n as unknown as PaperRoomCell[K])
  }

  function updateStaff(idx: number, next: RoomStaffEntry) {
    const arr = [...(room.staff_entries ?? [])]
    arr[idx] = next
    patch("staff_entries", arr)
  }
  function removeStaff(idx: number) {
    const arr = [...(room.staff_entries ?? [])]
    arr.splice(idx, 1)
    patch("staff_entries", arr)
  }
  function addStaff() {
    const arr = [...(room.staff_entries ?? []), {} as RoomStaffEntry]
    patch("staff_entries", arr)
  }

  function updateLiquor(idx: number, next: RoomLiquor) {
    const arr = [...(room.liquor ?? [])]
    arr[idx] = next
    patch("liquor", arr)
  }
  function removeLiquor(idx: number) {
    const arr = [...(room.liquor ?? [])]
    arr.splice(idx, 1)
    patch("liquor", arr)
  }
  function addLiquor() {
    const arr = [...(room.liquor ?? []), { brand: "", amount_won: 0 }]
    patch("liquor", arr)
  }

  return (
    <div className={`rounded-xl border-l-4 border border-white/10 bg-white/[0.03] p-3 space-y-3 ${borderCls}`}>
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold">📷 {room.room_no}</span>
          {room.session_seq > 1 && <span className="text-[10px] text-slate-500">#{room.session_seq}</span>}
          <ConfidenceBadge value={room.confidence} variant="long" />
        </div>
        {!readOnly && (
          <button
            onClick={onRemoveRoom}
            className="text-[11px] text-red-400 hover:text-red-300 px-2 py-1 rounded bg-red-500/10 border border-red-500/20"
          >방 삭제</button>
        )}
      </div>

      {/* 메타 입력 (1행) */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] text-slate-400 mb-0.5">손님</label>
          <input
            type="text"
            value={room.customer_name ?? ""}
            onChange={(e) => patch("customer_name", e.target.value || undefined)}
            placeholder="이름"
            disabled={readOnly}
            className="w-full rounded bg-[#030814] border border-white/10 px-2 py-1 text-[11px] disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block text-[10px] text-slate-400 mb-0.5">실장</label>
          <input
            type="text"
            value={room.manager_name ?? ""}
            onChange={(e) => patch("manager_name", e.target.value || undefined)}
            placeholder="이름"
            disabled={readOnly}
            className="w-full rounded bg-[#030814] border border-white/10 px-2 py-1 text-[11px] disabled:opacity-50"
          />
        </div>
      </div>

      {/* 메타 입력 (2행) */}
      <div className="grid grid-cols-4 gap-2">
        <div>
          <label className="block text-[10px] text-slate-400 mb-0.5">인원</label>
          <input
            type="text"
            inputMode="numeric"
            value={room.headcount ?? ""}
            onChange={(e) => patchNum("headcount", e.target.value)}
            disabled={readOnly}
            className="w-full rounded bg-[#030814] border border-white/10 px-2 py-1 text-[11px] disabled:opacity-50 text-right tabular-nums"
          />
        </div>
        <div>
          <label className="block text-[10px] text-slate-400 mb-0.5">룸티</label>
          <input
            type="text"
            inputMode="numeric"
            value={room.rt_count ?? ""}
            onChange={(e) => patchNum("rt_count", e.target.value)}
            disabled={readOnly}
            className="w-full rounded bg-[#030814] border border-white/10 px-2 py-1 text-[11px] disabled:opacity-50 text-right tabular-nums"
          />
        </div>
        <div>
          <label className="block text-[10px] text-slate-400 mb-0.5">웨이터팁</label>
          <input
            type="text"
            inputMode="numeric"
            value={room.waiter_tip_won?.toLocaleString() ?? ""}
            onChange={(e) => patchNum("waiter_tip_won", e.target.value)}
            disabled={readOnly}
            className="w-full rounded bg-[#030814] border border-white/10 px-2 py-1 text-[11px] disabled:opacity-50 text-right tabular-nums"
          />
        </div>
        <div>
          <label className="block text-[10px] text-slate-400 mb-0.5">외상</label>
          <input
            type="text"
            inputMode="numeric"
            value={room.misu_won?.toLocaleString() ?? ""}
            onChange={(e) => patchNum("misu_won", e.target.value)}
            disabled={readOnly}
            className="w-full rounded bg-[#030814] border border-white/10 px-2 py-1 text-[11px] disabled:opacity-50 text-right tabular-nums"
          />
        </div>
      </div>

      {/* 스태프 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-300">스태프 ({room.staff_entries?.length ?? 0}명)</span>
          {!readOnly && (
            <button
              onClick={addStaff}
              className="text-[10px] text-cyan-300 hover:text-cyan-200 px-1.5"
            >+ 추가</button>
          )}
        </div>
        {(room.staff_entries ?? []).map((s, i) => (
          <StaffEntryRow
            key={i}
            entry={s}
            onChange={(n) => updateStaff(i, n)}
            onRemove={() => removeStaff(i)}
            readOnly={readOnly}
          />
        ))}
      </div>

      {/* 양주 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-300">양주 ({room.liquor?.length ?? 0}병)</span>
          {!readOnly && (
            <button
              onClick={addLiquor}
              className="text-[10px] text-cyan-300 hover:text-cyan-200 px-1.5"
            >+ 추가</button>
          )}
        </div>
        {(room.liquor ?? []).map((l, i) => (
          <LiquorRow
            key={i}
            liquor={l}
            onChange={(n) => updateLiquor(i, n)}
            onRemove={() => removeLiquor(i)}
            readOnly={readOnly}
          />
        ))}
      </div>

      {/* raw_text */}
      {room.raw_text && (
        <details className="text-[10px] text-slate-500">
          <summary className="cursor-pointer">원본 텍스트</summary>
          <div className="mt-1 italic">{room.raw_text}</div>
        </details>
      )}
    </div>
  )
}
