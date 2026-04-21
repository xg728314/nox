/**
 * LIVE order domain types — shared between orders/route.ts and orders/[order_id]/route.ts.
 */

export type OrderListRow = {
  id: string
  session_id: string
  item_name: string
  order_type: string
  qty: number
  unit_price: number
  store_price: number
  sale_price: number
  manager_amount: number
  customer_amount: number
  ordered_by: string | null
  created_at: string
}

export type OrderMutationRow = {
  id: string
  session_id: string
  store_uuid: string
  item_name: string
  order_type: string
  qty: number
  unit_price: number
}

export type StockDecrementResult = {
  success: boolean
  before_stock: number
  after_stock: number
  item_name: string
  item_store_price: number
  item_unit_cost: number
}

export type StockRestoreResult = {
  before: number
  after: number
} | null

export type CreateOrderInput = {
  session_id: string
  item_name: string
  order_type: string
  qty: number
  unit_price: number
  sale_price?: number
  inventory_item_id?: string | null
}

export type PatchOrderInput = {
  item_name?: string
  order_type?: string
  qty?: number
  unit_price?: number
}
