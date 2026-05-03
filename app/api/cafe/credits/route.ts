import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { isValidUUID } from "@/lib/validation"

/**
 * GET  /api/cafe/credits?unpaid_only=1 — 외상 list (카페 staff 시점).
 * POST /api/cafe/credits — 주문을 외상으로 전환.
 *   body: { order_id, customer_name?, customer_phone?, memo? }
 */

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (!["owner","manager","staff"].includes(auth.role)) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const url = new URL(request.url)
    const unpaidOnly = url.searchParams.get("unpaid_only") === "1"
    const svc = createServiceClient()
    if (svc.error) return svc.error

    let q = svc.supabase
      .from("cafe_order_credits")
      .select(`
        id, order_id, amount, customer_name, customer_phone, memo,
        credited_at, paid_at, paid_method, paid_notes
      `)
      .eq("store_uuid", auth.store_uuid)
      .order("credited_at", { ascending: false })
      .limit(200)
    if (unpaidOnly) q = q.is("paid_at", null)
    const { data, error } = await q
    if (error) return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })

    // enrich: order items / delivery
    const credits = (data ?? []) as Array<{ id: string; order_id: string }>
    if (credits.length === 0) return NextResponse.json({ credits: [] })
    const orderIds = credits.map((c) => c.order_id)
    const { data: orders } = await svc.supabase
      .from("cafe_orders")
      .select("id, items, delivery_room_uuid, delivery_text, customer_store_uuid, customer_membership_id, created_at")
      .in("id", orderIds)
    const orderMap = new Map<string, { items: unknown; delivery_room_uuid: string | null; delivery_text: string | null; customer_store_uuid: string; customer_membership_id: string; created_at: string }>()
    for (const o of (orders ?? []) as Array<{ id: string; items: unknown; delivery_room_uuid: string | null; delivery_text: string | null; customer_store_uuid: string; customer_membership_id: string; created_at: string }>) {
      orderMap.set(o.id, o)
    }

    return NextResponse.json({
      credits: credits.map((c) => ({
        ...c,
        order: orderMap.get(c.order_id) ?? null,
      })),
    })
  } catch (e) {
    return handleRouteError(e, "cafe/credits GET")
  }
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (!["owner","manager","staff"].includes(auth.role)) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const parsed = await parseJsonBody<{
      order_id?: string
      customer_name?: string | null
      customer_phone?: string | null
      memo?: string | null
    }>(request)
    if (parsed.error) return parsed.error
    const b = parsed.body
    if (!b.order_id || !isValidUUID(b.order_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "order_id required" }, { status: 400 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 주문 검증 — 카페 매장 + delivered 상태만 외상 전환 허용
    const { data: order } = await supabase
      .from("cafe_orders")
      .select("id, cafe_store_uuid, status, subtotal_amount, customer_membership_id")
      .eq("id", b.order_id)
      .is("deleted_at", null)
      .maybeSingle()
    if (!order) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    if (order.cafe_store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }
    if (order.status !== "delivered") {
      return NextResponse.json({ error: "MUST_BE_DELIVERED", message: "배달 완료된 주문만 외상 전환 가능" }, { status: 400 })
    }

    // customer_member_id 자동 link (loyalty_members 에 phone 있으면)
    let customerMemberId: string | null = null
    if (b.customer_phone?.trim()) {
      const { data: mem } = await supabase
        .from("cafe_loyalty_members")
        .select("id")
        .eq("store_uuid", auth.store_uuid)
        .eq("phone", b.customer_phone.trim())
        .is("deleted_at", null)
        .maybeSingle()
      if (mem) customerMemberId = mem.id
    }

    const { data: credit, error } = await supabase
      .from("cafe_order_credits")
      .insert({
        store_uuid: auth.store_uuid,
        order_id: order.id,
        amount: order.subtotal_amount,
        customer_name: b.customer_name?.trim() || null,
        customer_phone: b.customer_phone?.trim() || null,
        customer_member_id: customerMemberId,
        memo: b.memo?.trim() || null,
        credited_by: auth.membership_id,
      })
      .select("id, amount, customer_name, customer_phone, credited_at")
      .single()
    if (error) {
      if (error.message.includes("cafe_order_credits_order_id_key") || error.message.includes("duplicate")) {
        return NextResponse.json({ error: "ALREADY_CREDITED" }, { status: 409 })
      }
      return NextResponse.json({ error: "INSERT_FAILED", message: error.message }, { status: 500 })
    }

    // order.status 도 'credited' 로 전환
    await supabase.from("cafe_orders").update({ status: "credited" }).eq("id", order.id)

    return NextResponse.json({ credit }, { status: 201 })
  } catch (e) {
    return handleRouteError(e, "cafe/credits POST")
  }
}
