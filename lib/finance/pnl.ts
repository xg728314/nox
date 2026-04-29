/**
 * R-Finance: 월 P&L + 손익분기점 계산.
 *
 * 정책:
 *   - 발생주의: store_purchases.total_won 합 = 변동비
 *   - orders.unit_price × qty 는 PnL 변동비에 사용 X (이중 계산 회피)
 *   - 평균 양주 마진은 (store_price - unit_price) × qty 의 30일 평균
 *   - 양주 분류: order_type IN ('주류','양주')
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export type RevenueBreakdown = {
  total: number
  by_source: {
    /** receipts.gross_total 합 */
    receipts: number
  }
}

export type CostBreakdown = {
  total: number
  variable: {
    total: number
    purchases: number       // store_purchases.total_won 합
    expenses: number        // store_expenses.amount_won 합
  }
  fixed: {
    total: number
    rent: number            // store_settings.monthly_rent
    utilities: number       // store_settings.monthly_utilities
    misc: number            // store_settings.monthly_misc
  }
}

export type BreakEvenAnalysis = {
  break_even_revenue: number
  remaining_to_break_even: number
  avg_margin_per_bottle: number
  remaining_bottles: number
  days_left: number
  daily_target_won: number
  daily_target_bottles: number
  /** 'ahead' | 'on_track' | 'behind' */
  trend: "ahead" | "on_track" | "behind"
}

export type MonthlyPnl = {
  store_uuid: string
  year_month: string         // 'YYYY-MM'
  month_start: string        // ISO date
  month_end: string          // ISO date
  revenue: RevenueBreakdown
  cost: CostBreakdown
  net_profit: number
  break_even_analysis: BreakEvenAnalysis
}

/** YYYY-MM 형식 검증 + 시작/끝 date 계산 (KST 기준) */
export function monthRange(yearMonth: string): { start: string; end: string; daysInMonth: number } {
  const m = yearMonth.match(/^(\d{4})-(\d{2})$/)
  if (!m) throw new Error("year_month must be YYYY-MM")
  const y = parseInt(m[1], 10)
  const mo = parseInt(m[2], 10)
  if (mo < 1 || mo > 12) throw new Error("invalid month")
  const startDate = new Date(Date.UTC(y, mo - 1, 1))
  const endDate = new Date(Date.UTC(y, mo, 0))   // last day
  const daysInMonth = endDate.getUTCDate()
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { start: fmt(startDate), end: fmt(endDate), daysInMonth }
}

/** KST 오늘 (YYYY-MM-DD) */
export function kstTodayDate(): string {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 3600 * 1000)
  return kst.toISOString().slice(0, 10)
}

/**
 * 월 PnL 계산 - 한 매장.
 * fail-closed: 데이터 query 실패 시 0 으로 fallback.
 */
