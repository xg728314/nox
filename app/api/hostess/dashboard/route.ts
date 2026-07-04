/**
 * GET /api/hostess/dashboard
 *
 * 아가씨 본인 대시보드 데이터.
 *   - 오늘 내 참여 (매출/타임)
 *   - 이번 주 (7일) 참여 (매출/타임) + 전주 대비
 *   - 지금 일하는 세션 (있으면)
 *   - 대기중 정산 (paid/held 아직 안 된 건)
 *
 * 권한: role='hostess' 만.
 *
 * R-hostess-app (2026-06-28).
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { getBusinessDateForOps } from "@/lib/time/businessDate"

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "hostess") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const supabase = getServiceClient()
    const mid = auth.membership_id
    const now = Date.now()

    // 시각 범위
    const today = getBusinessDateForOps()
    const todayStart = new Date(`${today}T06:00:00+09:00`)
    const todayEnd = new Date(todayStart)
    todayEnd.setUTCDate(todayEnd.getUTCDate() + 1)
    const weekStart = new Date(todayStart)
    weekStart.setUTCDate(weekStart.getUTCDate() - 6)
    const prevWeekStart = new Date(weekStart)
    prevWeekStart.setUTCDate(prevWeekStart.getUTCDate() - 7)

    // 최근 14일 참여 (전주 대비 계산 위해)
    const { data: parts } = await supabase
      .from("session_participants")
      .select(
        "id, session_id, store_uuid, category, time_minutes, price_amount, hostess_payout_amount, status, entered_at, left_at, payout_settled_at",
      )
      .eq("membership_id", mid)
      .gte("entered_at", prevWeekStart.toISOString())
      .is("deleted_at", null)
      .order("entered_at", { ascending: false })

    type Part = {
      id: string
      session_id: string
      store_uuid: string
      category: string | null
      time_minutes: number | null
      price_amount: number | null
      hostess_payout_amount: number | null
      status: string
      entered_at: string
      left_at: string | null
      payout_settled_at: string | null
    }
    const rows = (parts ?? []) as Part[]

    // 오늘 / 이번 주 / 전주 집계
    let todayGross = 0
    let todayPayout = 0
    let todayCount = 0
    let weekGross = 0
    let weekCount = 0
    let prevWeekGross = 0
    for (const p of rows) {
      const enteredMs = new Date(p.entered_at).getTime()
      const gross = Number(p.price_amount ?? 0)
      const payout = Number(p.hostess_payout_amount ?? 0)
      if (enteredMs >= todayStart.getTime() && enteredMs < todayEnd.getTime()) {
        todayGross += gross
        todayPayout += payout
        todayCount++
      }
      if (enteredMs >= weekStart.getTime()) {
        weekGross += gross
        weekCount++
      } else if (enteredMs >= prevWeekStart.getTime()) {
        prevWeekGross += gross
      }
    }

    // 지금 일하는 세션
    const currentPart = rows.find((p) => p.status === "active")
    let current: {
      participant_id: string
      session_id: string
      category: string | null
      time_minutes: number | null
      entered_at: string
      remaining_minutes: number | null
      store_name: string | null
    } | null = null
    if (currentPart) {
      let remaining: number | null = null
      if (currentPart.time_minutes != null) {
        const endMs = new Date(currentPart.entered_at).getTime() + currentPart.time_minutes * 60_000
        remaining = Math.max(-999, Math.floor((endMs - now) / 60_000))
      }
      // 매장명
      const { data: st } = await supabase
        .from("stores")
        .select("store_name")
        .eq("id", currentPart.store_uuid)
        .maybeSingle()
      current = {
        participant_id: currentPart.id,
        session_id: currentPart.session_id,
        category: currentPart.category,
        time_minutes: currentPart.time_minutes,
        entered_at: currentPart.entered_at,
        remaining_minutes: remaining,
        store_name: (st as { store_name: string } | null)?.store_name ?? null,
      }
    }

    // 대기중 정산 (payout_settled_at 없음 + status='left')
    const pending = rows.filter(
      (p) => p.status === "left" && !p.payout_settled_at,
    )
    const pendingTotal = pending.reduce(
      (a, p) => a + Number(p.hostess_payout_amount ?? 0),
      0,
    )

    return NextResponse.json({
      today: {
        date: today,
        gross: todayGross,
        payout: todayPayout,
        count: todayCount,
      },
      week: {
        gross: weekGross,
        count: weekCount,
        prev_week_gross: prevWeekGross,
      },
      current,
      pending: {
        count: pending.length,
        total: pendingTotal,
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
