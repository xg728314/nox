import { describe, it, expect } from "vitest"
import { calculateSettlementTotals } from "@/lib/settlement/services/calculateSettlement"
import type {
  ParticipantRow,
  OrderRow,
  SettlementConfig,
} from "@/lib/settlement/liveTypes"

/**
 * calculateSettlementTotals — pure settlement calculator.
 *
 * Invariants under test (돈 계산 정확성):
 *   (I1) customerTotal == participantFlowTotal + liquorCustomerTotal
 *   (I2) managerProfitTotal == managerProfitFromParticipants + managerProfitFromLiquor
 *   (I3) hostessProfitTotal == local + crossStore
 *   (I4) storeProfitTotal == storeRevenueTotal - bottleCostTotal
 *   (I5) tcCount == participants.filter(price_amount > 0).length
 *   (I6) tcAmountLegacy == roundDown(floor(participantFlowTotal * tcRate), roundingUnit)
 *   (I7) legacy column mapping (grossTotal / managerAmount / hostessAmount / ...) 이 authoritative 과 일치
 *   (I8) null/undefined 안전: price_amount 없음 → 0 으로 합산
 *   (I9) 주문 customer_amount 없으면 qty * unit_price 로 폴백
 *   (I10) origin_store_uuid null/undefined = local, truthy = cross-store
 */

const DEFAULT_CFG: SettlementConfig = { tcRate: 0.1, roundingUnit: 1000 }

function p(over: Partial<ParticipantRow> = {}): ParticipantRow {
  return {
    id: "p",
    membership_id: "m",
    role: "hostess",
    category: "퍼블릭",
    price_amount: 0,
    manager_payout_amount: 0,
    hostess_payout_amount: 0,
    time_minutes: 90,
    status: "active",
    origin_store_uuid: null,
    ...over,
  }
}

function o(over: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "o",
    qty: 1,
    unit_price: 0,
    store_price: 0,
    sale_price: 0,
    manager_amount: 0,
    customer_amount: 0,
    inventory_item_id: null,
    ...over,
  }
}

describe("calculateSettlementTotals — empty input", () => {
  it("returns all-zero totals on empty participants + orders", () => {
    const t = calculateSettlementTotals([], [], new Map(), DEFAULT_CFG)
    expect(t.customerTotal).toBe(0)
    expect(t.participantFlowTotal).toBe(0)
    expect(t.managerProfitTotal).toBe(0)
    expect(t.hostessProfitTotal).toBe(0)
    expect(t.liquorCustomerTotal).toBe(0)
    expect(t.bottleCostTotal).toBe(0)
    expect(t.storeProfitTotal).toBe(0)
    expect(t.tcCount).toBe(0)
    expect(t.tcAmountLegacy).toBe(0)
  })

  it("legacy aliases mirror authoritative fields on empty input", () => {
    const t = calculateSettlementTotals([], [], new Map(), DEFAULT_CFG)
    expect(t.grossTotal).toBe(t.customerTotal)
    expect(t.managerAmount).toBe(t.managerProfitTotal)
    expect(t.hostessAmount).toBe(t.hostessProfitTotal)
    expect(t.marginAmount).toBe(t.storeProfitTotal)
    expect(t.orderTotal).toBe(t.liquorCustomerTotal)
    expect(t.participantTotal).toBe(t.participantFlowTotal)
  })
})

describe("calculateSettlementTotals — participant flow (I1, I5)", () => {
  it("sums participant price_amount into participantFlowTotal", () => {
    const t = calculateSettlementTotals(
      [p({ price_amount: 130000 }), p({ price_amount: 70000 }), p({ price_amount: 30000 })],
      [], new Map(), DEFAULT_CFG,
    )
    expect(t.participantFlowTotal).toBe(230000)
    expect(t.customerTotal).toBe(230000) // I1
    expect(t.tcCount).toBe(3) // I5
  })

  it("tcCount excludes participants with price_amount == 0", () => {
    const t = calculateSettlementTotals(
      [p({ price_amount: 130000 }), p({ price_amount: 0 }), p({ price_amount: 70000 })],
      [], new Map(), DEFAULT_CFG,
    )
    expect(t.tcCount).toBe(2)
    expect(t.participantFlowTotal).toBe(200000)
  })

  it("treats null price_amount as 0 (I8)", () => {
    const t = calculateSettlementTotals(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [p({ price_amount: null as any }), p({ price_amount: 100000 })],
      [], new Map(), DEFAULT_CFG,
    )
    expect(t.participantFlowTotal).toBe(100000)
  })
})

describe("calculateSettlementTotals — manager profit (I2)", () => {
  it("manager profit from participants + liquor sums correctly", () => {
    const t = calculateSettlementTotals(
      [p({ price_amount: 140000, manager_payout_amount: 10000 })],
      [o({ qty: 1, customer_amount: 100000, manager_amount: 5000 })],
      new Map(), DEFAULT_CFG,
    )
    expect(t.managerProfitFromParticipants).toBe(10000)
    expect(t.managerProfitFromLiquor).toBe(5000)
    expect(t.managerProfitTotal).toBe(15000) // I2
  })

  it("no manager cuts → managerProfitTotal = 0", () => {
    const t = calculateSettlementTotals(
      [p({ price_amount: 130000 })],
      [o({ qty: 1, customer_amount: 100000 })],
      new Map(), DEFAULT_CFG,
    )
    expect(t.managerProfitTotal).toBe(0)
  })
})