export async function computeMonthlyPnl(
  supabase: SupabaseClient,
  store_uuid: string,
  year_month: string,
): Promise<MonthlyPnl> {
  const { start, end, daysInMonth } = monthRange(year_month)

  // 0. 영업일 ID 범위 — receipts/orders 는 business_day_id FK 만 가짐.
  //    receipts 에 business_date 컬럼은 존재하지 않는다 (DB 실사 확인:
  //    columns = id, session_id, store_uuid, business_day_id, ...).
  //    따라서 store_operating_days 를 먼저 조회해 ID 목록을 만든다.
  const { data: opDaysData } = await supabase
    .from("store_operating_days")
    .select("id")
    .eq("store_uuid", store_uuid)
    .gte("business_date", start)
    .lte("business_date", end)
  const dayIds = ((opDaysData ?? []) as { id: string }[]).map((d) => d.id)

  // 1. 수익 - receipts.gross_total (business_day_id IN dayIds)
  let receiptsTotal = 0
  if (dayIds.length > 0) {
    const { data: receiptsData } = await supabase
      .from("receipts")
      .select("gross_total")
      .eq("store_uuid", store_uuid)
      .eq("status", "finalized")
      .is("archived_at", null)
      .in("business_day_id", dayIds)
    receiptsTotal = (receiptsData ?? []).reduce(
      (s: number, r: { gross_total: number | null }) => s + (r.gross_total ?? 0),
      0,
    )
  }

  // 2. 변동비 - store_purchases
  const { data: purchaseData } = await supabase
    .from("store_purchases")
    .select("total_won")
    .eq("store_uuid", store_uuid)
    .eq("status", "approved")
    .is("deleted_at", null)
    .gte("business_date", start)
    .lte("business_date", end)
  const purchasesTotal = (purchaseData ?? []).reduce(
    (s: number, r: { total_won: number | string }) => s + Number(r.total_won ?? 0),
    0,
  )

  // 3. 변동비 - store_expenses
  const { data: expenseData } = await supabase
    .from("store_expenses")
    .select("amount_won")
    .eq("store_uuid", store_uuid)
    .eq("status", "approved")
    .is("deleted_at", null)
    .gte("business_date", start)
    .lte("business_date", end)
  const expensesTotal = (expenseData ?? []).reduce(
    (s: number, r: { amount_won: number | string }) => s + Number(r.amount_won ?? 0),
    0,
  )

  // 4. 고정비 - store_settings
  const { data: settings } = await supabase
    .from("store_settings")
    .select("monthly_rent, monthly_utilities, monthly_misc")
    .eq("store_uuid", store_uuid)
    .is("deleted_at", null)
    .maybeSingle()
  const rent = (settings as { monthly_rent?: number } | null)?.monthly_rent ?? 0
  const utilities = (settings as { monthly_utilities?: number } | null)?.monthly_utilities ?? 0
  const misc = (settings as { monthly_misc?: number } | null)?.monthly_misc ?? 0

  const variableTotal = purchasesTotal + expensesTotal
  const fixedTotal = rent + utilities + misc
  const costTotal = variableTotal + fixedTotal
  const netProfit = receiptsTotal - costTotal

  // 5. BEP 분석 - 평균 양주 마진 (최근 30일)
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30)
  const since = thirtyDaysAgo.toISOString()

  const { data: ordersData } = await supabase
    .from("orders")
    .select("store_price, unit_price, qty, order_type")
    .eq("store_uuid", store_uuid)
    .in("order_type", ["주류", "양주"])
    .is("deleted_at", null)
    .is("archived_at", null)
    .gte("created_at", since)
  let totalMargin = 0
  let totalBottles = 0
  for (const o of (ordersData ?? []) as { store_price: number; unit_price: number; qty: number }[]) {
    const margin = (o.store_price - o.unit_price) * o.qty
    totalMargin += margin
    totalBottles += o.qty
  }
  const avgMarginPerBottle = totalBottles > 0 ? Math.floor(totalMargin / totalBottles) : 0

  // 6. BEP 계산
  const breakEvenRevenue = costTotal
  const remainingToBreakEven = Math.max(0, breakEvenRevenue - receiptsTotal)
  const remainingBottles = avgMarginPerBottle > 0
    ? Math.ceil(remainingToBreakEven / avgMarginPerBottle)
    : 0

  // 7. 일별 목표 (현재 월 기준)
  const today = kstTodayDate()
  const todayDate = new Date(today)
  const monthEndDate = new Date(end)
  const isCurrentMonth = today >= start && today <= end
  const daysLeft = isCurrentMonth
    ? Math.max(1, Math.ceil((monthEndDate.getTime() - todayDate.getTime()) / (24 * 3600 * 1000)) + 1)
    : 0
  const dailyTargetWon = daysLeft > 0 ? Math.ceil(remainingToBreakEven / daysLeft) : 0
  const dailyTargetBottles = daysLeft > 0 ? Math.ceil(remainingBottles / daysLeft) : 0

  // 8. 추세 - 일평균 매출 vs 필요 일평균
  const dayIdx = isCurrentMonth
    ? Math.max(1, Math.floor((todayDate.getTime() - new Date(start).getTime()) / (24 * 3600 * 1000)) + 1)
    : daysInMonth
  const currentDailyAvg = dayIdx > 0 ? receiptsTotal / dayIdx : 0
  const requiredDailyAvg = breakEvenRevenue / daysInMonth
  const trend: BreakEvenAnalysis["trend"] =
    currentDailyAvg >= requiredDailyAvg * 1.05 ? "ahead" :
    currentDailyAvg >= requiredDailyAvg * 0.95 ? "on_track" :
    "behind"

  return {
    store_uuid,
    year_month,
    month_start: start,
    month_end: end,
    revenue: {
      total: receiptsTotal,
      by_source: { receipts: receiptsTotal },
    },
    cost: {
      total: costTotal,
      variable: {
        total: variableTotal,
        purchases: purchasesTotal,
        expenses: expensesTotal,
      },
      fixed: {
        total: fixedTotal,
        rent,
        utilities,
        misc,
      },
    },
    net_profit: netProfit,
    break_even_analysis: {
      break_even_revenue: breakEvenRevenue,
      remaining_to_break_even: remainingToBreakEven,
      avg_margin_per_bottle: avgMarginPerBottle,
      remaining_bottles: remainingBottles,
      days_left: daysLeft,
      daily_target_won: dailyTargetWon,
      daily_target_bottles: dailyTargetBottles,
      trend,
    },
  }
}
