import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * GET /api/settlement/history — 정산 이력 (owner/manager)
 */
export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)
    if (!["owner", "manager"].includes(authContext.role)) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    type ReceiptRow = { id: string; session_id: string; business_day_id: string; version: number; gross_total: number; tc_amount: number; manager_amount: number; hostess_amount: number; margin_amount: number; status: string; created_at: string }

    const { data: receipts, error } = await supabase
      .from("receipts")
      .select("id, session_id, business_day_id, version, gross_total, tc_amount, manager_amount, hostess_amount, margin_amount, status, created_at")
      .eq("store_uuid", authContext.store_uuid)
      .order("created_at", { ascending: false })
      .limit(50)

    if (error) {
      return NextResponse.json({ error: "QUERY_FAILED" }, { status: 500 })
    }

    // 영업일 날짜 조회
    const bizDayIds = [...new Set((receipts ?? []).map((r: ReceiptRow) => r.business_day_id))]
    const dateMap = new Map<string, string>()
    if (bizDayIds.length > 0) {
      const { data: days } = await supabase
        .from("store_operating_days")
        .select("id, business_date")
        .in("id", bizDayIds)
      for (const d of days ?? []) dateMap.set(d.id, d.business_date)
    }

    const enriched = (receipts ?? []).map((r: ReceiptRow) => ({
      receipt_id: r.id,
      session_id: r.session_id,
      business_date: dateMap.get(r.business_day_id) || null,
      version: r.version,
      gross_total: r.gross_total,
      tc_amount: r.tc_amount,
      manager_amount: r.manager_amount,
      hostess_amount: r.hostess_amount,
      margin_amount: r.margin_amount,
      status: r.status,
      created_at: r.created_at,
    }))

    return NextResponse.json({ store_uuid: authContext.store_uuid, receipts: enriched })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
