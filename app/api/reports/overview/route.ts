import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * STEP-016: GET /api/reports/overview
 *
 * Store-level headline numbers for the reports dashboard. Pure
 * aggregation of already-stored columns — no recomputation of shares,
 * no client-supplied amounts.
 *
 * Owner/manager only. store_uuid scope mandatory.
 *
 * Response shape:
 *   {
 *     revenue: { total, profit, settlement_count },
 *     payouts: { total_amount, total_paid, total_remaining },
 *     by_role: { hostess:{amount,paid,remaining}, manager:{...} },
 *     cross_store: { total, paid, remaining, open, partial, completed }
 *   }
 */

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

function num(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }
    const supabase = supa()

    // 1. settlements header totals (revenue + store profit)
    const { data: srows } = await supabase
      .from("settlements")
      .select("id, status, total_amount, store_amount")
      .eq("store_uuid", auth.store_uuid)
      .is("deleted_at", null)
      .limit(5000)
    const settlements = (srows ?? []) as Array<{
      id: string
      status: string
      total_amount: number | string
      store_amount: number | string
    }>

    const revenue = { total: 0, profit: 0, settlement_count: 0 }
    const statusCount: Record<string, number> = { draft: 0, confirmed: 0, paid: 0 }
    for (const s of settlements) {
      statusCount[s.status] = (statusCount[s.status] ?? 0) + 1
      if (s.status === "draft") continue
      revenue.total += num(s.total_amount)
      revenue.profit += num(s.store_amount)
      revenue.settlement_count += 1
    }

    // 2. settlement_items for paid/remaining rollups by role
    const { data: itemsRaw } = await supabase
      .from("settlement_items")
      .select("role_type, amount, paid_amount, remaining_amount")
      .eq("store_uuid", auth.store_uuid)
      .is("deleted_at", null)
      .limit(10000)
    const items = (itemsRaw ?? []) as Array<{
      role_type: string
      amount: number | string
      paid_amount: number | string
      remaining_amount: number | string
    }>

    const byRole = {
      hostess: { amount: 0, paid: 0, remaining: 0 },
      manager: { amount: 0, paid: 0, remaining: 0 },
    }
    const payouts = { total_amount: 0, total_paid: 0, total_remaining: 0 }
    for (const it of items) {
      payouts.total_amount += num(it.amount)
      payouts.total_paid += num(it.paid_amount)
      payouts.total_remaining += num(it.remaining_amount)
      const b = byRole[it.role_type as keyof typeof byRole]
      if (!b) continue
      b.amount += num(it.amount)
      b.paid += num(it.paid_amount)
      b.remaining += num(it.remaining_amount)
    }

    // 3. cross-store headers
    const { data: csRaw } = await supabase
      .from("cross_store_settlements")
      .select("status, total_amount, prepaid_amount, remaining_amount")
      .eq("from_store_uuid", auth.store_uuid)
      .is("deleted_at", null)
      .limit(2000)
    const cross = { total: 0, paid: 0, remaining: 0, open: 0, partial: 0, completed: 0 }
    for (const h of (csRaw ?? []) as Array<{
      status: string
      total_amount: number | string
      prepaid_amount: number | string
      remaining_amount: number | string
    }>) {
      cross.total += num(h.total_amount)
      cross.paid += num(h.prepaid_amount)
      cross.remaining += num(h.remaining_amount)
      if (h.status === "open") cross.open += 1
      else if (h.status === "partial") cross.partial += 1
      else if (h.status === "completed") cross.completed += 1
    }

    return NextResponse.json({
      revenue,
      settlement_status_count: statusCount,
      payouts,
      by_role: byRole,
      cross_store: cross,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