describe("calculateSettlementTotals — hostess profit split (I3, I10)", () => {
  it("origin_store_uuid null → local", () => {
    const t = calculateSettlementTotals(
      [p({ price_amount: 130000, hostess_payout_amount: 120000, origin_store_uuid: null })],
      [], new Map(), DEFAULT_CFG,
    )
    expect(t.hostessProfitFromParticipantsLocal).toBe(120000)
    expect(t.hostessProfitFromParticipantsCrossStore).toBe(0)
    expect(t.hostessProfitTotal).toBe(120000)
  })

  it("origin_store_uuid truthy → cross-store", () => {
    const t = calculateSettlementTotals(
      [p({ price_amount: 130000, hostess_payout_amount: 120000, origin_store_uuid: "store-B" })],
      [], new Map(), DEFAULT_CFG,
    )
    expect(t.hostessProfitFromParticipantsLocal).toBe(0)
    expect(t.hostessProfitFromParticipantsCrossStore).toBe(120000)
    expect(t.hostessProfitTotal).toBe(120000)
  })

  it("mixed local + cross-store participants split correctly (I3)", () => {
    const t = calculateSettlementTotals(
      [
        p({ id: "a", price_amount: 130000, hostess_payout_amount: 120000, origin_store_uuid: null }),
        p({ id: "b", price_amount: 130000, hostess_payout_amount: 110000, origin_store_uuid: "store-B" }),
        p({ id: "c", price_amount: 70000, hostess_payout_amount: 60000, origin_store_uuid: null }),
      ],
      [], new Map(), DEFAULT_CFG,
    )
    expect(t.hostessProfitFromParticipantsLocal).toBe(180000)
    expect(t.hostessProfitFromParticipantsCrossStore).toBe(110000)
    expect(t.hostessProfitTotal).toBe(290000)
    expect(t.hostessAmountLocal).toBe(t.hostessProfitFromParticipantsLocal)
    expect(t.hostessAmountCrossStore).toBe(t.hostessProfitFromParticipantsCrossStore)
  })
})

describe("calculateSettlementTotals — liquor + COGS (I4, I9)", () => {
  it("store_price * qty yields liquorDepositTotal", () => {
    const t = calculateSettlementTotals(
      [],
      [o({ qty: 3, store_price: 40000, customer_amount: 180000 })],
      new Map(), DEFAULT_CFG,
    )
    expect(t.liquorDepositTotal).toBe(120000)
    expect(t.liquorCustomerTotal).toBe(180000)
  })

  it("falls back to qty * unit_price when customer_amount missing (I9)", () => {
    const t = calculateSettlementTotals(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [],
      [o({ qty: 2, unit_price: 45000, customer_amount: null as any })],
      new Map(), DEFAULT_CFG,
    )
    expect(t.liquorCustomerTotal).toBe(90000)
  })

  it("bottleCostTotal = sum(unit_cost * qty) via unitCostByItemId map (I4)", () => {
    const costs = new Map<string, number>([
      ["item-1", 12000],
      ["item-2", 25000],
    ])
    const t = calculateSettlementTotals(
      [],
      [
        o({ qty: 2, store_price: 40000, customer_amount: 100000, inventory_item_id: "item-1" }),
        o({ qty: 1, store_price: 80000, customer_amount: 120000, inventory_item_id: "item-2" }),
      ],
      costs, DEFAULT_CFG,
    )
    expect(t.bottleCostTotal).toBe(24000 + 25000)
    expect(t.storeRevenueTotal).toBe(40000 * 2 + 80000)
    expect(t.storeProfitTotal).toBe(t.storeRevenueTotal - t.bottleCostTotal)
  })

  it("inventory_item_id missing → no bottle cost (no crash)", () => {
    const t = calculateSettlementTotals(
      [],
      [o({ qty: 5, store_price: 40000, customer_amount: 250000, inventory_item_id: null })],
      new Map(), DEFAULT_CFG,
    )
    expect(t.bottleCostTotal).toBe(0)
    expect(t.storeProfitTotal).toBe(t.storeRevenueTotal)
  })

  it("unitCostByItemId has no entry for given id → unit cost = 0", () => {
    const t = calculateSettlementTotals(
      [],
      [o({ qty: 3, store_price: 40000, customer_amount: 150000, inventory_item_id: "unknown-id" })],
      new Map(), DEFAULT_CFG,
    )
    expect(t.bottleCostTotal).toBe(0)
  })
})

