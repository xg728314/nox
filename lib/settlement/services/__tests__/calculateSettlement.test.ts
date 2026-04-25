/**
 * calculateSettlement 단위 테스트.
 *
 * 2026-04-24: NOX 는 금전 장부 시스템 — 이 함수가 잘못된 금액을 반환하면
 *   즉시 영업 손실. 회귀 방지를 위한 핵심 fixture 세트.
 *
 * 실행: `npm test`
 */

import { describe, it, expect } from "vitest"
import { calculateSettlementTotals } from "../calculateSettlement"
import type { ParticipantRow, OrderRow, SettlementConfig } from "../../liveTypes"

const CONFIG: SettlementConfig = { tcRate: 1.0, roundingUnit: 0 }

function p(overrides: Partial<ParticipantRow>): ParticipantRow {
  return {
    id: "p1",
    membership_id: "m1",
    role: "hostess",
    category: "퍼블릭",
    price_amount: 0,
    manager_payout_amount: 0,
    hostess_payout_amount: 0,
    time_minutes: 90,
    status: "active",
    origin_store_uuid: null,
    ...overrides,
  }
}

function o(overrides: Partial<OrderRow>): OrderRow {
  return {
    id: "o1",
    qty: 1,
    unit_price: 0,
    store_price: 0,
    sale_price: 0,
    manager_amount: 0,
    customer_amount: 0,
    inventory_item_id: null,
    ...overrides,
  }
}

