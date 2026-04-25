import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { archivedAtFilter } from "@/lib/session/archivedFilter"

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    // owner/manager only
    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to view daily reports." },
        { status: 403 }
      )
    }

    const url = new URL(request.url)
    const businessDayId = url.searchParams.get("business_day_id")

    if (!businessDayId) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "business_day_id query param is required." },
        { status: 400 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. Verify business_day belongs to store
    const { data: opDay, error: opError } = await supabase
      .from("store_operating_days")
      .select("id, business_date, status")
      .eq("id", businessDayId)
      .eq("store_uuid", authContext.store_uuid)
      .single()

    if (opError || !opDay) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "Operating day not found." },
        { status: 404 }
      )
    }

    // 2. Receipts by session (session-level settlement summaries)
    // 2026-04-25: archive 된 영수증 제외. 인쇄+archive 이후 리포트 중복 집계 차단.
    const applyArchivedNull = await archivedAtFilter(supabase, "receipts")
    const { data: receipts } = await applyArchivedNull(
      supabase
        .from("receipts")
        .select("id, session_id, gross_total, tc_amount, manager_amount, hostess_amount, margin_amount, order_total_amount, participant_total_amount, status")
        .eq("store_uuid", authContext.store_uuid)
        .eq("business_day_id", businessDayId)
    )

    const receiptList = receipts ?? []

    // Totals
    const totals = {
      session_count: receiptList.length,
      gross_total: 0,
      tc_total: 0,
      manager_total: 0,
      hostess_total: 0,
      margin_total: 0,
      order_total: 0,
      participant_total: 0,
    }
    for (const r of receiptList) {
      totals.gross_total += r.gross_total ?? 0
      totals.tc_total += r.tc_amount ?? 0
      totals.manager_total += r.manager_amount ?? 0
      totals.hostess_total += r.hostess_amount ?? 0
      totals.margin_total += r.margin_amount ?? 0
      totals.order_total += r.order_total_amount ?? 0
      totals.participant_total += r.participant_total_amount ?? 0
    }

    // 3. Participant-level breakdown by membership (manager/hostess payouts)
    const { data: participants } = await supabase
      .from("session_participants")
      .select("membership_id, role, category, time_minutes, price_amount, manager_payout_amount, hostess_payout_amount, margin_amount")
      .eq("store_uuid", authContext.store_uuid)
      .in("session_id", receiptList.map(r => r.session_id))

    // Group by membership_id + role
    const staffMap = new Map<string, {
      membership_id: string
      role: string
      sessions: number
      total_price: number
      total_payout: number
    }>()

    for (const p of (participants ?? [])) {
      const key = p.membership_id
      if (!staffMap.has(key)) {
        staffMap.set(key, {
          membership_id: p.membership_id,
          role: p.role,
          sessions: 0,
          total_price: 0,
          total_payout: 0,
        })
      }
      const entry = staffMap.get(key)!
      entry.sessions += 1
      entry.total_price += p.price_amount ?? 0
      // R28-fix: NUMERIC 가 string 으로 오는 경우 string concat 방어 (Number 캐스트).
      if (p.role === "manager") {
        entry.total_payout += Number(p.manager_payout_amount ?? 0) || 0
      } else {
        entry.total_payout += Number(p.hostess_payout_amount ?? 0) || 0
      }
    }

    // Split into manager/hostess arrays
    const managerBreakdown = [...staffMap.values()].filter(s => s.role === "manager")
    const hostessBreakdown = [...staffMap.values()].filter(s => s.role === "hostess")

    // Owner visibility: per-manager 토글.
    // R28-fix: 이전엔 "한 명이라도 share=true 면 전체 노출" 패턴이라 거부한
    //   다른 실장 수익도 owner 가 봄. 매니저별 per-row 마스킹으로 변경.
    //
    //   집계 manager_total/hostess_total 은 share=true 인 매니저들의 수익만
    //   포함 (그 매니저의 hostess 수익까지). 거부한 매니저 row 는 0 으로 가정.
    //   manager_breakdown / hostess_breakdown 도 share=true 인 매니저 본인/
    //   소속 hostess 만 노출.
    if (authContext.role === "owner") {
      // 1) 매니저별 visibility map. 동시에 hostess->manager 매핑.
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

      // 2) hostess -> manager 매핑 (해당 호스티스의 owner_view 가능 여부 결정).
      const { data: hostessRows } = await supabase
        .from("hostesses")
        .select("membership_id, manager_membership_id")
        .eq("store_uuid", authContext.store_uuid)
      const hostessToManager = new Map<string, string>()
      for (const h of (hostessRows ?? []) as Array<{ membership_id: string; manager_membership_id: string | null }>) {
        if (h.manager_membership_id) hostessToManager.set(h.membership_id, h.manager_membership_id)
      }

      // 3) 매니저별 마스킹된 합계 재계산 (per-row).
      let ownerManagerTotal = 0
      let ownerHostessTotal = 0
      for (const p of (participants ?? [])) {
        if (p.role === "manager") {
          if (mgrShareSelf.has(p.membership_id)) {
            ownerManagerTotal += Number(p.manager_payout_amount ?? 0) || 0
          }
        } else {
          // hostess: 본인이 속한 매니저가 hostess profit share 허용했으면 포함
          const ownerMgr = hostessToManager.get(p.membership_id)
          if (ownerMgr && mgrShareHostess.has(ownerMgr)) {
            ownerHostessTotal += Number(p.hostess_payout_amount ?? 0) || 0
          }
        }
      }

      const ownerTotals: Record<string, number> = {
        session_count: totals.session_count,
        gross_total: totals.gross_total,
        tc_total: totals.tc_total,
        margin_total: totals.margin_total,
        order_total: totals.order_total,
        participant_total: totals.participant_total,
        manager_total: ownerManagerTotal,
        hostess_total: ownerHostessTotal,
      }

      // 4) receipt 별 마스킹 — 어떤 매니저가 그 세션을 담당했는지 모르면
      //    안전하게 0. 구현 단순화 위해 receipt 단위 manager/hostess
      //    개별 amount 는 owner 응답에서 제외 (집계만 노출).
      const ownerReceipts = receiptList.map((r: { id: string; session_id: string; gross_total: number; tc_amount: number; manager_amount: number; hostess_amount: number; margin_amount: number; order_total_amount: number; participant_total_amount: number; status: string }) => ({
        id: r.id,
        session_id: r.session_id,
        gross_total: r.gross_total,
        tc_amount: r.tc_amount,
        margin_amount: r.margin_amount,
        order_total_amount: r.order_total_amount,
        participant_total_amount: r.participant_total_amount,
        status: r.status,
      }))

      // 5) breakdown — 본인이 share=true 인 매니저, share=true 매니저의 hostess 만.
      const ownerManagerBreakdown = managerBreakdown.filter(s => mgrShareSelf.has(s.membership_id))
      const ownerHostessBreakdown = hostessBreakdown.filter(s => {
        const mgr = hostessToManager.get(s.membership_id)
        return mgr ? mgrShareHostess.has(mgr) : false
      })

      return NextResponse.json({
        business_day_id: businessDayId,
        business_date: opDay.business_date,
        day_status: opDay.status,
        totals: ownerTotals,
        receipts: ownerReceipts,
        manager_breakdown: ownerManagerBreakdown,
        hostess_breakdown: ownerHostessBreakdown,
      })
    }

    return NextResponse.json({
      business_day_id: businessDayId,
      business_date: opDay.business_date,
      day_status: opDay.status,
      totals,
      receipts: receiptList,
      manager_breakdown: managerBreakdown,
      hostess_breakdown: hostessBreakdown,
    })

  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" ? 401 :
        error.type === "AUTH_INVALID" ? 401 :
        error.type === "MEMBERSHIP_NOT_FOUND" ? 403 :
        error.type === "MEMBERSHIP_INVALID" ? 403 :
        error.type === "MEMBERSHIP_NOT_APPROVED" ? 403 :
        error.type === "SERVER_CONFIG_ERROR" ? 500 : 500
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Unexpected error." }, { status: 500 })
  }
}
