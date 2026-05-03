import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { isValidUUID } from "@/lib/validation"
import { resolveCart } from "@/lib/cafe/services/cartLogic"
import type { CafeOrderCreateInput } from "@/lib/cafe/types"

/**
 * GET /api/cafe/orders/my — 내가 보낸 주문 (customer 본인 시점).
 * POST /api/cafe/orders — 신규 주문 (인증된 누구나, 본인이 customer).
 *
 * 룸 배달 시 (delivery_room_uuid + delivery_session_id):
 *   서버가 그 세션이 정말 active 인지 + auth.store_uuid 와 일치하는지 검증.
 *   호스티스가 다른 매장 (cross-store) 에서 일하는 경우 session.store_uuid 와
 *   auth.store_uuid 가 다를 수 있음 — 이 경우 customer_store_uuid = session.store_uuid
 *   (working store) 로 기록 (배달은 일하는 매장으로).
 */

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const svc = createServiceClient()
    if (svc.error) return svc.error
    const { data, error } = await svc.supabase
      .from("cafe_orders")
      .select("id, cafe_store_uuid, items, subtotal_amount, payment_method, status, delivery_room_uuid, delivery_text, paid_at, delivered_at, created_at")
      .eq("customer_membership_id", auth.membership_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50)
    if (error) return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    return NextResponse.json({ orders: data ?? [] })
  } catch (e) {
    return handleRouteError(e, "cafe/orders GET my")
  }
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const parsed = await parseJsonBody<CafeOrderCreateInput>(request)
    if (parsed.error) return parsed.error
    const b = parsed.body

    if (!b.cafe_store_uuid || !isValidUUID(b.cafe_store_uuid)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "cafe_store_uuid required" }, { status: 400 })
    }
    if (!b.payment_method || !["account", "card_on_delivery"].includes(b.payment_method)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "payment_method required" }, { status: 400 })
    }
    // 배달 위치 — 룸 OR 자유텍스트
    const isRoomDelivery = !!(b.delivery_room_uuid && b.delivery_session_id)
    if (!isRoomDelivery && (!b.delivery_text || b.delivery_text.trim().length < 2)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "delivery 위치 필요" }, { status: 400 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 카페 매장 검증 (floor=3)
    const { data: cafeStore } = await supabase
      .from("stores").select("id, floor").eq("id", b.cafe_store_uuid).maybeSingle()
    if (!cafeStore || cafeStore.floor !== 3) {
      return NextResponse.json({ error: "INVALID_CAFE", message: "카페 매장이 아닙니다" }, { status: 400 })
    }

    // 룸 배달 시 세션 검증 + customer_store_uuid 결정
    let customer_store_uuid = auth.store_uuid
    if (isRoomDelivery) {
      const { data: session } = await supabase
        .from("room_sessions")
        .select("id, store_uuid, room_uuid, status")
        .eq("id", b.delivery_session_id!)
        .maybeSingle()
      if (!session || session.status !== "active") {
        return NextResponse.json({ error: "SESSION_NOT_ACTIVE" }, { status: 400 })
      }
      if (session.room_uuid !== b.delivery_room_uuid) {
        return NextResponse.json({ error: "ROOM_SESSION_MISMATCH" }, { status: 400 })
      }
      // 호스티스가 자기 매장이 아닌 곳 (cross-store) 에서 일할 수 있음 →
      //   customer_store_uuid = 그 working store
      customer_store_uuid = session.store_uuid
    }

    // 장바구니 정규화 (가격 SSOT = DB)
    const cart = await resolveCart(supabase, b.cafe_store_uuid, b.items)
    if (!cart.ok) {
      return NextResponse.json({ error: "INVALID_CART", message: cart.error }, { status: 400 })
    }

    const { data: order, error } = await supabase
      .from("cafe_orders")
      .insert({
        cafe_store_uuid: b.cafe_store_uuid,
        customer_store_uuid,
        customer_membership_id: auth.membership_id,
        delivery_room_uuid: isRoomDelivery ? b.delivery_room_uuid : null,
        delivery_session_id: isRoomDelivery ? b.delivery_session_id : null,
        delivery_text: isRoomDelivery ? null : b.delivery_text!.trim(),
        items: cart.data.items,
        subtotal_amount: cart.data.subtotal,
        payment_method: b.payment_method,
        status: "pending",
        notes: b.notes?.trim() || null,
      })
      .select("id, status, subtotal_amount, payment_method")
      .single()
    if (error) return NextResponse.json({ error: "ORDER_FAILED", message: error.message }, { status: 500 })

    // 계좌 입금 결제일 때 카페 계좌번호 함께 반환 (UI 가 표시)
    let account = null
    if (b.payment_method === "account") {
      const { data: a } = await supabase
        .from("cafe_account_info")
        .select("bank_name, account_number, account_holder")
        .eq("store_uuid", b.cafe_store_uuid)
        .eq("is_active", true)
        .maybeSingle()
      account = a
    }

    return NextResponse.json({ order, account }, { status: 201 })
  } catch (e) {
    return handleRouteError(e, "cafe/orders POST")
  }
}
