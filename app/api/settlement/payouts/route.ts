import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { isValidUUID } from "@/lib/validation"

/**
 * STEP-011D: GET /api/settlement/payouts
 *
 * Lists payout_records scoped to the caller's store. Optional filters:
 *   ?settlement_id=<uuid>
 *   ?recipient_type=hostess|manager
 *   ?recipient_membership_id=<uuid>
 *
 * Always store-scoped (store_uuid = auth.store_uuid) with soft-delete
 * exclusion. Pure read — no writes.
 */

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    // STEP-013A: role gate — payout listing is owner/manager only; hostess
    // self-view uses the dedicated /api/me endpoints.
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }
    const { searchParams } = new URL(request.url)

    const settlement_id = searchParams.get("settlement_id")
    const recipient_type = searchParams.get("recipient_type")
    const recipient_membership_id = searchParams.get("recipient_membership_id")

    if (settlement_id && !isValidUUID(settlement_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "invalid settlement_id." }, { status: 400 })
    }
    if (recipient_type && !["hostess", "manager"].includes(recipient_type)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "invalid recipient_type." }, { status: 400 })
    }
    if (recipient_membership_id && !isValidUUID(recipient_membership_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "invalid recipient_membership_id." }, { status: 400 })
    }

    const supabase = supa()

    let query = supabase
      .from("payout_records")
      .select(
        "id, store_uuid, settlement_id, settlement_item_id, recipient_type, recipient_membership_id, amount, currency, status, payout_type, memo, created_by, completed_at, paid_at, created_at, updated_at"
      )
      .eq("store_uuid", auth.store_uuid)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(500)

    if (settlement_id) query = query.eq("settlement_id", settlement_id)
    if (recipient_type) query = query.eq("recipient_type", recipient_type)
    if (recipient_membership_id) query = query.eq("recipient_membership_id", recipient_membership_id)

    const { data, error } = await query
    if (error) {
      return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    }

    return NextResponse.json({ payouts: data ?? [] })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