describe("calculateSettlementTotals — TC legacy calc (I6)", () => {
  it("tcAmountLegacy rounds down to roundingUnit", () => {
    // participantFlowTotal = 230000, tcRate = 0.1 → floor(23000) = 23000
    //   roundDown(23000, 1000) = 23000
    const t = calculateSettlementTotals(
      [p({ price_amount: 130000 }), p({ price_amount: 70000 }), p({ price_amount: 30000 })],
      [], new Map(), { tcRate: 0.1, roundingUnit: 1000 },
    )
    expect(t.tcAmountLegacy).toBe(23000)
    expect(t.tcAmount).toBe(t.tcAmountLegacy) // legacy mirror
  })

  it("tcAmountLegacy truncates non-integer multiples to roundingUnit", () => {
    // participantFlowTotal = 123456, tcRate = 0.15 → floor(18518.4) = 18518
    //   roundDown(18518, 1000) = 18000
    const t = calculateSettlementTotals(
      [p({ price_amount: 123456 })],
      [], new Map(), { tcRate: 0.15, roundingUnit: 1000 },
    )
    expect(t.tcAmountLegacy).toBe(18000)
  })

  it("roundingUnit=0 disables rounding (safe fallback)", () => {
    const t = calculateSettlementTotals(
      [p({ price_amount: 100000 })],
      [], new Map(), { tcRate: 0.1, roundingUnit: 0 },
    )
    expect(t.tcAmountLegacy).toBe(10000)
  })

  it("tcRate=0 → tcAmountLegacy = 0", () => {
    const t = calculateSettlementTotals(
      [p({ price_amount: 300000 })],
      [], new Map(), { tcRate: 0, roundingUnit: 1000 },
    )
    expect(t.tcAmountLegacy).toBe(0)
  })
})

describe("calculateSettlementTotals — invariants compound scenario (I1..I7)", () => {
  it("full-session realistic scenario", () => {
    const participants = [
      p({ id: "a", price_amount: 140000, manager_payout_amount: 10000, hostess_payout_amount: 130000, origin_store_uuid: null }),
      p({ id: "b", price_amount: 70000, manager_payout_amount: 5000, hostess_payout_amount: 65000, origin_store_uuid: "store-X" }),
      p({ id: "c", price_amount: 30000, manager_payout_amount: 0, hostess_payout_amount: 30000, origin_store_uuid: null }),
    ]
    const orders = [
      o({ qty: 2, store_price: 40000, customer_amount: 150000, manager_amount: 3000, inventory_item_id: "whisky-1" }),
      o({ qty: 1, store_price: 80000, customer_amount: 100000, manager_amount: 2000, inventory_item_id: "whisky-2" }),
    ]
    const costs = new Map([["whisky-1", 15000], ["whisky-2", 40000]])
    const t = calculateSettlementTotals(participants, orders, costs, DEFAULT_CFG)

    // I1
    expect(t.customerTotal).toBe(t.participantFlowTotal + t.liquorCustomerTotal)
    expect(t.customerTotal).toBe(240000 + 250000)
    // I2
    expect(t.managerProfitTotal).toBe(
      t.managerProfitFromParticipants + t.managerProfitFromLiquor,
    )
    expect(t.managerProfitTotal).toBe(15000 + 5000)
    // I3
    expect(t.hostessProfitTotal).toBe(
      t.hostessProfitFromParticipantsLocal + t.hostessProfitFromParticipantsCrossStore,
    )
    expect(t.hostessProfitFromParticipantsLocal).toBe(160000)
    expect(t.hostessProfitFromParticipantsCrossStore).toBe(65000)
    // I4
    expect(t.storeProfitTotal).toBe(t.storeRevenueTotal - t.bottleCostTotal)
    expect(t.storeRevenueTotal).toBe(40000 * 2 + 80000)
    expect(t.bottleCostTotal).toBe(15000 * 2 + 40000 * 1)
    // I5
    expect(t.tcCount).toBe(3)
    // I7
    expect(t.grossTotal).toBe(t.customerTotal)
    expect(t.managerAmount).toBe(t.managerProfitTotal)
    expect(t.hostessAmount).toBe(t.hostessProfitTotal)
    expect(t.marginAmount).toBe(t.storeProfitTotal)
  })

  it("legacy aliases equal authoritative values across non-trivial inputs", () => {
    const t = calculateSettlementTotals(
      [p({ price_amount: 130000, manager_payout_amount: 10000, hostess_payout_amount: 120000 })],
      [o({ qty: 1, store_price: 40000, customer_amount: 80000, inventory_item_id: "x" })],
      new Map([["x", 15000]]),
      { tcRate: 0.1, roundingUnit: 1000 },
    )
    expect(t.grossTotal).toBe(t.customerTotal)
    expect(t.tcAmount).toBe(t.tcAmountLegacy)
    expect(t.orderTotal).toBe(t.liquorCustomerTotal)
    expect(t.participantTotal).toBe(t.participantFlowTotal)
    expect(t.hostessAmountLocal).toBe(t.hostessProfitFromParticipantsLocal)
    expect(t.hostessAmountCrossStore).toBe(t.hostessProfitFromParticipantsCrossStore)
  })
})
