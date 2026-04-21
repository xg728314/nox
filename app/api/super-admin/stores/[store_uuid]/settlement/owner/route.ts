import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { resolveAdminScope } from "@/lib/auth/resolveAdminScope"
import { createClient } from "@supabase/supabase-js"

/**
 * GET /api/super-admin/stores/[store_uuid]/settlement/owner
 *
 * Mirror of /api/owner/settlement but scoped to a target store provided
 * via the path param (not the caller's own store_uuid). Uses the SAME
 * aggregation queries as the owner route — NO new calculation logic is
 * introduced. Reads existing `receipts`, `orders`, `session_participants`,
 * `room_sessions`, `rooms` tables.
 *
 * super_admin gate via resolveAdminScope. Read-only. Cross-store reads
 * are logged to admin_access_logs.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ store_uuid: string }> }
) {
  try {
    const authContext = await resolveAuthContext(request)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: "SERVER_CONFIG_ERROR" },
        { status: 500 }
      )
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { store_uuid: pathStoreUuid } = await params
    const scope = await resolveAdminScope({
      auth: authContext,
      supabase,
      request,
      screen: "super-admin/settlement-owner",
      requiredTargetFromPath: pathStoreUuid,
      actionKind: "read",
      actionDetail: "owner_settlement_read",
    })
    if (!scope.ok) return scope.error
    const storeUuid = scope.scopeStoreUuid

    // Resolve business_day_id (query param → today → latest open)
    const { searchParams } = new URL(request.url)
    let businessDayId: string | null = searchParams.get("business_day_id")

    if (!businessDayId) {
      const today = new Date().toISOString().split("T")[0]
      const { data: bizDay } = await supabase
        .from("store_operating_days")
        .select("id")
        .eq("store_uuid", storeUuid)
        .eq("business_date", today)
        .maybeSingle()
      businessDayId = bizDay?.id ?? null
      if (!businessDayId) {
        const { data: latestDay } = await supabase
          .from("store_operating_days")
          .select("id")
          .eq("store_uuid", storeUuid)
          .eq("status", "open")
          .order("business_date", { ascending: false })
          .limit(1)
          .maybeSingle()
        businessDayId = latestDay?.id ?? null
      }
    }

    if (!businessDayId) {
      return NextResponse.json({
        store_uuid: storeUuid,
        business_day_id: null,
        summary: null,
      })
    }

    const { data: bizDayInfo } = await supabase
      .from("store_operating_days")
      .select("id, business_date, status")
      .eq("id", businessDayId)
      .eq("store_uuid", storeUuid)
      .maybeSingle()

    const { data: sessions } = await supabase
      .from("room_sessions")
      .select("id")
      .eq("store_uuid", storeUuid)
      .eq("business_day_id", businessDayId)

    const sessionIds = (sessions ?? []).map((s: { id: string }) => s.id)

    if (sessionIds.length === 0) {
      return NextResponse.json({
        store_uuid: storeUuid,
        business_day_id: businessDayId,
        business_date: bizDayInfo?.business_date ?? null,
        business_day_status: bizDayInfo?.status ?? null,
        summary: {
          total_sessions: 0,
          tc_count: 0,
          liquor_sales: 0,
          owner_revenue: 0,
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

    // Orders aggregation — owner-view rules (owner sales = store_price * qty)
    const { data: orders } = await supabase
      .from("orders")
      .select("session_id, order_type, qty, unit_price, store_price, customer_amount")
      .eq("store_uuid", storeUuid)
      .eq("business_day_id", businessDayId)
      .is("deleted_at", null)

    let liquorSales = 0
    let waiterTips = 0
    let purchases = 0
    const sessionOrderMap = new Map<string, { liquor: number; waiter_tip: number; purchase: number }>()
    for (const o of orders ?? []) {
      const customerAmount = (o.customer_amount as number | null) ?? ((o.qty as number) * (o.unit_price as number))
      const ownerAmount = ((o.store_price as number | null) ?? (o.unit_price as number)) * (o.qty as number)
      const orderType = ((o.order_type as string) || "").toLowerCase()
      if (!sessionOrderMap.has(o.session_id as string)) {
        sessionOrderMap.set(o.session_id as string, { liquor: 0, waiter_tip: 0, purchase: 0 })
      }
      const entry = sessionOrderMap.get(o.session_id as string)!
      if (orderType === "waiter_tip" || orderType === "웨이터팁") {
        waiterTips += customerAmount
        entry.waiter_tip += customerAmount
      } else if (orderType === "purchase" || orderType === "사입") {
        purchases += customerAmount
        entry.purchase += customerAmount
      } else {
        liquorSales += ownerAmount
        entry.liquor += ownerAmount
      }
    }

    const { data: participants } = await supabase
      .from("session_participants")
      .select("id, session_id, role")
      .eq("store_uuid", storeUuid)
      .in("session_id", sessionIds)
      .is("deleted_at", null)
    const tcCountTotal = (participants ?? []).filter((p: { role: string }) => p.role === "hostess").length
    const sessionTcMap = new Map<string, number>()
    for (const p of participants ?? []) {
      if (p.role === "hostess") {
        sessionTcMap.set(p.session_id as string, (sessionTcMap.get(p.session_id as string) ?? 0) + 1)
      }
    }

    const { data: receipts } = await supabase
      .from("receipts")
      .select("session_id, status, gross_total, margin_amount, tc_amount")
      .eq("store_uuid", storeUuid)
      .eq("business_day_id", businessDayId)
      .order("version", { ascending: false })
    const receiptMap = new Map<string, { status: string; gross_total: number; margin_amount: number; tc_amount: number }>()
    for (const r of receipts ?? []) {
      if (!receiptMap.has(r.session_id as string)) {
        receiptMap.set(r.session_id as string, r as { status: string; gross_total: number; margin_amount: number; tc_amount: number })
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

    // Room names for per-session view
    const { data: roomSessions } = await supabase
      .from("room_sessions")
      .select("id, room_uuid, status")
      .eq("store_uuid", storeUuid)
      .eq("business_day_id", businessDayId)
    const roomUuids = [...new Set((roomSessions ?? []).map((s: { room_uuid: string }) => s.room_uuid))]
    const { data: rooms } = await supabase
      .from("rooms")
      .select("id, room_name")
      .eq("store_uuid", storeUuid)
      .in("id", roomUuids)
    const roomNameMap = new Map<string, string>()
    for (const r of rooms ?? []) roomNameMap.set(r.id as string, r.room_name as string)

    const sessionList = (roomSessions ?? []).map((s: { id: string; room_uuid: string; status: string }) => {
      const receipt = receiptMap.get(s.id)
      const orderInfo = sessionOrderMap.get(s.id) ?? { liquor: 0, waiter_tip: 0, purchase: 0 }
      return {
        session_id: s.id,
        room_name: roomNameMap.get(s.room_uuid) ?? null,
        session_status: s.status,
        tc_count: sessionTcMap.get(s.id) ?? 0,
        liquor_sales: orderInfo.liquor,
        waiter_tips: orderInfo.waiter_tip,
        purchases: orderInfo.purchase,
        gross_total: receipt?.gross_total ?? null,
        owner_margin: receipt?.margin_amount ?? null,
        receipt_status: receipt?.status ?? null,
      }
    })

    return NextResponse.json({
      store_uuid: storeUuid,
      business_day_id: businessDayId,
      business_date: bizDayInfo?.business_date ?? null,
      business_day_status: bizDayInfo?.status ?? null,
      summary: {
        total_sessions: sessionIds.length,
        tc_count: tcCountTotal,
        liquor_sales: liquorSales,
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
      viewer: { is_super_admin: true, cross_store: scope.isCrossStore },
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
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
