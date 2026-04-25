import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { archivedAtFilter } from "@/lib/session/archivedFilter"

/**
 * GET /api/reports/period?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * 2026-04-25: 일일 리포트 외에 기간 집계 (월/주/임의 기간) 지원.
 *   세무사 제출용, 영업 흐름 분석용. owner + manager.
 *
 * 응답:
 *   {
 *     from, to,
 *     day_count: 영업일 수,
 *     totals: { session_count, gross_total, order_total, participant_total,
 *               tc_total, margin_total, manager_total, hostess_total },
 *     daily: [{ business_date, gross_total, order_total, ... }]  // 일자별 bars,
 *     top_managers: [{ membership_id, name, sessions, total_price, total_payout }],
 *     top_hostesses: [...]
 *   }
 *
 * owner 는 manager/hostess 개별 수익을 manager toggle 에 따라 비노출.
 */
export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)
    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "권한이 없습니다." },
        { status: 403 },
      )
    }

    const url = new URL(request.url)
    const from = url.searchParams.get("from")
    const to = url.searchParams.get("to")
    if (!from || !to) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "from, to 쿼리 파라미터(YYYY-MM-DD) 필수." },
        { status: 400 },
      )
    }
    const fromDate = new Date(from)
    const toDate = new Date(to)
    if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime())) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "날짜 형식이 올바르지 않습니다." },
        { status: 400 },
      )
    }
    if (fromDate > toDate) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "from 이 to 보다 늦을 수 없습니다." },
        { status: 400 },
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. 기간 내 business_days
    const { data: days, error: dayErr } = await supabase
      .from("store_operating_days")
      .select("id, business_date")
      .eq("store_uuid", authContext.store_uuid)
      .gte("business_date", from)
      .lte("business_date", to)
      .order("business_date", { ascending: true })

    if (dayErr) {
      return NextResponse.json(
        { error: "QUERY_FAILED", message: "영업일 조회 실패." },
        { status: 500 },
      )
    }

    const dayIds = (days ?? []).map(d => d.id)
    if (dayIds.length === 0) {
      return NextResponse.json({
        from, to,
        day_count: 0,
        totals: {
          session_count: 0, gross_total: 0, order_total: 0, participant_total: 0,
          tc_total: 0, margin_total: 0, manager_total: 0, hostess_total: 0,
        },
        daily: [],
        top_managers: [],
        top_hostesses: [],
      })
    }

    // 2. receipts 집계 — archive 된 영수증은 월간 리포트에서도 제외.
    const applyArchivedNull = await archivedAtFilter(supabase, "receipts")
    const { data: receipts } = await applyArchivedNull(
      supabase
        .from("receipts")
        .select("id, business_day_id, session_id, gross_total, tc_amount, manager_amount, hostess_amount, margin_amount, order_total_amount, participant_total_amount, status")
        .eq("store_uuid", authContext.store_uuid)
        .in("business_day_id", dayIds)
    )

    const receiptList = receipts ?? []

    // 일자별 맵
    const dayMap = new Map<string, { business_date: string; session_count: number; gross_total: number; order_total: number; participant_total: number; manager_total: number; hostess_total: number }>()
    for (const d of days ?? []) {
      dayMap.set(d.id, {
        business_date: d.business_date,
        session_count: 0, gross_total: 0, order_total: 0, participant_total: 0,
        manager_total: 0, hostess_total: 0,
      })
    }

    const totals = {
      session_count: 0, gross_total: 0, order_total: 0, participant_total: 0,
      tc_total: 0, margin_total: 0, manager_total: 0, hostess_total: 0,
    }
    for (const r of receiptList) {
      totals.session_count += 1
      totals.gross_total += Number(r.gross_total ?? 0)
      totals.tc_total += Number(r.tc_amount ?? 0)
      totals.manager_total += Number(r.manager_amount ?? 0)
      totals.hostess_total += Number(r.hostess_amount ?? 0)
      totals.margin_total += Number(r.margin_amount ?? 0)
      totals.order_total += Number(r.order_total_amount ?? 0)
      totals.participant_total += Number(r.participant_total_amount ?? 0)

      const bucket = dayMap.get(r.business_day_id)
      if (bucket) {
        bucket.session_count += 1
        bucket.gross_total += Number(r.gross_total ?? 0)
        bucket.order_total += Number(r.order_total_amount ?? 0)
        bucket.participant_total += Number(r.participant_total_amount ?? 0)
        bucket.manager_total += Number(r.manager_amount ?? 0)
        bucket.hostess_total += Number(r.hostess_amount ?? 0)
      }
    }

    const daily = Array.from(dayMap.values())

    // 3. Top 실장/스태프 (session_participants 집계)
    const sessionIds = receiptList.map(r => r.session_id)
    let topManagers: Array<{ membership_id: string; name: string; sessions: number; total_price: number; total_payout: number }> = []
    let topHostesses: Array<{ membership_id: string; name: string; sessions: number; total_price: number; total_payout: number }> = []

    if (sessionIds.length > 0) {
      const { data: parts } = await supabase
        .from("session_participants")
        .select("membership_id, role, price_amount, manager_payout_amount, hostess_payout_amount")
        .eq("store_uuid", authContext.store_uuid)
        .in("session_id", sessionIds)

      const partMap = new Map<string, { role: string; sessions: number; total_price: number; total_payout: number }>()
      for (const p of parts ?? []) {
        const key = p.membership_id
        if (!key) continue
        const entry = partMap.get(key) ?? { role: p.role, sessions: 0, total_price: 0, total_payout: 0 }
        entry.sessions += 1
        entry.total_price += Number(p.price_amount ?? 0)
        if (p.role === "manager") {
          entry.total_payout += Number(p.manager_payout_amount ?? 0)
        } else {
          entry.total_payout += Number(p.hostess_payout_amount ?? 0)
        }
        partMap.set(key, entry)
      }

      // 이름 lookup
      const memberIds = [...partMap.keys()]
      const { data: memberships } = await supabase
        .from("store_memberships")
        .select("id, profile_id")
        .in("id", memberIds)
      const profileIds = (memberships ?? []).map(m => m.profile_id).filter(Boolean) as string[]
      const { data: profiles } = profileIds.length > 0
        ? await supabase.from("profiles").select("id, name").in("id", profileIds)
        : { data: [] as Array<{ id: string; name: string }> }
      const profileMap = new Map((profiles ?? []).map(p => [p.id, p.name]))
      const nameByMembership = new Map<string, string>()
      for (const m of memberships ?? []) {
        const n = profileMap.get(m.profile_id as string) ?? ""
        nameByMembership.set(m.id, n)
      }

      const rows = [...partMap.entries()].map(([membership_id, e]) => ({
        membership_id,
        name: nameByMembership.get(membership_id) ?? "",
        role: e.role,
        sessions: e.sessions,
        total_price: e.total_price,
        total_payout: e.total_payout,
      }))
      const byPayout = (a: { total_payout: number }, b: { total_payout: number }) =>
        b.total_payout - a.total_payout
      topManagers = rows.filter(r => r.role === "manager").sort(byPayout).slice(0, 10)
        .map(({ membership_id, name, sessions, total_price, total_payout }) => ({ membership_id, name, sessions, total_price, total_payout }))
      topHostesses = rows.filter(r => r.role === "hostess").sort(byPayout).slice(0, 10)
        .map(({ membership_id, name, sessions, total_price, total_payout }) => ({ membership_id, name, sessions, total_price, total_payout }))
    }

    // owner 권한 게이트 — per-manager 마스킹.
    // R28-fix: 이전 OR-merge 는 한 매니저가 share=true 면 전체 노출. 비공개
    //   원하는 다른 매니저 수익까지 보임. per-row 마스킹으로 변경.
    if (authContext.role === "owner") {
      const { data: mgrRows } = await supabase
        .from("managers")
        .select("membership_id, show_profit_to_owner, show_hostess_profit_to_owner")
        .eq("store_uuid", authContext.store_uuid)
      const mgrShareSelf = new Set<string>()
      const mgrShareHostess = new Set<string>()
      for (const m of (mgrRows ?? []) as Array<{ membership_id: string; show_profit_to_owner: boolean; show_hostess_profit_to_owner: boolean }>) {
        if (m.show_profit_to_owner) mgrShareSelf.add(m.membership_id)
        if (m.show_hostess_profit_to_owner) mgrShareHostess.add(m.membership_id)
      }

      const { data: hostessRows } = await supabase
        .from("hostesses")
        .select("membership_id, manager_membership_id")
        .eq("store_uuid", authContext.store_uuid)
      const hostessToManager = new Map<string, string>()
      for (const h of (hostessRows ?? []) as Array<{ membership_id: string; manager_membership_id: string | null }>) {
        if (h.manager_membership_id) hostessToManager.set(h.membership_id, h.manager_membership_id)
      }

      // top lists — 비공개 매니저/속한 hostess 의 payout 만 마스킹 (이름·세션 수는 유지).
      for (const t of topManagers) {
        if (!mgrShareSelf.has(t.membership_id)) {
          (t as { total_payout?: number }).total_payout = undefined as unknown as number
        }
      }
      for (const t of topHostesses) {
        const mgr = hostessToManager.get(t.membership_id)
        if (!mgr || !mgrShareHostess.has(mgr)) {
          (t as { total_payout?: number }).total_payout = undefined as unknown as number
        }
      }

      // 집계는 단순화: 모든 매니저가 share=true 일 때만 노출, 아니면 제거.
      //   per-row 합산은 무거움. 보수적으로 "전부 동의시만".
      const allMgrShareSelf = (mgrRows ?? []).every(m => (m as { show_profit_to_owner: boolean }).show_profit_to_owner)
      const allMgrShareHostess = (mgrRows ?? []).every(m => (m as { show_hostess_profit_to_owner: boolean }).show_hostess_profit_to_owner)
      if (!allMgrShareSelf) {
        delete (totals as { manager_total?: number }).manager_total
        for (const d of daily) (d as { manager_total?: number }).manager_total = undefined as unknown as number
      }
      if (!allMgrShareHostess) {
        delete (totals as { hostess_total?: number }).hostess_total
        for (const d of daily) (d as { hostess_total?: number }).hostess_total = undefined as unknown as number
      }
    }

    return NextResponse.json({
      from, to,
      day_count: dayIds.length,
      totals,
      daily,
      top_managers: topManagers,
      top_hostesses: topHostesses,
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
