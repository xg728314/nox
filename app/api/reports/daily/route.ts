import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    // owner/manager only
    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to view daily reports." },
        { status: 403 }
      )
    }

    const url = new URL(request.url)
    const businessDayId = url.searchParams.get("business_day_id")

    if (!businessDayId) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "business_day_id query param is required." },
        { status: 400 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. Verify business_day belongs to store
    const { data: opDay, error: opError } = await supabase
      .from("store_operating_days")
      .select("id, business_date, status")
      .eq("id", businessDayId)
      .eq("store_uuid", authContext.store_uuid)
      .single()

    if (opError || !opDay) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Operating day not found." },
        { status: 404 }
      )
    }

    // 2. Receipts by session (session-level settlement summaries)
    const { data: receipts } = await supabase
      .from("receipts")
      .select("id, session_id, gross_total, tc_amount, manager_amount, hostess_amount, margin_amount, order_total_amount, participant_total_amount, status")
      .eq("store_uuid", authContext.store_uuid)
      .eq("business_day_id", businessDayId)

    const receiptList = receipts ?? []

    // Totals
    const totals = {
      session_count: receiptList.length,
      gross_total: 0,
      tc_total: 0,
      manager_total: 0,
      hostess_total: 0,
      margin_total: 0,
      order_total: 0,
      participant_total: 0,
    }
    for (const r of receiptList) {
      totals.gross_total += r.gross_total ?? 0
      totals.tc_total += r.tc_amount ?? 0
      totals.manager_total += r.manager_amount ?? 0
      totals.hostess_total += r.hostess_amount ?? 0
      totals.margin_total += r.margin_amount ?? 0
      totals.order_total += r.order_total_amount ?? 0
      totals.participant_total += r.participant_total_amount ?? 0
    }

    // 3. Participant-level breakdown by membership (manager/hostess payouts)
    const { data: participants } = await supabase
      .from("session_participants")
      .select("membership_id, role, category, time_minutes, price_amount, manager_payout_amount, hostess_payout_amount, margin_amount")
      .eq("store_uuid", authContext.store_uuid)
      .in("session_id", receiptList.map(r => r.session_id))

    // Group by membership_id + role
    const staffMap = new Map<string, {
      membership_id: string
      role: string
      sessions: number
      total_price: number
      total_payout: number
    }>()

    for (const p of (participants ?? [])) {
      const key = p.membership_id
      if (!staffMap.has(key)) {
        staffMap.set(key, {
          membership_id: p.membership_id,
          role: p.role,
          sessions: 0,
          total_price: 0,
          total_payout: 0,
        })
      }
      const entry = staffMap.get(key)!
      entry.sessions += 1
      entry.total_price += p.price_amount ?? 0
      if (p.role === "manager") {
        entry.total_payout += p.manager_payout_amount ?? 0
      } else {
        entry.total_payout += p.hostess_payout_amount ?? 0
      }
    }

    // Split into manager/hostess arrays
    const managerBreakdown = [...staffMap.values()].filter(s => s.role === "manager")
    const hostessBreakdown = [...staffMap.values()].filter(s => s.role === "hostess")

    // Owner visibility: check manager toggles for read-through
    if (authContext.role === "owner") {
      // Look up manager visibility toggles
      let showManagerProfit = false
      let showHostessProfit = false
      {
        const { data: mgrRows } = await supabase
          .from("managers")
          .select("show_profit_to_owner, show_hostess_profit_to_owner")
          .eq("store_uuid", authContext.store_uuid)
        for (const m of (mgrRows ?? []) as { show_profit_to_owner: boolean; show_hostess_profit_to_owner: boolean }[]) {
          if (m.show_profit_to_owner) showManagerProfit = true
          if (m.show_hostess_profit_to_owner) showHostessProfit = true
        }
      }

      const ownerTotals: Record<string, number> = {
        session_count: totals.session_count,
        gross_total: totals.gross_total,
        tc_total: totals.tc_total,
        margin_total: totals.margin_total,
        order_total: totals.order_total,
        participant_total: totals.participant_total,
      }
      if (showManagerProfit) ownerTotals.manager_total = totals.manager_total
      if (showHostessProfit) ownerTotals.hostess_total = totals.hostess_total

      const ownerReceipts = receiptList.map((r: { id: string; session_id: string; gross_total: number; tc_amount: number; manager_amount: number; hostess_amount: number; margin_amount: number; order_total_amount: number; participant_total_amount: number; status: string }) => {
        const item: Record<string, unknown> = {
          id: r.id,
          session_id: r.session_id,
          gross_total: r.gross_total,
          tc_amount: r.tc_amount,
          margin_amount: r.margin_amount,
          order_total_amount: r.order_total_amount,
          participant_total_amount: r.participant_total_amount,
          status: r.status,
        }
        if (showManagerProfit) item.manager_amount = r.manager_amount
        if (showHostessProfit) item.hostess_amount = r.hostess_amount
        return item
      })

      return NextResponse.json({
        business_day_id: businessDayId,
        business_date: opDay.business_date,
        day_status: opDay.status,
        totals: ownerTotals,
        receipts: ownerReceipts,
        manager_breakdown: showManagerProfit ? managerBreakdown : [],
        hostess_breakdown: showHostessProfit ? hostessBreakdown : [],
      })
    }

    return NextResponse.json({
      business_day_id: businessDayId,
      business_date: opDay.business_date,
      day_status: opDay.status,
      totals,
      receipts: receiptList,
      manager_breakdown: managerBreakdown,
      hostess_breakdown: hostessBreakdown,
    })

  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" ? 401 :
        error.type === "AUTH_INVALID" ? 401 :
        error.type === "MEMBERSHIP_NOT_FOUND" ? 403 :
        error.type === "MEMBERSHIP_INVALID" ? 403 :
        error.type === "MEMBERSHIP_NOT_APPROVED" ? 403 :
        error.type === "SERVER_CONFIG_ERROR" ? 500 : 500
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Unexpected error." }, { status: 500 })
  }
}
