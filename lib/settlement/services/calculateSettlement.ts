/**
 * LIVE settlement calculator — pure function, zero I/O.
 *
 * Extracts the v2-relock calculation logic from settlement/route.ts (lines 151–264).
 * This function does NOT modify any data. It receives pre-loaded rows and returns
 * all locked totals + legacy column mapping.
 *
 * IMPORTANT: This is completely independent from the DORMANT computeSessionShares.ts.
 * Do NOT import from or connect to computeSessionShares.ts.
 */

import type {
  ParticipantRow,
  OrderRow,
  SettlementTotals,
  SettlementConfig,
} from "@/lib/settlement/liveTypes"

function roundDown(amount: number, unit: number): number {
  if (unit <= 0) return amount
  return Math.floor(amount / unit) * unit
}

/**
 * NUMERIC → number 안전 변환. 2026-04-24 P0 fix.
 *
 * Supabase postgres-js 는 NUMERIC 을 string 으로 돌려줄 때가 있고 (정밀도
 * 보존), 일부 row 는 아직 값이 null 인 상태 (저장 중). 이전 코드는
 *   (p.price_amount ?? 0)
 * 만 써서:
 *   - 문자열 "12345" → NaN (+ 숫자 덧셈 실패)
 *   - NaN 값 → reduce 전체 오염
 * 이 가능했다. 여기서 한 번에 방어한다.
 *
 *   null/undefined → 0 (미저장 = 0 으로 간주; 비즈니스 룰)
 *   finite number  → 그대로
 *   숫자로 파싱 가능한 string → number
 *   그 외 (NaN/Infinity/객체) → 0 + console.warn
 */
function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0
  if (typeof v === "number") {
    return Number.isFinite(v) ? v : 0
  }
  if (typeof v === "string") {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  // object / boolean / etc — 금전 필드로는 부적합
  if (typeof console !== "undefined") {
    console.warn("[calculateSettlement] unexpected numeric value:", v)
  }
  return 0
}

/**
 * Calculate all settlement totals from participants, orders, and inventory costs.
 *
 * All inputs are pre-loaded DB rows. No Supabase calls inside.
 */
export function calculateSettlementTotals(
  participants: ParticipantRow[],
  orders: OrderRow[],
  unitCostByItemId: Map<string, number>,
  config: SettlementConfig
): SettlementTotals {
  // Cross-store split
  const localParticipants = participants.filter((p) => !p.origin_store_uuid)
  const crossStoreParticipants = participants.filter((p) => !!p.origin_store_uuid)

  // ── Pass-through: participant flow (time charges) ─────────────────────────
  // 2026-04-24: toNum() 으로 NUMERIC string / null / NaN 전부 안전 변환.
  const participantFlowTotal = participants.reduce(
    (sum, p) => sum + toNum(p.price_amount), 0
  )
  const managerProfitFromParticipants = participants.reduce(
    (sum, p) => sum + toNum(p.manager_payout_amount), 0
  )
  const hostessProfitFromParticipantsLocal = localParticipants.reduce(
    (sum, p) => sum + toNum(p.hostess_payout_amount), 0
  )
  const hostessProfitFromParticipantsCrossStore = crossStoreParticipants.reduce(
    (sum, p) => sum + toNum(p.hostess_payout_amount), 0
  )
  const hostessProfitTotal = hostessProfitFromParticipantsLocal + hostessProfitFromParticipantsCrossStore

  // ── Liquor: customer side, store-revenue side, COGS ───────────────────────
  const liquorCustomerTotal = orders.reduce((sum, o) => {
    const customerAmt = o.customer_amount
    if (customerAmt !== null && customerAmt !== undefined) {
      return sum + toNum(customerAmt)
    }
    return sum + toNum(o.qty) * toNum(o.unit_price)
  }, 0)
  const liquorDepositTotal = orders.reduce(
    (sum, o) => sum + toNum(o.store_price) * toNum(o.qty), 0
  )
  const managerProfitFromLiquor = orders.reduce(
    (sum, o) => sum + toNum(o.manager_amount), 0
  )
  const bottleCostTotal = orders.reduce((sum, o) => {
    if (!o.inventory_item_id) return sum
    const unitCost = toNum(unitCostByItemId.get(o.inventory_item_id))
    return sum + unitCost * toNum(o.qty)
  }, 0)

  // ── Locked totals ─────────────────────────────────────────────────────────
  const managerProfitTotal = managerProfitFromParticipants + managerProfitFromLiquor
  const storeRevenueTotal = liquorDepositTotal
  const storeProfitTotal = storeRevenueTotal - bottleCostTotal
  const customerTotal = participantFlowTotal + liquorCustomerTotal

  // Legacy TC display value
  const tcAmountLegacy = roundDown(
    Math.floor(participantFlowTotal * config.tcRate),
    config.roundingUnit
  )
  const tcCount = participants.filter((p) => toNum(p.price_amount) > 0).length

  // ── Legacy column mapping (no schema change) ──────────────────────────────
  return {
    customerTotal,
    participantFlowTotal,
    managerProfitTotal,
    managerProfitFromParticipants,
    managerProfitFromLiquor,
    hostessProfitTotal,
    hostessProfitFromParticipantsLocal,
    hostessProfitFromParticipantsCrossStore,
    liquorCustomerTotal,
    liquorDepositTotal,
    bottleCostTotal,
    storeRevenueTotal,
    storeProfitTotal,
    tcCount,
    tcAmountLegacy,

    grossTotal: customerTotal,
    tcAmount: tcAmountLegacy,
    managerAmount: managerProfitTotal,
    hostessAmount: hostessProfitTotal,
    marginAmount: storeProfitTotal,
    orderTotal: liquorCustomerTotal,
    participantTotal: participantFlowTotal,
    hostessAmountLocal: hostessProfitFromParticipantsLocal,
    hostessAmountCrossStore: hostessProfitFromParticipantsCrossStore,
  }
}