describe("calculateSettlementTotals", () => {
  it("빈 세션 — 모든 합계 0", () => {
    const r = calculateSettlementTotals([], [], new Map(), CONFIG)
    expect(r.participantFlowTotal).toBe(0)
    expect(r.managerProfitTotal).toBe(0)
    expect(r.hostessProfitTotal).toBe(0)
    expect(r.liquorCustomerTotal).toBe(0)
    expect(r.grossTotal).toBe(0)
    expect(r.tcCount).toBe(0)
  })

  it("퍼블릭 단일 — 13만원 타임, 실장 1만, 스태프 12만", () => {
    const r = calculateSettlementTotals(
      [p({ price_amount: 130000, manager_payout_amount: 10000, hostess_payout_amount: 120000 })],
      [],
      new Map(),
      CONFIG,
    )
    expect(r.participantFlowTotal).toBe(130000)
    expect(r.managerProfitFromParticipants).toBe(10000)
    expect(r.hostessProfitTotal).toBe(120000)
    expect(r.customerTotal).toBe(130000)
    expect(r.tcCount).toBe(1)
  })

  it("퍼블릭 3명 × 13만 = 39만", () => {
    const r = calculateSettlementTotals(
      [
        p({ id: "p1", price_amount: 130000, manager_payout_amount: 10000, hostess_payout_amount: 120000 }),
        p({ id: "p2", price_amount: 130000, manager_payout_amount: 5000, hostess_payout_amount: 125000 }),
        p({ id: "p3", price_amount: 130000, manager_payout_amount: 0, hostess_payout_amount: 130000 }),
      ],
      [],
      new Map(),
      CONFIG,
    )
    expect(r.participantFlowTotal).toBe(390000)
    expect(r.managerProfitFromParticipants).toBe(15000)
    expect(r.hostessProfitTotal).toBe(375000)
    expect(r.tcCount).toBe(3)
  })

  it("차3 포함 — price 3만 카운트", () => {
    const r = calculateSettlementTotals(
      [
        p({ id: "p1", price_amount: 130000, hostess_payout_amount: 130000 }),
        p({ id: "p2", price_amount: 30000, hostess_payout_amount: 30000, time_minutes: 15, category: "차3" }),
      ],
      [],
      new Map(),
      CONFIG,
    )
    expect(r.participantFlowTotal).toBe(160000)
    expect(r.tcCount).toBe(2)
  })

  it("타매장 스태프 분리 — crossStore local 과 구분", () => {
    const r = calculateSettlementTotals(
      [
        p({ id: "local", origin_store_uuid: null, price_amount: 130000, hostess_payout_amount: 120000 }),
        p({ id: "cross", origin_store_uuid: "store-other", price_amount: 140000, hostess_payout_amount: 130000 }),
      ],
      [],
      new Map(),
      CONFIG,
    )
    expect(r.hostessProfitFromParticipantsLocal).toBe(120000)
    expect(r.hostessProfitFromParticipantsCrossStore).toBe(130000)
    expect(r.hostessProfitTotal).toBe(250000)
  })

  it("주류 주문 — 손님가 + 입금가 + 실장마진 각각 합산", () => {
    const r = calculateSettlementTotals(
      [],
      [
        o({ qty: 1, customer_amount: 100000, store_price: 70000, manager_amount: 20000 }),
        o({ qty: 2, customer_amount: 180000, store_price: 60000, manager_amount: 10000 }),
      ],
      new Map(),
      CONFIG,
    )
    expect(r.liquorCustomerTotal).toBe(280000)
    expect(r.liquorDepositTotal).toBe(70000 + 60000 * 2) // 190000
    expect(r.managerProfitFromLiquor).toBe(30000)
    expect(r.storeRevenueTotal).toBe(190000)
  })

  it("주류 + 재고 원가 — storeProfitTotal 계산", () => {
    const r = calculateSettlementTotals(
      [],
      [o({ qty: 2, customer_amount: 180000, store_price: 60000, inventory_item_id: "item-x" })],
      new Map([["item-x", 20000]]),
      CONFIG,
    )
    expect(r.bottleCostTotal).toBe(40000) // 2 * 20000
    expect(r.storeRevenueTotal).toBe(120000) // 2 * 60000
    expect(r.storeProfitTotal).toBe(80000)
  })

  it("customer_amount null 이면 qty * unit_price fallback", () => {
    const r = calculateSettlementTotals(
      [],
      [o({ qty: 3, unit_price: 50000, customer_amount: null as unknown as number })],
      new Map(),
      CONFIG,
    )
    expect(r.liquorCustomerTotal).toBe(150000)
  })

  it("NULL 금액 방어 — price_amount=null 이어도 NaN 안 남", () => {
    const r = calculateSettlementTotals(
      [
        p({ id: "p1", price_amount: 130000 }),
        p({ id: "p2", price_amount: null as unknown as number }),
      ],
      [],
      new Map(),
      CONFIG,
    )
    expect(r.participantFlowTotal).toBe(130000)
    expect(Number.isFinite(r.participantFlowTotal)).toBe(true)
  })

  it("문자열 NUMERIC 방어 — '130000' 도 정상 합산", () => {
    const r = calculateSettlementTotals(
      [p({ price_amount: "130000" as unknown as number })],
      [],
      new Map(),
      CONFIG,
    )
    expect(r.participantFlowTotal).toBe(130000)
  })

  it("NaN/Infinity 입력 — 0 으로 취급", () => {
    const r = calculateSettlementTotals(
      [p({ price_amount: NaN as unknown as number })],
      [],
      new Map(),
      CONFIG,
    )
    expect(r.participantFlowTotal).toBe(0)
    expect(Number.isFinite(r.participantFlowTotal)).toBe(true)
  })

  it("종합 — 3명 + 주류 2건 + 재고", () => {
    const r = calculateSettlementTotals(
      [
        p({ id: "p1", price_amount: 130000, manager_payout_amount: 10000, hostess_payout_amount: 120000 }),
        p({ id: "p2", price_amount: 140000, manager_payout_amount: 10000, hostess_payout_amount: 130000, category: "셔츠", time_minutes: 60 }),
        p({ id: "p3", price_amount: 120000, manager_payout_amount: 5000, hostess_payout_amount: 115000, category: "하퍼", time_minutes: 60 }),
      ],
      [
        o({ qty: 1, customer_amount: 150000, store_price: 80000, manager_amount: 30000, inventory_item_id: "whisky" }),
      ],
      new Map([["whisky", 40000]]),
      CONFIG,
    )
    expect(r.participantFlowTotal).toBe(390000)
    expect(r.managerProfitFromParticipants).toBe(25000)
    expect(r.managerProfitFromLiquor).toBe(30000)
    expect(r.managerProfitTotal).toBe(55000)
    expect(r.hostessProfitTotal).toBe(365000)
    expect(r.liquorCustomerTotal).toBe(150000)
    expect(r.liquorDepositTotal).toBe(80000)
    expect(r.bottleCostTotal).toBe(40000)
    expect(r.storeProfitTotal).toBe(40000)
    expect(r.customerTotal).toBe(540000)
  })

  it("인원수 tcCount — price_amount > 0 만 카운트", () => {
    const r = calculateSettlementTotals(
      [
        p({ id: "p1", price_amount: 130000 }),
        p({ id: "p2", price_amount: 0 }),
        p({ id: "p3", price_amount: 120000 }),
      ],
      [],
      new Map(),
      CONFIG,
    )
    expect(r.tcCount).toBe(2)
  })

  it("회귀 방지 — customer_amount=0 은 fallback 으로 넘어가지 않음", () => {
    // customer_amount 가 명시적 0 이면 0 으로 유지. null 일 때만 fallback.
    const r = calculateSettlementTotals(
      [],
      [o({ qty: 5, unit_price: 10000, customer_amount: 0 })],
      new Map(),
      CONFIG,
    )
    expect(r.liquorCustomerTotal).toBe(0)
  })
})
