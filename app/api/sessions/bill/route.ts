import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { isValidUUID } from "@/lib/validation"
import { archivedAtFilter } from "@/lib/session/archivedFilter"

/**
 * GET /api/sessions/bill?session_id=xxx
 * 손님 청구서 — 내부 정산(실장수익/스태프지급액) 비노출.
 * 구성: 양주(실장판매가) + 스태프타임 + 웨이터팁 + 카드수수료
 */
export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role === "hostess") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get("session_id")
    if (!sessionId || !isValidUUID(sessionId)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "session_id is required." }, { status: 400 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 1. 세션 확인
    // 2026-04-25: archived_at 필터 — archive 된 세션은 일반 bill 엔드포인트
    //   에서 노출 안 함 (migration 085 미적용 DB 에서는 no-op).
    const applyArchivedNull = await archivedAtFilter(supabase)
    const { data: session } = await applyArchivedNull(
      supabase
        .from("room_sessions")
        .select("id, store_uuid, room_uuid, started_at, ended_at, status")
        .eq("id", sessionId)
        .eq("store_uuid", authContext.store_uuid)
    ).maybeSingle()

    if (!session) {
      return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 })
    }

    // 2. 방 이름
    const { data: room } = await supabase
      .from("rooms").select("name").eq("id", session.room_uuid).eq("store_uuid", authContext.store_uuid).is("deleted_at", null).maybeSingle()

    // 3. 주문 목록 — order_type별 분류
    const { data: orders } = await supabase
      .from("orders")
      .select("id, item_name, order_type, qty, unit_price, sale_price, customer_amount")
      .eq("session_id", sessionId)
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })

    // 양주(주류) / 웨이터팁 / 기타 분류
    const liquorItems: { name: string; qty: number; unit_price: number; amount: number }[] = []
    const otherItems: { name: string; qty: number; unit_price: number; amount: number }[] = []
    let waiterTipTotal = 0

    for (const o of orders ?? []) {
      const amount = o.customer_amount ?? (o.qty * o.unit_price)
      const orderType = (o.order_type || "").toLowerCase()

      if (orderType === "waiter_tip" || orderType === "웨이터팁") {
        waiterTipTotal += amount
      } else if (orderType === "purchase" || orderType === "사입") {
        // 사입은 손님 청구서에 포함하지 않음 (매장 내부 비용)
      } else {
        // 양주 및 기타 주문
        const item = { name: o.item_name || "주류", qty: o.qty, unit_price: o.unit_price, amount }
        if (["주류", "양주", "liquor"].includes(orderType) || !orderType || orderType === "general") {
          liquorItems.push(item)
        } else {
          otherItems.push(item)
        }
      }
    }

    const liquorTotal = liquorItems.reduce((s, i) => s + i.amount, 0)
    const otherTotal = otherItems.reduce((s, i) => s + i.amount, 0)

    // 4. 스태프타임 — 참여자 price_amount 합계 (건수 + 총액만 노출, 개별 지급액 비노출)
    const { data: participants } = await supabase
      .from("session_participants")
      .select("id, category, time_minutes, price_amount")
      .eq("session_id", sessionId)
      .eq("store_uuid", authContext.store_uuid)
      .eq("role", "hostess")
      .is("deleted_at", null)

    const timeEntries = (participants ?? []).map((p: {
      id: string; category: string; time_minutes: number; price_amount: number
    }) => ({
      category: p.category,
      time_minutes: p.time_minutes,
      amount: p.price_amount,
    }))

    const timeTotal = timeEntries.reduce((s: number, e: { amount: number }) => s + e.amount, 0)
    const timeCount = timeEntries.length

    // 5. 카드수수료 (결제 정보가 있는 경우)
    const { data: receipt } = await supabase
      .from("receipts")
      .select("payment_method, card_amount, card_fee_rate, card_fee_amount, manager_card_margin, gross_total")
      .eq("session_id", sessionId)
      .eq("store_uuid", authContext.store_uuid)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle()

    const cardFeeAmount = receipt?.card_fee_amount ?? 0
    const managerCardMargin = receipt?.manager_card_margin ?? 0

    // 6. 합계
    const subtotal = liquorTotal + otherTotal + timeTotal + waiterTipTotal
    const cardSurcharge = cardFeeAmount + managerCardMargin
    const grandTotal = subtotal + cardSurcharge

    return NextResponse.json({
      session_id: sessionId,
      room_name: room?.name || null,
      session_status: session.status,
      started_at: session.started_at,
      ended_at: session.ended_at,

      // 청구서 항목
      liquor: {
        items: liquorItems,
        total: liquorTotal,
      },
      time: {
        entries: timeEntries,
        count: timeCount,
        total: timeTotal,
      },
      waiter_tip: waiterTipTotal,
      other: {
        items: otherItems,
        total: otherTotal,
      },

      // 카드 관련
      card_surcharge: cardSurcharge > 0 ? {
        card_fee: cardFeeAmount,
        manager_margin: managerCardMargin,
        total: cardSurcharge,
      } : null,

      payment_method: receipt?.payment_method || null,

      // 합계
      subtotal,
      grand_total: grandTotal,
    })
  } catch (error) {
    return handleRouteError(error, "bill")
  }
}
