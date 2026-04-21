/**
 * LIVE settlement types — used by settlement/route.ts and settlement/finalize/route.ts.
 *
 * These are completely independent from the DORMANT computeSessionShares.ts types.
 * Do NOT import from or connect to computeSessionShares.ts.
 */

export type ParticipantRow = {
  id: string
  membership_id: string
  role: string
  category: string
  price_amount: number
  manager_payout_amount: number
  hostess_payout_amount: number
  time_minutes: number
  status: string
  origin_store_uuid: string | null
}

export type OrderRow = {
  id: string
  qty: number
  unit_price: number
  store_price: number
  sale_price: number
  manager_amount: number
  customer_amount: number
  inventory_item_id: string | null
}

export type SettlementTotals = {
  // Authoritative locked totals (v2-relock)
  customerTotal: number
  participantFlowTotal: number
  managerProfitTotal: number
  managerProfitFromParticipants: number
  managerProfitFromLiquor: number
  hostessProfitTotal: number
  hostessProfitFromParticipantsLocal: number
  hostessProfitFromParticipantsCrossStore: number
  liquorCustomerTotal: number
  liquorDepositTotal: number
  bottleCostTotal: number
  storeRevenueTotal: number
  storeProfitTotal: number
  tcCount: number
  tcAmountLegacy: number

  // Legacy column mapping (no schema change, repurposed names)
  grossTotal: number
  tcAmount: number
  managerAmount: number
  hostessAmount: number
  marginAmount: number
  orderTotal: number
  participantTotal: number
  hostessAmountLocal: number
  hostessAmountCrossStore: number
}

export type SettlementConfig = {
  tcRate: number
  roundingUnit: number
}

export type CrossStoreParticipantSnapshot = {
  membership_id: string
  origin_store_uuid: string | null
  hostess_payout_amount: number
}
