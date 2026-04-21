import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * STEP-012: GET /api/settlements/overview
 *
 * Read-only aggregation for the settlement/payout operator screens.
 * Returns headline counters + recent payouts for the caller's store.
 * No calculation — pure server-side aggregation of columns that already
 * live in settlement_items / payout_records / cross_store_settlements.
 *
 * Scope: always auth.store_uuid, soft-deleted rows excluded.
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
    // STEP-013A: role gate — operator overview is owner/manager only.
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }
    const supabase = supa()

    // 1. Settlement items broken down by role for unpaid / paid rollups.
    const { data: itemsRaw } = await supabase
      .from("settlement_items")
      .select("settlement_id, role_type, amount, paid_amount, remaining_amount")
      .eq("store_uuid", auth.store_uuid)
      .is("deleted_at", null)
      .limit(5000)
    const items = (itemsRaw ?? []) as Array<{
      settlement_id: string
      role_type: string
      amount: number | string
      paid_amount: number | string
      remaining_amount: number | string
    }>

    const rollup = {
      hostess: { amount: 0, paid: 0, remaining: 0, count: 0 },
      manager: { amount: 0, paid: 0, remaining: 0, count: 0 },
      store: { amount: 0, paid: 0, remaining: 0, count: 0 },
    }
    for (const it of items) {
      const bucket = rollup[it.role_type as keyof typeof rollup]
      if (!bucket) continue
      bucket.amount += num(it.amount)
      bucket.paid += num(it.paid_amount)
      bucket.remaining += num(it.remaining_amount)
      bucket.count += 1
    }

    // 2. Settlement status breakdown (confirmed vs paid).
    const { data: settlementsRaw } = await supabase
      .from("settlements")
      .select("id, status")
      .eq("store_uuid", auth.store_uuid)
      .is("deleted_at", null)
    const statusCount = { draft: 0, confirmed: 0, paid: 0 } as Record<string, number>
    for (const s of (settlementsRaw ?? []) as Array<{ status: string }>) {
      statusCount[s.status] = (statusCount[s.status] ?? 0) + 1
    }

    // 3. Recent payouts (last 10).
    const { data: recentRaw } = await supabase
      .from("payout_records")
      .select(
        "id, settlement_id, settlement_item_id, recipient_type, recipient_membership_id, amount, currency, status, payout_type, memo, paid_at, created_at"
      )
      .eq("store_uuid", auth.store_uuid)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(10)

    // 4. Cross-store header status counts.
    const { data: csHeaders } = await supabase
      .from("cross_store_settlements")
      .select("id, status, total_amount, prepaid_amount, remaining_amount")
      .eq("from_store_uuid", auth.store_uuid)
      .is("deleted_at", null)
    const csStatusCount = { open: 0, partial: 0, completed: 0 } as Record<string, number>
    let csRemainingTotal = 0
    for (const h of (csHeaders ?? []) as Array<{ status: string; remaining_amount: number | string }>) {
      csStatusCount[h.status] = (csStatusCount[h.status] ?? 0) + 1
      csRemainingTotal += num(h.remaining_amount)
    }

    return NextResponse.json({
      rollup,
      settlement_status_count: statusCount,
      recent_payouts: recentRaw ?? [],
      cross_store: {
        status_count: csStatusCount,
        remaining_total: csRemainingTotal,
      },
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
