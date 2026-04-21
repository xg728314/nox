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
  const participantFlowTotal = participants.reduce(
    (sum, p) => sum + (p.price_amount ?? 0), 0
  )
  const managerProfitFromParticipants = participants.reduce(
    (sum, p) => sum + (p.manager_payout_amount ?? 0), 0
  )
  const hostessProfitFromParticipantsLocal = localParticipants.reduce(
    (sum, p) => sum + (p.hostess_payout_amount ?? 0), 0
  )
  const hostessProfitFromParticipantsCrossStore = crossStoreParticipants.reduce(
    (sum, p) => sum + (p.hostess_payout_amount ?? 0), 0
  )
  const hostessProfitTotal = hostessProfitFromParticipantsLocal + hostessProfitFromParticipantsCrossStore

  // ── Liquor: customer side, store-revenue side, COGS ───────────────────────
  const liquorCustomerTotal = orders.reduce(
    (sum, o) => sum + (o.customer_amount ?? (o.qty * o.unit_price)), 0
  )
  const liquorDepositTotal = orders.reduce(
    (sum, o) => sum + ((o.store_price ?? 0) * (o.qty ?? 0)), 0
  )
  const managerProfitFromLiquor = orders.reduce(
    (sum, o) => sum + (o.manager_amount ?? 0), 0
  )
  const bottleCostTotal = orders.reduce((sum, o) => {
    if (!o.inventory_item_id) return sum
    const unitCost = unitCostByItemId.get(o.inventory_item_id) ?? 0
    return sum + unitCost * (o.qty ?? 0)
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
  const tcCount = participants.filter((p) => (p.price_amount ?? 0) > 0).length

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
