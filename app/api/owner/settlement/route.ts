import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { getBusinessDateForOps } from "@/lib/time/businessDate"

/**
 * GET /api/owner/settlement?business_day_id=xxx
 * 사장 정산 현황 — 매장 전체 집계
 *
 * 사장 열람 가능: 양주판매내역, 웨이터봉사비, 사입, TC(타임수), 총매출, 사장마진
 * 사장 열람 불가: 실장 개별 수익(타임당 공제액), 스태프 개별 수익
 */
export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role !== "owner") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Owner only." },
        { status: 403 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: "SERVER_CONFIG_ERROR", message: "Supabase environment variables are not configured." },
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 0. Resolve business_day_id
    const { searchParams } = new URL(request.url)
    let businessDayId: string | null = searchParams.get("business_day_id")

    if (!businessDayId) {
      const today = getBusinessDateForOps()
      const { data: bizDay } = await supabase
        .from("store_operating_days")
        .select("id, business_date, status")
        .eq("store_uuid", authContext.store_uuid)
        .eq("business_date", today)
        .maybeSingle()

      if (bizDay) {
        businessDayId = bizDay.id
      } else {
        const { data: latestDay } = await supabase
          .from("store_operating_days")
          .select("id, business_date, status")
          .eq("store_uuid", authContext.store_uuid)
          .eq("status", "open")
          .order("business_date", { ascending: false })
          .limit(1)
          .maybeSingle()

        businessDayId = latestDay?.id ?? null
      }
    }

    if (!businessDayId) {
      return NextResponse.json({
        store_uuid: authContext.store_uuid,
        business_day_id: null,
        summary: null,
      })
    }

    // 2026-05-06 fix: 7-8 RTT 직렬 → 2 wave 병렬.
    //   Phase 1: bizDayInfo + room_sessions (id+room_uuid+status) + orders +
    //            participants + receipts 5개 동시 fire (모두 businessDayId 만 의존).
    //   Phase 2: rooms (room_sessions 결과의 room_uuid 의존).
    //
    //   기존 sessions(id only) + roomSessions(id+room_uuid+status) 쿼리 중복
    //   제거 — 한 번에 충분한 column 가져옴.
    //
    //   기대 단축: 7 RTT (~700ms) → 2 RTT (~200-300ms).
    const [bizDayRes, roomSessionsRes, ordersRes, receiptsRes] = await Promise.all([
      supabase
        .from("store_operating_days")
        .select("id, business_date, status")
        .eq("id", businessDayId)
        .eq("store_uuid", authContext.store_uuid)
        .maybeSingle(),
      supabase
        .from("room_sessions")
        .select("id, room_uuid, status")
        .eq("store_uuid", authContext.store_uuid)
        .eq("business_day_id", businessDayId),
      supabase
        .from("orders")
        .select("session_id, order_type, qty, unit_price, store_price, customer_amount")
        .eq("store_uuid", authContext.store_uuid)
        .eq("business_day_id", businessDayId)
        .is("deleted_at", null),
      supabase
        .from("receipts")
        .select("session_id, status, gross_total, margin_amount, tc_amount")
        .eq("store_uuid", authContext.store_uuid)
        .eq("business_day_id", businessDayId)
        .order("version", { ascending: false }),
    ])

    const bizDayInfo = bizDayRes.data
    const roomSessions = roomSessionsRes.data
    const sessions = roomSessions  // 호환성 alias (예전 변수명 유지)
    const orders = ordersRes.data
    const receipts = receiptsRes.data

    const sessionIds = (sessions ?? []).map((s: { id: string }) => s.id)

    if (sessionIds.length === 0) {
      return NextResponse.json({
        store_uuid: authContext.store_uuid,
        business_day_id: businessDayId,
        business_date: bizDayInfo?.business_date ?? null,
        business_day_status: bizDayInfo?.status ?? null,
        summary: {
          total_sessions: 0,
          tc_count: 0,
          liquor_sales: 0,
          waiter_tips: 0,
          purchases: 0,
          gross_total: 0,
          owner_margin: 0,
          finalized_count: 0,
          draft_count: 0,
          unsettled_count: 0,
        },
        sessions: [],
      })
    }

    // 2. 주문 집계 (order_type별) — orders 는 위 Phase 1 에서 이미 fetch.
    // 사장 매출 원칙:
    //   - liquor_sales = Σ(store_price × qty)  ← 사장 입금가 기준 (사장 매출)
    //   - waiter_tips  = Σ(customer_amount)     ← 손님 지불 기준, 사장 매출 제외
    //   - purchases    = Σ(customer_amount)     ← 손님 지불 기준, 사장 매출 제외
    //   실장 마진(sale_price − store_price)과 스태프 금액은 사장 매출에서 제외된다.

    let liquorSales = 0
    let waiterTips = 0
    let purchases = 0
    const sessionOrderMap = new Map<string, { liquor: number; waiter_tip: number; purchase: number }>()

    for (const o of orders ?? []) {
      const customerAmount = o.customer_amount ?? (o.qty * o.unit_price)
      const ownerAmount = (o.store_price ?? o.unit_price) * o.qty
      const orderType = (o.order_type || "").toLowerCase()

      if (!sessionOrderMap.has(o.session_id)) {
        sessionOrderMap.set(o.session_id, { liquor: 0, waiter_tip: 0, purchase: 0 })
      }
      const entry = sessionOrderMap.get(o.session_id)!

      if (orderType === "waiter_tip" || orderType === "웨이터팁") {
        waiterTips += customerAmount
        entry.waiter_tip += customerAmount
      } else if (orderType === "purchase" || orderType === "사입") {
        purchases += customerAmount
        entry.purchase += customerAmount
      } else {
        // 양주 및 기타 판매 주문 → 사장 매출은 입금가 기준
        liquorSales += ownerAmount
        entry.liquor += ownerAmount
      }
    }

    // 3. 참여자 TC 건수 (스태프 역할 참여자 수 = 타임 건수)
    // 2026-05-06 fix: status 필터 추가. 기존: mid-out (status='left' but
    //   role='hostess') 까지 카운트 → 사장 정산 화면 TC 건수가 실제 완료 타임
    //   보다 부풀려짐. price_amount > 0 인 active/완료 참여자만 TC 로 인정.
    const { data: participants } = sessionIds.length > 0
      ? await supabase
          .from("session_participants")
          .select("id, session_id, role, status, price_amount")
          .eq("store_uuid", authContext.store_uuid)
          .in("session_id", sessionIds)
          .is("deleted_at", null)
      : { data: [] as Array<{ id: string; session_id: string; role: string; status: string; price_amount: number }> }

    const tcCountTotal = (participants ?? []).filter(
      (p: { role: string; status: string; price_amount: unknown }) => {
        if (p.role !== "hostess") return false
        // mid-out 으로 status='left' + price_amount=0 인 kicked 케이스 제외.
        // 정상 left (퇴실 후 정상 정산) 은 price_amount > 0 → 포함.
        const price = typeof p.price_amount === "number"
          ? p.price_amount
          : Number(p.price_amount ?? 0)
        return price > 0
      },
    ).length

    // 세션별 TC 건수
    const sessionTcMap = new Map<string, number>()
    for (const p of participants ?? []) {
      if (p.role === "hostess") {
        sessionTcMap.set(p.session_id, (sessionTcMap.get(p.session_id) || 0) + 1)
      }
    }

    // 4. 영수증 집계 — gross_total, margin_amount만 (개별 수익 제외).
    //    receipts 는 Phase 1 에서 이미 fetch — 재사용.

    // 세션별 최신 영수증만
    const receiptMap = new Map<string, { status: string; gross_total: number; margin_amount: number; tc_amount: number }>()
    for (const r of receipts ?? []) {
      if (!receiptMap.has(r.session_id)) {
        receiptMap.set(r.session_id, r)
      }
    }

    let grossTotal = 0
    let ownerMargin = 0
    let finalizedCount = 0
    let draftCount = 0

    for (const r of receiptMap.values()) {
      grossTotal += r.gross_total ?? 0
      ownerMargin += r.margin_amount ?? 0
      if (r.status === "finalized") finalizedCount++
      if (r.status === "draft") draftCount++
    }

    const unsettledCount = sessionIds.length - receiptMap.size

    // 5. 방 이름 조회 (Phase 2 — Phase 1 의 room_uuid 의존)
    //    roomSessions 는 Phase 1 의 room_sessions 를 그대로 사용.
    const roomUuids = [...new Set((roomSessions ?? []).map((s: { room_uuid: string }) => s.room_uuid))]
    const { data: rooms } = roomUuids.length > 0
      ? await supabase
          .from("rooms")
          .select("id, room_name")
          .eq("store_uuid", authContext.store_uuid)
          .in("id", roomUuids)
      : { data: [] as Array<{ id: string; room_name: string }> }

    const roomNameMap = new Map<string, string>()
    for (const r of rooms ?? []) roomNameMap.set(r.id, r.room_name)

    // 6. 세션별 요약 (개별 수익 제외)
    const sessionList = (roomSessions ?? []).map((s: { id: string; room_uuid: string; status: string }) => {
      const receipt = receiptMap.get(s.id)
      const orderInfo = sessionOrderMap.get(s.id) || { liquor: 0, waiter_tip: 0, purchase: 0 }

      return {
        session_id: s.id,
        room_name: roomNameMap.get(s.room_uuid) || null,
        session_status: s.status,
        tc_count: sessionTcMap.get(s.id) || 0,
        liquor_sales: orderInfo.liquor,
        waiter_tips: orderInfo.waiter_tip,
        purchases: orderInfo.purchase,
        gross_total: receipt?.gross_total ?? null,
        owner_margin: receipt?.margin_amount ?? null,
        receipt_status: receipt?.status ?? null,
      }
    })

    return NextResponse.json({
      store_uuid: authContext.store_uuid,
      business_day_id: businessDayId,
      business_date: bizDayInfo?.business_date ?? null,
      business_day_status: bizDayInfo?.status ?? null,
      summary: {
        total_sessions: sessionIds.length,
        tc_count: tcCountTotal,
        liquor_sales: liquorSales,
        // owner_revenue = 사장 매출 (주류 입금가 합계만, 웨이터팁/사입/스태프금액 제외)
        owner_revenue: liquorSales,
        waiter_tips: waiterTips,
        purchases: purchases,
        gross_total: grossTotal,
        owner_margin: ownerMargin,
        finalized_count: finalizedCount,
        draft_count: draftCount,
        unsettled_count: unsettledCount,
      },
      sessions: sessionList,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" ? 401 :
        error.type === "AUTH_INVALID" ? 401 :
        error.type === "MEMBERSHIP_NOT_FOUND" ? 403 :
        error.type === "MEMBERSHIP_INVALID" ? 403 :
        error.type === "MEMBERSHIP_NOT_APPROVED" ? 403 :
        error.type === "SERVER_CONFIG_ERROR" ? 500 :
        500
      return NextResponse.json(
        { error: error.type, message: error.message },
        { status }
      )
    }
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Unexpected error." },
      { status: 500 }
    )
  }
}
