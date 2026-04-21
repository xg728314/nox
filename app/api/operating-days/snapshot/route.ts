import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { parseUuid } from "@/lib/security/guards"

/**
 * STEP-017: GET /api/operating-days/snapshot?business_day_id=<uuid>
 *
 * Returns the closing snapshot for a business day — the immutable
 * `closing_reports.summary` row that was stored at closing time plus
 * a count of payouts that occurred on (or reference items from) that day.
 *
 * Owner/manager only. Pure read from stored data — no recomputation.
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
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }
    const url = new URL(request.url)
    const bdid = parseUuid(url.searchParams.get("business_day_id"))
    if (!bdid) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "business_day_id must be a valid uuid." },
        { status: 400 }
      )
    }
    const supabase = supa()

    const { data: day } = await supabase
      .from("store_operating_days")
      .select("id, business_date, status, closed_at, closed_by")
      .eq("id", bdid)
      .eq("store_uuid", auth.store_uuid)
      .maybeSingle()
    if (!day) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }

    const { data: report } = await supabase
      .from("closing_reports")
      .select("id, status, summary, notes, created_at, confirmed_at, confirmed_by")
      .eq("store_uuid", auth.store_uuid)
      .eq("business_day_id", bdid)
      .maybeSingle()

    const { data: sessionsRaw } = await supabase
      .from("room_sessions")
      .select("id")
      .eq("store_uuid", auth.store_uuid)
      .eq("business_day_id", bdid)
      .limit(2000)
    const sessionIds = (sessionsRaw ?? []).map((s: { id: string }) => s.id)

    let settlementsCount = 0
    let payoutsCount = 0
    if (sessionIds.length > 0) {
      const { data: sets } = await supabase
        .from("settlements")
        .select("id")
        .in("session_id", sessionIds)
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null)
      settlementsCount = (sets ?? []).length
      const setIds = (sets ?? []).map((s: { id: string }) => s.id)
      if (setIds.length > 0) {
        const { count } = await supabase
          .from("payout_records")
          .select("id", { count: "exact", head: true })
          .in("settlement_id", setIds)
          .eq("store_uuid", auth.store_uuid)
          .is("deleted_at", null)
        payoutsCount = count ?? 0
      }
    }

    return NextResponse.json({
      business_day: day,
      locked: day.status === "closed",
      closing_report: report,
      linked: {
        session_count: sessionIds.length,
        settlement_count: settlementsCount,
        payout_count: payoutsCount,
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
