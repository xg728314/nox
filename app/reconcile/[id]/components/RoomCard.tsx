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

import type { PaperRoomCell, PaymentMethod, RoomLiquor, RoomStaffEntry } from "@/lib/reconcile/types"
import { confidenceLevel } from "@/lib/reconcile/qualityHints"
import ConfidenceBadge from "./ConfidenceBadge"
import StaffEntryRow from "./StaffEntryRow"
import LiquorRow from "./LiquorRow"

export type RoomCardProps = {
  room: PaperRoomCell
  onChange: (next: PaperRoomCell) => void
  onRemoveRoom: () => void
  readOnly?: boolean
  /** R-A v5: 매장 호스티스 후보 (datalist 자동완성). */
  knownHostesses?: string[]
  knownStores?: string[]
  /** datalist id 충돌 방지 — RoomsEditor 가 room index 기반 prefix 부여. */
  datalistIdPrefix?: string
}

export default function RoomCard({
  room, onChange, onRemoveRoom, readOnly,
  knownHostesses, knownStores, datalistIdPrefix,
}: RoomCardProps) {
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
      {/* 2026-05-01 R-AutoPrice UI: entry 사이 간격 1.5 → 3 (구분 강화).
          헤더에 N명 number-pill 로 더 잘 보이게. */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-300">스태프</span>
          <span className="inline-flex items-center justify-center min-w-[22px] h-[20px] px-1.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-[10px] font-semibold text-emerald-300 tabular-nums">
            {room.staff_entries?.length ?? 0}
          </span>
        </div>
        {(room.staff_entries ?? []).map((s, i) => (
          <StaffEntryRow
            key={i}
            entry={s}
            onChange={(n) => updateStaff(i, n)}
            onRemove={() => removeStaff(i)}
            readOnly={readOnly}
            knownHostesses={knownHostesses}
            knownStores={knownStores}
            datalistIdPrefix={datalistIdPrefix ? `${datalistIdPrefix}-s${i}` : `r-s${i}`}
          />
        ))}
        {!readOnly && (
          <button
            onClick={addStaff}
            className="w-full py-2 rounded-lg border border-dashed border-cyan-500/40 text-cyan-300 text-xs font-semibold hover:bg-cyan-500/10 hover:border-cyan-400 active:scale-95 transition"
          >+ 스태프 추가</button>
        )}
      </div>

      {/* 2026-05-01 R-AutoPrice UI: 이 방 줄돈 매장별 합계.
          staff_entries 의 origin_store 별로 hostess_payout_won 묶음 + 총합. */}
      <RoomOweSummary
        entries={room.staff_entries ?? []}
        liquor_total_won={(room.liquor ?? []).reduce((s, l) => s + (l.amount_won || 0), 0)}
        cash_total_won={room.cash_total_won}
        store_deposit_won={room.store_deposit_won}
        waiter_tip_won={room.waiter_tip_won}
      />

      {/* 양주 */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold text-slate-300">
          양주 ({room.liquor?.length ?? 0}병)
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
        {!readOnly && (
          <button
            onClick={addLiquor}
            className="w-full py-2 rounded-lg border border-dashed border-cyan-500/40 text-cyan-300 text-xs font-semibold hover:bg-cyan-500/10 hover:border-cyan-400 active:scale-95 transition"
          >+ 양주 추가</button>
        )}
      </div>

      {/* Phase A2: 결제 정보 (카운터 schema 와 동일) */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold text-slate-300">결제</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-slate-400 mb-0.5">현금</label>
            <div className="flex items-center gap-1 rounded bg-[#030814] border border-white/10 px-2 py-1">
              <span className="text-[10px] text-slate-500">₩</span>
              <input
                type="text"
                inputMode="numeric"
                value={room.cash_total_won != null ? room.cash_total_won.toLocaleString() : ""}
                onChange={(e) => patchNum("cash_total_won", e.target.value)}
                disabled={readOnly}
                className="flex-1 min-w-0 bg-transparent text-[11px] text-right tabular-nums outline-none disabled:opacity-50"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 mb-0.5">카드</label>
            <div className="flex items-center gap-1 rounded bg-[#030814] border border-white/10 px-2 py-1">
              <span className="text-[10px] text-slate-500">₩</span>
              <input
                type="text"
                inputMode="numeric"
                value={room.card_total_won != null ? room.card_total_won.toLocaleString() : ""}
                onChange={(e) => patchNum("card_total_won", e.target.value)}
                disabled={readOnly}
                className="flex-1 min-w-0 bg-transparent text-[11px] text-right tabular-nums outline-none disabled:opacity-50"
              />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-slate-400 mb-0.5">카드수수료</label>
            <div className="flex items-center gap-1 rounded bg-[#030814] border border-white/10 px-2 py-1">
              <span className="text-[10px] text-slate-500">₩</span>
              <input
                type="text"
                inputMode="numeric"
                value={room.card_fee_won != null ? room.card_fee_won.toLocaleString() : ""}
                onChange={(e) => patchNum("card_fee_won", e.target.value)}
                disabled={readOnly}
                className="flex-1 min-w-0 bg-transparent text-[11px] text-right tabular-nums outline-none disabled:opacity-50"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-slate-400 mb-0.5">결제방식</label>
            <select
              value={room.payment_method ?? ""}
              onChange={(e) => patch("payment_method", (e.target.value || undefined) as PaymentMethod | undefined)}
              disabled={readOnly}
              className="w-full rounded bg-[#030814] border border-white/10 px-2 py-1 text-[11px] disabled:opacity-50"
            >
              <option value="">자동</option>
              <option value="cash">현금</option>
              <option value="card">카드</option>
              <option value="credit">외상</option>
              <option value="mixed">혼합</option>
            </select>
          </div>
        </div>
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

// ─── 매장별 줄돈 합계 + 실장수익 ──────────────────────────────
//
// R-AutoPrice (2026-05-01):
//   "1번방같은경우 다른가게 스태프다 그러면 신세계 발리 상한가 버닝에 줄돈만
//    생긴거다" — staff_entries 의 origin_store 별로 묶어서 매장당 얼마인지 표시.
//   + 양주/팁/총청구/계좌/입금/실장수익 한 눈에.

function fmtWon(n: number | null | undefined): string {
  if (n == null) return "-"
  const sign = n < 0 ? "-" : ""
  return `${sign}₩${Math.abs(n).toLocaleString()}`
}

function RoomOweSummary({
  entries,
  liquor_total_won,
  cash_total_won,
  store_deposit_won,
  waiter_tip_won,
}: {
  entries: RoomStaffEntry[]
  liquor_total_won: number
  cash_total_won?: number
  store_deposit_won?: number
  waiter_tip_won?: number
}) {
  // origin_store 별 묶기.
  const byStore = new Map<string, number>()
  let staffTotal = 0
  for (const e of entries) {
    const name = (e.origin_store ?? "").trim()
    const amt = e.hostess_payout_won ?? 0
    if (!amt) continue
    if (!name) continue
    byStore.set(name, (byStore.get(name) ?? 0) + amt)
    staffTotal += amt
  }
  const tip = waiter_tip_won ?? 0
  const expectedCustomer = liquor_total_won + staffTotal + tip
  const cashDiff =
    typeof cash_total_won === "number" ? cash_total_won - expectedCustomer : null
  const managerProfit =
    typeof cash_total_won === "number" && typeof store_deposit_won === "number"
      ? cash_total_won - store_deposit_won
      : null

  const hasOweData = byStore.size > 0
  const hasMoney = liquor_total_won > 0 || staffTotal > 0 || tip > 0 || cash_total_won != null

  if (!hasOweData && !hasMoney) return null

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-emerald-200">💰 이 방 정산 요약</span>
      </div>

      {hasOweData && (
        <div className="rounded-lg bg-black/30 p-2.5 space-y-1">
          <div className="text-[10px] text-slate-400 mb-1">매장별 줄돈 (외부 매장에 보낼 돈)</div>
          {Array.from(byStore.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([name, amt]) => (
              <div key={name} className="flex items-center justify-between text-[11px]">
                <span className="text-slate-200">{name}</span>
                <span className="text-emerald-300 tabular-nums font-semibold">
                  {fmtWon(amt)}
                </span>
              </div>
            ))}
          <div className="flex items-center justify-between pt-1.5 mt-1 border-t border-white/10 text-[11px]">
            <span className="text-slate-300 font-semibold">줄돈 합계</span>
            <span className="text-emerald-200 tabular-nums font-bold">{fmtWon(staffTotal)}</span>
          </div>
        </div>
      )}

      <div className="rounded-lg bg-black/30 p-2.5 space-y-1 text-[11px]">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {liquor_total_won > 0 && (
            <>
              <span className="text-slate-400">양주 합계</span>
              <span className="text-right text-slate-200 tabular-nums">{fmtWon(liquor_total_won)}</span>
            </>
          )}
          {staffTotal > 0 && (
            <>
              <span className="text-slate-400">스태프 합계</span>
              <span className="text-right text-slate-200 tabular-nums">{fmtWon(staffTotal)}</span>
            </>
          )}
          {tip > 0 && (
            <>
              <span className="text-slate-400">웨이터팁</span>
              <span className="text-right text-slate-200 tabular-nums">{fmtWon(tip)}</span>
            </>
          )}
          <span className="text-slate-300 font-semibold">손님 청구 예상</span>
          <span className="text-right text-cyan-300 tabular-nums font-bold">
            {fmtWon(expectedCustomer)}
          </span>
          {typeof cash_total_won === "number" && (
            <>
              <span className="text-slate-400">종이 계좌</span>
              <span className="text-right text-slate-200 tabular-nums">{fmtWon(cash_total_won)}</span>
              {cashDiff !== null && Math.abs(cashDiff) > 1000 && (
                <>
                  <span className="text-amber-300">차이 (계좌-예상)</span>
                  <span className="text-right text-amber-300 tabular-nums font-semibold">
                    {fmtWon(cashDiff)}
                  </span>
                </>
              )}
            </>
          )}
          {typeof store_deposit_won === "number" && (
            <>
              <span className="text-slate-400">가게 입금</span>
              <span className="text-right text-slate-200 tabular-nums">{fmtWon(store_deposit_won)}</span>
            </>
          )}
          {managerProfit !== null && (
            <>
              <span className="text-emerald-200 font-semibold">실장수익 (계좌-입금)</span>
              <span className="text-right text-emerald-200 tabular-nums font-bold">
                {fmtWon(managerProfit)}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
