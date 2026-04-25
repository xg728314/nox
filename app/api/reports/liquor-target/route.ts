import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * GET /api/reports/liquor-target[?year=YYYY&month=MM]
 *
 * 2026-04-25: 양주 손익분기 현황. 월 고정비(월세+관리비+기타) 를 양주 매출로
 *   얼마나 덮었는지 계산. 남은 기간 동안 필요한 추가 병수/매출 안내.
 *
 * 설계:
 *   목표액 = auto: monthly_rent + monthly_utilities + monthly_misc
 *           manual: liquor_target_amount
 *   현재까지 양주 매출 = 이번 달 orders(order_type='주류').customer_amount 합
 *   남은 매출 = 목표 - 현재
 *   남은 일수 = 이번 달 말 - 오늘
 *   일평균 필요 매출 = 남은 매출 / 남은 일수
 *   평균 병당 매출 = 이번 달 판매 양주의 평균 customer_amount
 *                    (판매 이력 없으면 inventory_items 평균 store_price 사용)
 *   일평균 필요 병수 = 일평균 필요 매출 / 평균 병당 매출
 *
 * 응답:
 *   {
 *     year, month,
 *     days_in_month, days_elapsed, days_remaining,
 *     target: { amount, mode, fixed_costs: {rent, utilities, misc} },
 *     sold:   { total_amount, bottles_sold, avg_price_per_bottle },
 *     gap:    { remaining_amount, per_day_amount, per_day_bottles },
 *     inventory_summary: [{ item_name, sold_count, sold_amount, cost_per_unit, margin_per_unit }]
 *   }
 */
