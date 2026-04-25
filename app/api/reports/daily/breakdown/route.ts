import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * GET /api/reports/daily/breakdown?business_day_id=...
 *
 * 2026-04-25: "총 매출" 클릭 시 방별 / 주문 타입별 세부 내역 drill-down.
 *
 * 응답:
 *   {
 *     business_date,
 *     rooms: [
 *       {
 *         room_uuid, room_name, session_id, started_at, ended_at,
 *         customer_name,
 *         time_total,         // 스태프 타임 합 (개별 지급액은 노출 안 함)
 *         order_total,        // 주문 합
 *         order_breakdown: {
 *           liquor: { count, amount },
 *           tip:    { count, amount },
 *           room_ti:{ count, amount },
 *           purchase:{ count, amount },
 *           other:  { count, amount },
 *         },
 *         gross_total,
 *       }
 *     ],
 *     type_totals: {
 *       time_total, liquor_total, tip_total, room_ti_total, purchase_total, other_total, gross_total
 *     }
 *   }
 *
 * owner 권한 준수: 스태프/실장 개별 지급액은 응답에 포함 안 함.
 */
export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "권한이 없습니다." },
        { status: 403 },
      )
    }

    const url = new URL(request.url)
    const businessDayId = url.searchParams.get("business_day_id")
    if (!businessDayId) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "business_day_id 필수." },
        { status: 400 },
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. 영업일 유효성 확인
    const { data: opDay } = await supabase
      .from("store_operating_days")
      .select("id, business_date")
      .eq("id", businessDayId)
      .eq("store_uuid", auth.store_uuid)
      .maybeSingle()
    if (!opDay) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "영업일을 찾을 수 없습니다." },
        { status: 404 },
      )
    }

    // 2. 해당 영업일의 세션 + 룸
    const { data: sessions } = await supabase
      .from("room_sessions")
      .select("id, room_uuid, started_at, ended_at, customer_name_snapshot, status")
      .eq("store_uuid", auth.store_uuid)
      .eq("business_day_id", businessDayId)

    const sessionList = sessions ?? []
    const sessionIds = sessionList.map(s => s.id)
    const roomIds = [...new Set(sessionList.map(s => s.room_uuid))]

    const { data: rooms } = roomIds.length > 0
      ? await supabase.from("rooms").select("id, room_no, room_name").in("id", roomIds)
      : { data: [] }
    const roomMap = new Map((rooms ?? []).map(r => [r.id, r]))

    // 3. 참여자 (타임 매출) — 개별 지급액 없이 price_amount 합만
    const partMap = new Map<string, number>()
    if (sessionIds.length > 0) {
      const { data: parts } = await supabase
        .from("session_participants")
        .select("session_id, price_amount")
        .in("session_id", sessionIds)
        .eq("store_uuid", auth.store_uuid)
      for (const p of parts ?? []) {
        partMap.set(p.session_id, (partMap.get(p.session_id) ?? 0) + Number(p.price_amount ?? 0))
      }
    }

    // 4. 주문 — 타입별 분리
    type OrderBucket = { count: number; amount: number }
    type RoomOrders = {
      liquor: OrderBucket
      tip: OrderBucket
      room_ti: OrderBucket
      purchase: OrderBucket
      other: OrderBucket
    }
    const emptyOrders = (): RoomOrders => ({
      liquor: { count: 0, amount: 0 },
      tip: { count: 0, amount: 0 },
      room_ti: { count: 0, amount: 0 },
      purchase: { count: 0, amount: 0 },
      other: { count: 0, amount: 0 },
    })
    const ordersByRoom = new Map<string, RoomOrders>()

    if (sessionIds.length > 0) {
      const { data: orders } = await supabase
        .from("orders")
        .select("session_id, order_type, item_name, qty, customer_amount")
        .in("session_id", sessionIds)
        .eq("store_uuid", auth.store_uuid)
      for (const o of orders ?? []) {
        const bucket = ordersByRoom.get(o.session_id) ?? emptyOrders()
        const amt = Number(o.customer_amount ?? 0)
        const qty = Number(o.qty ?? 1)
        const t = o.order_type
        const target =
          t === "주류"  ? bucket.liquor :
          t === "팁"    ? bucket.tip :
          t === "룸티"  ? bucket.room_ti :
          t === "사입"  ? bucket.purchase :
                          bucket.other
        target.count += qty
        target.amount += amt
        ordersByRoom.set(o.session_id, bucket)
      }
    }

    // 5. 방별 종합 + 타입별 총계
    const typeTotals = {
      time_total: 0,
      liquor_total: 0,
      tip_total: 0,
      room_ti_total: 0,
      purchase_total: 0,
      other_total: 0,
      gross_total: 0,
    }
    const roomsOut = sessionList.map(s => {
      const room = roomMap.get(s.room_uuid)
      const timeTotal = partMap.get(s.id) ?? 0
      const ob = ordersByRoom.get(s.id) ?? emptyOrders()
      const orderTotal =
        ob.liquor.amount + ob.tip.amount + ob.room_ti.amount +
        ob.purchase.amount + ob.other.amount
      const grossTotal = timeTotal + orderTotal

      typeTotals.time_total += timeTotal
      typeTotals.liquor_total += ob.liquor.amount
      typeTotals.tip_total += ob.tip.amount
      typeTotals.room_ti_total += ob.room_ti.amount
      typeTotals.purchase_total += ob.purchase.amount
      typeTotals.other_total += ob.other.amount
      typeTotals.gross_total += grossTotal

      return {
        room_uuid: s.room_uuid,
        room_name: room?.room_name ?? room?.room_no ?? "-",
        session_id: s.id,
        started_at: s.started_at,
        ended_at: s.ended_at,
        customer_name: s.customer_name_snapshot ?? null,
        status: s.status,
        time_total: timeTotal,
        order_total: orderTotal,
        order_breakdown: ob,
        gross_total: grossTotal,
      }
    })

    // 시작 시각 오름차순
    roomsOut.sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())

    return NextResponse.json({
      business_date: opDay.business_date,
      rooms: roomsOut,
      type_totals: typeTotals,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "예상치 못한 오류." }, { status: 500 })
  }
}
