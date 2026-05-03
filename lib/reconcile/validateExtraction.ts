/**
 * validateExtraction — 종이장부 추출 결과 자동 검증.
 *
 * R-AutoPrice (2026-05-01):
 *   운영자 의도:
 *     - 종목별 단가 자동 환산 (이미 fillExtractionPayouts 가 처리).
 *     - 계좌 / 가게 입금 / 줄돈 / 양주 합계가 일치하는지 검증.
 *     - 차이 발생 시 "얼마 차이" 표시.
 *     - 실장수익 (계좌 - 가게 입금) 도표.
 *
 * 비교 항목:
 *   1. 손님 청구 예상액 = liquor + sum(staff_payout) + waiter_tip
 *      vs 운영자 적은 cash_total_won (계좌)
 *   2. 외부매장 줄돈 — daily_summary.owe[X] vs sum(staff_entries.where(origin_store=X).hostess_payout)
 *   3. 실장수익 = cash_total_won - store_deposit_won (단순 차액).
 */

import type {
  ExtractionValidation,
  OweValidation,
  PaperExtraction,
  RoomValidation,
} from "./types"

const TOLERANCE_WON = 1000 // 1천원 미만 차이는 무시 (반올림 노이즈).

function num(v: unknown): number {
  const n = typeof v === "number" ? v : 0
  return Number.isFinite(n) ? n : 0
}

export function validateExtraction(extraction: PaperExtraction): ExtractionValidation {
  const roomValidations: RoomValidation[] = []
  const owePerStore: OweValidation[] = []

  let totalWarnings = 0

  // ── per-room ────────────────────────────────────────────
  for (const room of extraction.rooms ?? []) {
    const liquor = (room.liquor ?? []).reduce((s, l) => s + num(l.amount_won), 0)
    const staffTotal = (room.staff_entries ?? []).reduce(
      (s, e) => s + num(e.hostess_payout_won),
      0,
    )
    const tip = num(room.waiter_tip_won)
    const expected = liquor + staffTotal + tip

    const paperCash =
      typeof room.cash_total_won === "number" ? room.cash_total_won : null
    const paperDeposit =
      typeof room.store_deposit_won === "number" ? room.store_deposit_won : null

    const cashDiff =
      paperCash !== null ? paperCash - expected : null
    const cashMinusDeposit =
      paperCash !== null && paperDeposit !== null ? paperCash - paperDeposit : null
    const managerProfit = cashMinusDeposit

    const warnings: string[] = []

    if (paperCash !== null && cashDiff !== null && Math.abs(cashDiff) > TOLERANCE_WON) {
      warnings.push(
        `손님 청구 예상 ${expected.toLocaleString()}원 vs 종이 계좌 ${paperCash.toLocaleString()}원 ` +
          `(차이 ${cashDiff > 0 ? "+" : ""}${cashDiff.toLocaleString()}원)`,
      )
    }
    if (paperDeposit !== null && paperCash !== null && cashMinusDeposit !== null) {
      // 음수면 가게 입금이 손님 결제보다 많은 이상 케이스 — 경고.
      if (cashMinusDeposit < 0) {
        warnings.push(
          `가게 입금 ${paperDeposit.toLocaleString()}원 > 손님 결제 ${paperCash.toLocaleString()}원 — 입력 오류 가능`,
        )
      }
    }

    totalWarnings += warnings.length

    roomValidations.push({
      room_no: room.room_no,
      liquor_total_won: liquor,
      staff_payout_total_won: staffTotal,
      waiter_tip_won: tip,
      expected_customer_total_won: expected,
      paper_cash_total_won: paperCash,
      cash_total_diff_won: cashDiff,
      paper_store_deposit_won: paperDeposit,
      cash_minus_deposit_won: cashMinusDeposit,
      manager_profit_won: managerProfit,
      warnings,
    })
  }

  // ── owe per-store: paper vs computed ─────────────────────
  // staff_entries 합계를 origin_store 별로 묶기.
  const computedByStore = new Map<string, number>()
  for (const room of extraction.rooms ?? []) {
    for (const e of room.staff_entries ?? []) {
      const name = (e.origin_store ?? "").trim()
      if (!name) continue
      const amt = num(e.hostess_payout_won)
      computedByStore.set(name, (computedByStore.get(name) ?? 0) + amt)
    }
  }
  // 종이 줄돈 박스.
  const paperByStore = new Map<string, number>()
  for (const o of extraction.daily_summary?.owe ?? []) {
    const name = (o.store_name ?? "").trim()
    if (!name) continue
    paperByStore.set(name, (paperByStore.get(name) ?? 0) + num(o.amount_won))
  }
  const allStoreNames = new Set([...computedByStore.keys(), ...paperByStore.keys()])
  for (const storeName of allStoreNames) {
    const paper = paperByStore.get(storeName) ?? 0
    const computed = computedByStore.get(storeName) ?? 0
    const diff = paper - computed
    if (Math.abs(diff) > TOLERANCE_WON) totalWarnings += 1
    owePerStore.push({
      store_name: storeName,
      paper_won: paper,
      computed_won: computed,
      diff_won: diff,
    })
  }
  owePerStore.sort((a, b) => Math.abs(b.diff_won) - Math.abs(a.diff_won))

  return {
    rooms: roomValidations,
    owe_per_store: owePerStore,
    total_warnings: totalWarnings,
  }
}
