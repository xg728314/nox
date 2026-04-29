import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { computeMonthlyPnl } from "@/lib/finance/pnl"

/**
 * /api/finance/pnl — owner only.
 * GET ?year_month=YYYY-MM (default = 현재 월 KST)
 *
 * 응답 = MonthlyPnl (lib/finance/pnl.ts).
 *   revenue / cost / net_profit / break_even_analysis 일체.
 *
 * 정책:
 *   - 발생주의: store_purchases.total_won 합 = 변동비
 *   - orders.unit_price × qty 는 변동비 X (이중 계산 회피)
 *   - 평균 양주 마진 = (store_price - unit_price) × qty 의 30일 평균
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

function currentYearMonthKst(): string {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 3600 * 1000)
  return kst.toISOString().slice(0, 7)
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const url = new URL(request.url)
    const ymRaw = url.searchParams.get("year_month") || currentYearMonthKst()
    if (!/^\d{4}-\d{2}$/.test(ymRaw)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "year_month YYYY-MM" }, { status: 400 })
    }

    const supabase = supa()
    const pnl = await computeMonthlyPnl(supabase, auth.store_uuid, ymRaw)
    return NextResponse.json(pnl)
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    const msg = e instanceof Error ? e.message : "INTERNAL_ERROR"
    return NextResponse.json({ error: "INTERNAL_ERROR", message: msg }, { status: 500 })
  }
}
