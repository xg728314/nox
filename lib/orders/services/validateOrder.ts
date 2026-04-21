import { NextResponse } from "next/server"
import type { CreateOrderInput, PatchOrderInput } from "@/lib/orders/types"

/**
 * Validates required fields for order creation.
 * Returns a NextResponse error if validation fails, null if valid.
 *
 * Extracts the repeated field validation from orders/route.ts POST handler.
 */
export function validateCreateOrderInput(
  input: Partial<CreateOrderInput>
): NextResponse | null {
  if (!input.session_id) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "session_id is required." },
      { status: 400 }
    )
  }
  if (!input.item_name) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "item_name is required." },
      { status: 400 }
    )
  }
  if (!input.order_type) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "order_type is required." },
      { status: 400 }
    )
  }
  if (input.qty === undefined || input.qty === null || typeof input.qty !== "number" || input.qty <= 0) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "qty is required and must be a positive number." },
      { status: 400 }
    )
  }
  if (input.unit_price === undefined || input.unit_price === null || typeof input.unit_price !== "number" || input.unit_price < 0 || input.unit_price > 9999999) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "unit_price is required and must be 0~9,999,999." },
      { status: 400 }
    )
  }
  return null
}

/**
 * Validates fields for order update (PATCH).
 * Returns a NextResponse error if validation fails, null if valid.
 * Also returns the validated update payload.
 *
 * Extracts the repeated field validation from orders/[order_id]/route.ts PATCH handler.
 */
export function validatePatchOrderInput(
  body: PatchOrderInput
): { error: NextResponse } | { payload: Record<string, number | string> } {
  const updatePayload: Record<string, number | string> = { updated_at: new Date().toISOString() }

  if (body.item_name !== undefined) {
    if (typeof body.item_name !== "string" || !body.item_name.trim()) {
      return { error: NextResponse.json({ error: "BAD_REQUEST", message: "item_name must be a non-empty string." }, { status: 400 }) }
    }
    updatePayload.item_name = body.item_name.trim()
  }
  if (body.order_type !== undefined) {
    if (typeof body.order_type !== "string" || !body.order_type.trim()) {
      return { error: NextResponse.json({ error: "BAD_REQUEST", message: "order_type must be a non-empty string." }, { status: 400 }) }
    }
    updatePayload.order_type = body.order_type.trim()
  }
  if (body.qty !== undefined) {
    if (typeof body.qty !== "number" || body.qty <= 0) {
      return { error: NextResponse.json({ error: "BAD_REQUEST", message: "qty must be a positive number." }, { status: 400 }) }
    }
    updatePayload.qty = body.qty
  }
  if (body.unit_price !== undefined) {
    if (typeof body.unit_price !== "number" || body.unit_price < 0 || body.unit_price > 9999999) {
      return { error: NextResponse.json({ error: "BAD_REQUEST", message: "unit_price must be 0~9,999,999." }, { status: 400 }) }
    }
    updatePayload.unit_price = body.unit_price
  }

  if (Object.keys(updatePayload).length === 1) {
    return { error: NextResponse.json({ error: "BAD_REQUEST", message: "At least one field is required." }, { status: 400 }) }
  }

  return { payload: updatePayload }
}

/**
 * Validates sale_price >= store_price.
 * Returns a NextResponse error if validation fails, null if valid.
 */
export function validatePriceGuard(
  resolvedSalePrice: number,
  resolvedStorePrice: number
): NextResponse | null {
  if (resolvedSalePrice < resolvedStorePrice) {
    return NextResponse.json(
      { error: "PRICE_VALIDATION_FAILED", message: `판매가(${resolvedSalePrice})가 입금가(${resolvedStorePrice})보다 낮습니다.` },
      { status: 400 }
    )
  }
  return null
}
