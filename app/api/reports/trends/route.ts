/**
 * GET /api/reports/trends?days=14
 *
 * 최근 N일 일별 매출/타임 트렌드.
 *   본 매장 (auth.store_uuid) 의 finalized 정산 데이터 기준.
 *
 * 응답:
 *   {
 *     days: [{ business_date, total_gross, tc_count, participants }],
 *     range: { from, to }
 *   }
 *
 * 권한: owner / manager.
 *
 * R-trends (2026-06-28).
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const url = new URL(request.url)
    const daysParam = parseInt(url.searchParams.get("days") ?? "14", 10)
    const days = Number.isFinite(daysParam) ? Math.min(90, Math.max(1, daysParam)) : 14

    const supabase = getServiceClient()

    // 1. 최근 N일 영업일
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60_000)
    const cutoffYmd = cutoffDate.toISOString().slice(0, 10)
    const { data: bizDays } = await supabase
      .from("store_operating_days")
      .select("id, business_date")
      .eq("store_uuid", auth.store_uuid)
      .gte("business_date", cutoffYmd)
      .order("business_date", { ascending: true })
    type Bd = { id: string; business_date: string }
    const bdRows = (bizDays ?? []) as Bd[]
    if (bdRows.length === 0) {
      return NextResponse.json({ days: [], range: { from: cutoffYmd, to: cutoffYmd } })
    }
    const bdIds = bdRows.map((b) => b.id)
    const bdIdToDate = new Map(bdRows.map((b) => [b.id, b.business_date]))

    // 2. 그 영업일의 sessions
    const { data: sess } = await supabase
      .from("room_sessions")
      .select("id, business_day_id")
      .eq("store_uuid", auth.store_uuid)
      .in("business_day_id", bdIds)
      .is("deleted_at", null)
    type Sess = { id: string; business_day_id: string }
    const sRows = (sess ?? []) as Sess[]
    const sessToDate = new Map<string, string>()
    for (const s of sRows) {
      const d = bdIdToDate.get(s.business_day_id)
      if (d) sessToDate.set(s.id, d)
    }

    // 3. participants — 일별 집계
    const sessIds = sRows.map((s) => s.id)
    const dayMap = new Map<
      string,
      { total_gross: number; tc_count: number; participants: number }
    >()
    for (const d of bdRows) {
      dayMap.set(d.business_date, { total_gross: 0, tc_count: 0, participants: 0 })
    }
    if (sessIds.length > 0) {
      const chunk = 500
      for (let i = 0; i < sessIds.length; i += chunk) {
        const batch = sessIds.slice(i, i + chunk)
        const { data: parts } = await supabase
          .from("session_participants")
          .select("session_id, price_amount")
          .in("session_id", batch)
          .is("deleted_at", null)
        type P = { session_id: string; price_amount: number | null }
        for (const p of ((parts ?? []) as P[])) {
          const date = sessToDate.get(p.session_id)
          if (!date) continue
          const agg = dayMap.get(date)
          if (!agg) continue
          agg.total_gross += Number(p.price_amount ?? 0)
          agg.participants += 1
          if ((p.price_amount ?? 0) > 0) agg.tc_count += 1
        }
      }
    }

    const daysArr = bdRows.map((b) => ({
      business_date: b.business_date,
      ...(dayMap.get(b.business_date) ?? { total_gross: 0, tc_count: 0, participants: 0 }),
    }))

    return NextResponse.json({
      days: daysArr,
      range: {
        from: bdRows[0].business_date,
        to: bdRows[bdRows.length - 1].business_date,
      },
    })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json(
      { error: "INTERNAL", message: e instanceof Error ? e.message : "err" },
      { status: 500 },
    )
  }
}
