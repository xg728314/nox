import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { StockDecrementResult, StockRestoreResult } from "@/lib/orders/types"

type DecrementInput = {
  inventory_item_id: string
  store_uuid: string
  qty: number
  item_name: string
  session_id: string
  business_day_id: string
  membership_id: string
}

type DecrementSuccess = {
  resolvedStorePrice: number
  stockRow: StockDecrementResult
  error?: never
}

type DecrementFailure = {
  error: NextResponse
  resolvedStorePrice?: never
  stockRow?: never
}

/**
 * Atomic stock decrement via DB function + inventory transaction log.
 *
 * Extracts the inventory decrement logic from orders/route.ts POST handler.
 * Preserves current atomic behavior and failure semantics exactly.
 */
export async function decrementStock(
  supabase: SupabaseClient,
  input: DecrementInput
): Promise<DecrementSuccess | DecrementFailure> {
  const { data: stockResult, error: stockErr } = await supabase
    .rpc("decrement_stock", {
      p_item_id: input.inventory_item_id,
      p_store_uuid: input.store_uuid,
      p_qty: input.qty,
    })

  if (stockErr || !stockResult || stockResult.length === 0) {
    return {
      error: NextResponse.json(
        { error: "INVENTORY_ITEM_NOT_FOUND", message: "재고 품목을 찾을 수 없습니다." },
        { status: 404 }
      ),
    }
  }

  const stockRow = stockResult[0] as StockDecrementResult

  if (!stockRow.success) {
    return {
      error: NextResponse.json(
        { error: "INSUFFICIENT_STOCK", message: `재고 부족: ${stockRow.item_name} (현재 ${stockRow.before_stock}개)` },
        { status: 400 }
      ),
    }
  }

  // Use inventory store_price as the authoritative store price
  const resolvedStorePrice = stockRow.item_store_price > 0 ? stockRow.item_store_price : stockRow.item_unit_cost

  // Record inventory transaction with actual atomic values
  await supabase
    .from("inventory_transactions")
    .insert({
      item_id: input.inventory_item_id,
      store_uuid: input.store_uuid,
      type: "out",
      quantity: input.qty,
      before_stock: stockRow.before_stock,
      after_stock: stockRow.after_stock,
      unit_cost: resolvedStorePrice,
      total_cost: resolvedStorePrice * input.qty,
      memo: `주문: ${input.item_name} (세션 ${input.session_id.slice(0, 8)})`,
      actor_membership_id: input.membership_id,
      session_id: input.session_id,
      business_day_id: input.business_day_id,
    })

  return { resolvedStorePrice, stockRow }
}

type RestoreInput = {
  inventory_item_id: string
  store_uuid: string
  qty: number
  order_id: string
  session_id: string
  membership_id: string
}

/**
 * Restore stock on order deletion — atomic via increment_stock RPC.
 *
 * Extracts the inventory restore logic from orders/[order_id]/route.ts DELETE handler.
 * Non-blocking: if restore fails, the delete still stands. Failure is logged.
 * Preserves current failure semantics exactly.
 *
 * P0-3 fix: replaced non-atomic read-modify-write with atomic increment_stock RPC
 * (mirroring the decrement_stock pattern from migration 022).
 */
export async function restoreStock(
  supabase: SupabaseClient,
  input: RestoreInput
): Promise<StockRestoreResult> {
  const { data: stockResult, error: stockErr } = await supabase
    .rpc("increment_stock", {
      p_item_id: input.inventory_item_id,
      p_store_uuid: input.store_uuid,
      p_qty: input.qty,
    })

  if (stockErr || !stockResult || stockResult.length === 0) {
    console.error("[order DELETE] stock restore RPC failed:", stockErr?.message ?? "no result")
    return null
  }

  const row = stockResult[0] as { success: boolean; before_stock: number; after_stock: number }

  if (!row.success) {
    console.error("[order DELETE] stock restore failed: item not found")
    return null
  }

  // Log the reversal as an inventory transaction so stock history is auditable.
  await supabase.from("inventory_transactions").insert({
    store_uuid: input.store_uuid,
    item_id: input.inventory_item_id,
    type: "reverse",
    quantity: input.qty,
    before_stock: row.before_stock,
    after_stock: row.after_stock,
    unit_cost: 0,
    total_cost: 0,
    memo: `주문 삭제 복구 (order_id=${input.order_id})`,
    actor_membership_id: input.membership_id,
    session_id: input.session_id,
  })

  return { before: row.before_stock, after: row.after_stock }
}
