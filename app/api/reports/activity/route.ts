import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * STEP-016: GET /api/reports/activity
 *
 * Recent activity feed for the reports dashboard.
 *   - recent_payouts           (last 20, any payout_records row)
 *   - recent_cross_store_payouts (last 20 where cross_store_settlement_id not null)
 *   - recent_cancels           (last 20 cancelled or reversal rows, STEP-014+)
 *
 * Aggregation only — pulls from stored rows. Owner-only.
 */

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

const BASE_COLS =
  "id, store_uuid, settlement_id, settlement_item_id, cross_store_settlement_id, cross_store_settlement_item_id, recipient_type, recipient_membership_id, amount, status, payout_type, note, paid_at, created_at, cancelled_at, cancel_reason, original_payout_id, reversed_by_payout_id"

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }
    const supabase = supa()

    const [recentRes, crossRes, cancelRes] = await Promise.all([
      supabase
        .from("payout_records")
        .select(BASE_COLS)
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("payout_records")
        .select(BASE_COLS)
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null)
        .not("cross_store_settlement_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("payout_records")
        .select(BASE_COLS)
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null)
        .or("status.eq.cancelled,payout_type.eq.reversal")
        .order("created_at", { ascending: false })
        .limit(20),
    ])

    return NextResponse.json({
      recent_payouts: recentRes.data ?? [],
      recent_cross_store_payouts: crossRes.data ?? [],
      recent_cancels: cancelRes.data ?? [],
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
