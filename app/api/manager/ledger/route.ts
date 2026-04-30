import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { monthRange } from "@/lib/finance/pnl"
import { aggregateManagerPaperLedger } from "@/lib/reconcile/managerLedgerFromPaper"

/**
 * /api/manager/ledger — manager only.
 * GET ?year_month=YYYY-MM (default = 현재 KST)
 *
 * 실장 전용 수익 장부.
 *   - 실장이 직접 받는 수익 (session_participants.manager_payout_amount) 합산
 *   - business_date 기준 일별 + 월 합계
 *   - 사장은 못 봄 (R28 visibility 정책)
 *
 * 응답:
 *   {
 *     manager_membership_id, year_month, month_start, month_end,
 *     monthly_total, days: [{ business_date, sessions, total_won }],
 *     by_category: [{ category, sessions, total_won }]
 *   }
 *
 * 정책:
 *   - manager_payout_amount 는 실장 본인이 받는 금액 (사장 비노출)
 *   - 자기 자신 만 조회 가능 (auth.role === 'manager' && manager_membership_id = auth.membership_id)
 *   - cross-store: 실장은 home store 내 자기 인 attribution 만 보면 됨
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

type ParticipantRow = {
  id: string
  session_id: string
  category: string | null
  manager_payout_amount: number | null
  hostess_payout_amount: number | null
  price_amount: number | null
  membership_id: string
}

type SessionRow = {
  id: string
  business_day_id: string | null
}

type DayRow = {
  id: string
  business_date: string
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const url = new URL(request.url)
    const ymRaw = url.searchParams.get("year_month") || currentYearMonthKst()
    if (!/^\d{4}-\d{2}$/.test(ymRaw)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "year_month YYYY-MM" }, { status: 400 })
    }
    const { start, end } = monthRange(ymRaw)

    const supabase = supa()

    // 1. business_day_id 범위 (월 내 영업일 ids)
    const { data: daysData, error: daysErr } = await supabase
      .from("store_operating_days")
      .select("id, business_date")
      .eq("store_uuid", auth.store_uuid)
      .gte("business_date", start)
      .lte("business_date", end)
    if (daysErr) {
      return NextResponse.json({ error: "DB_ERROR", message: daysErr.message }, { status: 500 })
    }
    const days = (daysData ?? []) as DayRow[]
    const dayIdToDate = new Map<string, string>()
    for (const d of days) dayIdToDate.set(d.id, d.business_date)
    const dayIds = days.map((d) => d.id)

    if (dayIds.length === 0) {
      return NextResponse.json({
        manager_membership_id: auth.membership_id,
        year_month: ymRaw,
        month_start: start,
        month_end: end,
        monthly_total: 0,
        sessions_count: 0,
        days: [],
        by_category: [],
      })
    }

    // 2. 해당 영업일의 sessions 조회 (실장 본인 attribution)
    const { data: sessionsData, error: sessErr } = await supabase
      .from("room_sessions")
      .select("id, business_day_id")
      .eq("store_uuid", auth.store_uuid)
      .in("business_day_id", dayIds)
    if (sessErr) {
      return NextResponse.json({ error: "DB_ERROR", message: sessErr.message }, { status: 500 })
    }
    const sessions = (sessionsData ?? []) as SessionRow[]
    const sessionToDay = new Map<string, string | null>()
    for (const s of sessions) sessionToDay.set(s.id, s.business_day_id)
    const sessionIds = sessions.map((s) => s.id)

    if (sessionIds.length === 0) {
      return NextResponse.json({
        manager_membership_id: auth.membership_id,
        year_month: ymRaw,
        month_start: start,
        month_end: end,
        monthly_total: 0,
        sessions_count: 0,
        days: [],
        by_category: [],
      })
    }

    // 3. session_participants 에서 manager_membership_id = 본인 인 row
    const { data: partsData, error: partsErr } = await supabase
      .from("session_participants")
      .select("id, session_id, category, manager_payout_amount, hostess_payout_amount, price_amount, membership_id")
      .eq("store_uuid", auth.store_uuid)
      .eq("manager_membership_id", auth.membership_id)
      .is("deleted_at", null)
      .in("session_id", sessionIds)
    if (partsErr) {
      return NextResponse.json({ error: "DB_ERROR", message: partsErr.message }, { status: 500 })
    }
    const parts = (partsData ?? []) as ParticipantRow[]

    // 4. 일별 집계 + 종목별 집계
    const dayAgg = new Map<string, { sessions: Set<string>; total_won: number; tc_count: number }>()
    const catAgg = new Map<string, { sessions: Set<string>; total_won: number; tc_count: number }>()
    let monthlyTotal = 0
    const monthlyTcCount = new Set<string>() // 고유 participant 카운트 = TC 건수

    for (const p of parts) {
      const dayId = sessionToDay.get(p.session_id) ?? null
      const businessDate = dayId ? (dayIdToDate.get(dayId) ?? "unknown") : "unknown"
      const amount = Number(p.manager_payout_amount ?? 0)
      const cat = p.category ?? "unknown"

      monthlyTotal += amount
      monthlyTcCount.add(p.id)

      if (!dayAgg.has(businessDate)) {
        dayAgg.set(businessDate, { sessions: new Set(), total_won: 0, tc_count: 0 })
      }
      const dayBucket = dayAgg.get(businessDate)!
      dayBucket.sessions.add(p.session_id)
      dayBucket.total_won += amount
      dayBucket.tc_count += 1

      if (!catAgg.has(cat)) {
        catAgg.set(cat, { sessions: new Set(), total_won: 0, tc_count: 0 })
      }
      const catBucket = catAgg.get(cat)!
      catBucket.sessions.add(p.session_id)
      catBucket.total_won += amount
      catBucket.tc_count += 1
    }

    const daysOut = Array.from(dayAgg.entries())
      .map(([business_date, b]) => ({
        business_date,
        sessions: b.sessions.size,
        tc_count: b.tc_count,
        total_won: b.total_won,
      }))
      .sort((a, b) => b.business_date.localeCompare(a.business_date))

    const byCategory = Array.from(catAgg.entries())
      .map(([category, b]) => ({
        category,
        sessions: b.sessions.size,
        tc_count: b.tc_count,
        total_won: b.total_won,
      }))
      .sort((a, b) => b.total_won - a.total_won)

    // 2026-04-30 (R-paper-to-manager): 종이장부 staff sheet 의 manager 매핑
    //   합산. DB session_participants 와 별도 section 으로 노출 (이중 계산
    //   방지). 운영자가 두 source 를 비교 가능. 실패 시 빈 결과로 fallback.
    let paperAgg
    try {
      paperAgg = await aggregateManagerPaperLedger(supabase, {
        store_uuid: auth.store_uuid,
        manager_membership_id: auth.membership_id,
        year_month: ymRaw,
      })
    } catch {
      paperAgg = { rows: [], total_tc: 0, total_owe_won: 0, by_hostess: [] }
    }

    return NextResponse.json({
      manager_membership_id: auth.membership_id,
      year_month: ymRaw,
      month_start: start,
      month_end: end,
      monthly_total: monthlyTotal,
      sessions_count: monthlyTcCount.size,
      days: daysOut,
      by_category: byCategory,
      paper_ledger: {
        total_tc: paperAgg.total_tc,
        total_owe_won: paperAgg.total_owe_won,
        rows: paperAgg.rows,
        by_hostess: paperAgg.by_hostess,
      },
    })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    const msg = e instanceof Error ? e.message : "INTERNAL_ERROR"
    return NextResponse.json({ error: "INTERNAL_ERROR", message: msg }, { status: 500 })
  }
}
