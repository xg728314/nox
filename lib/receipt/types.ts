/**
 * Receipt Document Model — single source of truth for all renderers.
 * Preview / PNG / Print all consume this same structure.
 * NO renderer may recalculate amounts — snapshot values only.
 */

export type ReceiptType = "interim" | "final"
export type ReceiptCalcMode = "elapsed" | "half_ticket"

export type ReceiptParticipantSnapshot = {
  id: string
  name: string | null
  category: string | null
  time_minutes: number
  price_amount: number
  status: string
}

export type ReceiptOrderSnapshot = {
  id: string
  item_name: string
  order_type: string
  qty: number
  unit_price: number
  amount: number
  /** Dual pricing (added in ORDER-PRICE-DUAL-TRACK) */
  store_price?: number
  sale_price?: number
  manager_amount?: number
  customer_amount?: number
}

export type ReceiptDocument = {
  /** Snapshot metadata */
  snapshot_id: string
  receipt_type: ReceiptType
  created_at: string
  created_by: string | null

  /** Session context */
  session_id: string
  store_uuid: string
  store_name?: string | null
  room_uuid: string
  room_label: string

  /** Customer info */
  customer_name: string | null
  customer_party_size: number

  /** Manager info */
  manager_name: string | null

  /** Time info */
  started_at: string
  ended_at: string | null

  /** Participant snapshot */
  participants: ReceiptParticipantSnapshot[]
  participant_total: number

  /** Order snapshot */
  orders: ReceiptOrderSnapshot[]
  order_total: number

  /** Totals (pre-calculated, never recompute in renderer) */
  grand_total: number

  /** Dual pricing totals (added in ORDER-PRICE-DUAL-TRACK) */
  store_total?: number
  manager_total?: number
  customer_total?: number

  /** Payment info (final only) */
  payment_method?: string | null
  card_fee_amount?: number
  card_surcharge?: number

  /** Settlement amounts (internal, for final receipts) */
  settlement?: {
    gross_total: number
    tc_amount: number
    manager_amount: number
    hostess_amount: number
    margin_amount: number
  } | null

  /** Reprint tracking */
  is_reprint?: boolean
  original_snapshot_id?: string | null

  /** Interim calculation mode (interim receipts only) */
  calc_mode?: ReceiptCalcMode
  calc_reference_minutes?: number
}
