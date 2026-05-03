import { NextResponse } from "next/server"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { writeSessionAudit } from "@/lib/session/auditWriter"
import { loadOrderForMutation } from "@/lib/orders/services/orderMutations"
import { validatePatchOrderInput } from "@/lib/orders/services/validateOrder"
import { restoreStock } from "@/lib/orders/services/inventoryOps"
import { invalidate as invalidateCache } from "@/lib/cache/inMemoryTtl"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ order_id: string }> }
) {
  try {
    const { order_id } = await params

    let body: { item_name?: string; order_type?: string; qty?: number; unit_price?: number }
    try { body = await request.json() }
    catch { return NextResponse.json({ error: "BAD_REQUEST", message: "Invalid JSON." }, { status: 400 }) }

    const ctx = await loadOrderForMutation(request, order_id)
    if (ctx.error) return ctx.error
    const { authContext, supabase, order } = ctx

    // Validate patch input
    const validation = validatePatchOrderInput(body)
    if ("error" in validation) return validation.error
    const updatePayload = validation.payload

    const { data: updated, error: updateError } = await supabase
      .from("orders")
      .update(updatePayload)
      .eq("id", order_id)
      .eq("store_uuid", authContext.store_uuid)
      .select("id, session_id, item_name, order_type, qty, unit_price")
      .single()

    if (updateError || !updated) {
      return NextResponse.json({ error: "UPDATE_FAILED", message: updateError?.message || "Failed to update order." }, { status: 500 })
    }

    // 2026-05-03 R-Speed-x10: orders 캐시 무효화 (정확한 key) + audit background.
    invalidateCache("session_orders", `${authContext.store_uuid}:${order.session_id}`)

    void writeSessionAudit(supabase, {
      auth: authContext,
      session_id: order.session_id,
      entity_table: "orders",
      entity_id: order_id,
      action: "order_updated",
      before: { item_name: order.item_name, order_type: order.order_type, qty: order.qty, unit_price: order.unit_price },
      after: updatePayload,
    }).catch((e) => console.warn("[orders PATCH] audit failed:", e))

    return NextResponse.json({
      order_id: updated.id,
      session_id: updated.session_id,
      item_name: updated.item_name,
      order_type: updated.order_type,
      qty: updated.qty,
      unit_price: updated.unit_price,
      amount: updated.qty * updated.unit_price,
    })
  } catch (error) {
    return handleRouteError(error, "orders/[order_id]")
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ order_id: string }> }
) {
  try {
    const { order_id } = await params

    const ctx = await loadOrderForMutation(request, order_id)
    if (ctx.error) return ctx.error
    const { authContext, supabase, order } = ctx

    // Detect inventory link before mutation
    const { data: orderInv } = await supabase
      .from("orders")
      .select("inventory_item_id")
      .eq("id", order_id)
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .maybeSingle()
    const inventoryItemId: string | null = orderInv?.inventory_item_id ?? null

    // Soft delete
    const { error: deleteError } = await supabase
      .from("orders")
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", order_id)
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)

    if (deleteError) {
      return NextResponse.json({ error: "DELETE_FAILED", message: deleteError.message || "Failed to delete order." }, { status: 500 })
    }

    // Inventory stock restore (non-blocking, best-effort)
    let stockRestored: { before: number; after: number } | null = null
    if (inventoryItemId) {
      stockRestored = await restoreStock(supabase, {
        inventory_item_id: inventoryItemId,
        store_uuid: authContext.store_uuid,
        qty: order.qty ?? 0,
        order_id,
        session_id: order.session_id,
        membership_id: authContext.membership_id,
      })
    }

    // 2026-05-03 R-Speed-x10: orders 캐시 무효화 (정확한 key) + audit background.
    invalidateCache("session_orders", `${authContext.store_uuid}:${order.session_id}`)

    void writeSessionAudit(supabase, {
      auth: authContext,
      session_id: order.session_id,
      entity_table: "orders",
      entity_id: order_id,
      action: "order_deleted",
      before: { item_name: order.item_name, order_type: order.order_type, qty: order.qty, unit_price: order.unit_price },
      after: {
        inventory_item_id: inventoryItemId,
        stock_before: stockRestored?.before ?? null,
        stock_after: stockRestored?.after ?? null,
      },
    }).catch((e) => console.warn("[orders DELETE] audit failed:", e))

    return NextResponse.json({
      deleted: true,
      order_id,
      inventory_item_id: inventoryItemId,
      stock_restored: stockRestored,
    })
  } catch (error) {
    return handleRouteError(error, "orders/[order_id]")
  }
}