export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "권한이 없습니다." },
        { status: 403 },
      )
    }

    const url = new URL(request.url)
    const now = new Date()
    const year = Number(url.searchParams.get("year") ?? now.getFullYear())
    const month = Number(url.searchParams.get("month") ?? now.getMonth() + 1) // 1-12
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "year/month 값이 유효하지 않습니다." },
        { status: 400 },
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 해당 월의 시작/종료
    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`
    const nextMonth = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 }
    const monthEnd = new Date(nextMonth.y, nextMonth.m - 1, 1)
    monthEnd.setDate(monthEnd.getDate() - 1)
    const monthEndStr = monthEnd.toISOString().split("T")[0]
    const daysInMonth = new Date(nextMonth.y, nextMonth.m - 1, 0).getDate()

    // 오늘이 해당 월이면 elapsed = 오늘 day. 과거 달이면 daysInMonth. 미래 달이면 0.
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1
    const isPastMonth = year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)
    const daysElapsed = isPastMonth ? daysInMonth : isCurrentMonth ? now.getDate() : 0
    const daysRemaining = Math.max(0, daysInMonth - daysElapsed)

    // 1. store_settings 읽기
    const { data: settings } = await supabase
      .from("store_settings")
      .select("monthly_rent, monthly_utilities, monthly_misc, liquor_target_mode, liquor_target_amount")
      .eq("store_uuid", auth.store_uuid)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle()

    const rent = Number(settings?.monthly_rent ?? 0)
    const util = Number(settings?.monthly_utilities ?? 0)
    const misc = Number(settings?.monthly_misc ?? 0)
    const mode = settings?.liquor_target_mode === "manual" ? "manual" : "auto"
    const manualAmount = Number(settings?.liquor_target_amount ?? 0)
    const targetAmount = mode === "manual" ? manualAmount : rent + util + misc

    // 2. 이번 달 양주 매출 집계
    //    business_day_id → store_operating_days(business_date) 로 매핑.
    const { data: opDays } = await supabase
      .from("store_operating_days")
      .select("id, business_date")
      .eq("store_uuid", auth.store_uuid)
      .gte("business_date", monthStart)
      .lte("business_date", monthEndStr)
    const dayIds = (opDays ?? []).map(d => d.id)

    let soldAmount = 0
    let bottlesSold = 0
    type ItemAgg = { name: string; sold_count: number; sold_amount: number; cost_per_unit: number; margin_per_unit: number }
    const itemMap = new Map<string, ItemAgg>()

    if (dayIds.length > 0) {
      // 해당 영업일들의 세션 id
      const { data: sessions } = await supabase
        .from("room_sessions")
        .select("id")
        .eq("store_uuid", auth.store_uuid)
        .in("business_day_id", dayIds)
      const sessionIds = (sessions ?? []).map(s => s.id)

      if (sessionIds.length > 0) {
        const { data: liquorOrders } = await supabase
          .from("orders")
          .select("item_name, qty, customer_amount, inventory_item_id")
          .in("session_id", sessionIds)
          .eq("store_uuid", auth.store_uuid)
          .eq("order_type", "주류")
          .is("deleted_at", null)

        // inventory 단가 조회
        const itemIds = [...new Set(
          (liquorOrders ?? []).map(o => o.inventory_item_id).filter(Boolean) as string[],
        )]
        const { data: items } = itemIds.length > 0
          ? await supabase
              .from("inventory_items")
              .select("id, name, cost_per_unit")
              .in("id", itemIds)
          : { data: [] }
        const itemNameMap = new Map((items ?? []).map(i => [i.id, { name: i.name, cost: Number(i.cost_per_unit ?? 0) }]))

        for (const o of liquorOrders ?? []) {
          const qty = Number(o.qty ?? 1)
          const amt = Number(o.customer_amount ?? 0)
          soldAmount += amt
          bottlesSold += qty

          const key = o.inventory_item_id ?? o.item_name ?? "기타"
          const meta = o.inventory_item_id ? itemNameMap.get(o.inventory_item_id) : null
          const name = meta?.name ?? o.item_name ?? "기타"
          const cost = meta?.cost ?? 0
          const entry = itemMap.get(key) ?? {
            name,
            sold_count: 0,
            sold_amount: 0,
            cost_per_unit: cost,
            margin_per_unit: 0,
          }
          entry.sold_count += qty
          entry.sold_amount += amt
          // 평균 판매가 대비 단위 마진 (판매가/병 - 원가/병)
          const avgSale = entry.sold_count > 0 ? entry.sold_amount / entry.sold_count : 0
          entry.margin_per_unit = Math.max(0, avgSale - cost)
          itemMap.set(key, entry)
        }
      }
    }

    const avgPricePerBottle = bottlesSold > 0 ? Math.round(soldAmount / bottlesSold) : 0

    // fallback: 판매 이력 없으면 inventory 평균 store_price 사용
    let fallbackAvgPrice = avgPricePerBottle
    if (fallbackAvgPrice === 0) {
      const { data: invs } = await supabase
        .from("inventory_items")
        .select("store_price")
        .eq("store_uuid", auth.store_uuid)
        .eq("is_active", true)
        .is("deleted_at", null)
      const prices = (invs ?? []).map(i => Number(i.store_price ?? 0)).filter(p => p > 0)
      if (prices.length > 0) {
        fallbackAvgPrice = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
      }
    }

    const remainingAmount = Math.max(0, targetAmount - soldAmount)
    const perDayAmount = daysRemaining > 0 ? Math.ceil(remainingAmount / daysRemaining) : 0
    const perDayBottles =
      daysRemaining > 0 && fallbackAvgPrice > 0
        ? Math.ceil(perDayAmount / fallbackAvgPrice)
        : 0

    const inventorySummary = [...itemMap.values()]
      .sort((a, b) => b.sold_amount - a.sold_amount)
      .slice(0, 20)

    return NextResponse.json({
      year,
      month,
      days_in_month: daysInMonth,
      days_elapsed: daysElapsed,
      days_remaining: daysRemaining,
      target: {
        amount: targetAmount,
        mode,
        fixed_costs: { rent, utilities: util, misc },
      },
      sold: {
        total_amount: soldAmount,
        bottles_sold: bottlesSold,
        avg_price_per_bottle: avgPricePerBottle || fallbackAvgPrice,
      },
      gap: {
        remaining_amount: remainingAmount,
        per_day_amount: perDayAmount,
        per_day_bottles: perDayBottles,
        achieved_ratio: targetAmount > 0 ? Math.min(1, soldAmount / targetAmount) : 0,
      },
      inventory_summary: inventorySummary,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "예상치 못한 오류." }, { status: 500 })
  }
}
