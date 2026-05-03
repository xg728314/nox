import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { isValidUUID } from "@/lib/validation"

/**
 * GET /api/cafe/reviews?menu_id=X — 메뉴 리뷰 list (인증 누구나).
 * POST /api/cafe/reviews — 리뷰 작성. delivered 주문만 인정.
 *   body: { order_id, menu_id, rating(1-5), text }
 */

export async function GET(request: Request) {
  try {
    await resolveAuthContext(request)
    const url = new URL(request.url)
    const menuId = url.searchParams.get("menu_id")
    const storeId = url.searchParams.get("store_uuid")
    if (!menuId && !storeId) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "menu_id or store_uuid required" }, { status: 400 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error

    let q = svc.supabase
      .from("cafe_reviews")
      .select("id, store_uuid, menu_id, rating, text, created_at, customer_membership_id")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50)
    if (menuId) q = q.eq("menu_id", menuId)
    if (storeId) q = q.eq("store_uuid", storeId)
    const { data, error } = await q
    if (error) return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    return NextResponse.json({ reviews: data ?? [] })
  } catch (e) {
    return handleRouteError(e, "cafe/reviews GET")
  }
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const parsed = await parseJsonBody<{
      order_id?: string; menu_id?: string; rating?: number; text?: string | null;
    }>(request)
    if (parsed.error) return parsed.error
    const b = parsed.body
    if (!b.order_id || !isValidUUID(b.order_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "order_id required" }, { status: 400 })
    }
    if (!b.menu_id || !isValidUUID(b.menu_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "menu_id required" }, { status: 400 })
    }
    if (typeof b.rating !== "number" || b.rating < 1 || b.rating > 5) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "rating must be 1~5" }, { status: 400 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 주문이 delivered + customer 가 본인 + items 에 menu_id 포함
    const { data: order } = await supabase
      .from("cafe_orders")
      .select("id, status, customer_membership_id, items, cafe_store_uuid")
      .eq("id", b.order_id)
      .is("deleted_at", null)
      .maybeSingle()
    if (!order) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    if (order.status !== "delivered") {
      return NextResponse.json({ error: "NOT_DELIVERED" }, { status: 400 })
    }
    if (order.customer_membership_id !== auth.membership_id) {
      return NextResponse.json({ error: "NOT_YOUR_ORDER" }, { status: 403 })
    }
    const items = (order.items as Array<{ menu_id: string }>) ?? []
    if (!items.some((it) => it.menu_id === b.menu_id)) {
      return NextResponse.json({ error: "MENU_NOT_IN_ORDER" }, { status: 400 })
    }

    const { data: review, error } = await supabase
      .from("cafe_reviews")
      .insert({
        store_uuid: order.cafe_store_uuid,
        menu_id: b.menu_id,
        customer_membership_id: auth.membership_id,
        order_id: b.order_id,
        rating: b.rating,
        text: b.text?.trim() || null,
      })
      .select("id, rating, text, created_at")
      .single()
    if (error) {
      if (error.message.includes("uq_cafe_reviews_one_per_order_menu")) {
        return NextResponse.json({ error: "ALREADY_REVIEWED" }, { status: 409 })
      }
      return NextResponse.json({ error: "INSERT_FAILED", message: error.message }, { status: 500 })
    }
    return NextResponse.json({ review }, { status: 201 })
  } catch (e) {
    return handleRouteError(e, "cafe/reviews POST")
  }
}
