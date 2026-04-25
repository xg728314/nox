import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { resolveAdminScope } from "@/lib/auth/resolveAdminScope"
import { createClient } from "@supabase/supabase-js"
import { getBusinessDateForOps } from "@/lib/time/businessDate"

/**
 * GET /api/super-admin/stores/[store_uuid]
 *
 * Per-store monitoring snapshot for super_admin. Read-only.
 *
 * Returns:
 *   - store basic info (name, floor, active state)
 *   - today's business_day status
 *   - rooms with their active+closed session summaries (same shape as
 *     /api/rooms for familiarity)
 *   - today's rolling KPIs (sessions count, gross, unsettled count)
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ store_uuid: string }> }
) {
  try {
    const authContext = await resolveAuthContext(request)

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: "SERVER_CONFIG_ERROR", message: "Supabase env missing." },
        { status: 500 }
      )
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { store_uuid: pathStoreUuid } = await params
    const scope = await resolveAdminScope({
      auth: authContext,
      supabase,
      request,
      screen: "super-admin/store-monitor",
      requiredTargetFromPath: pathStoreUuid,
      actionKind: "read",
      actionDetail: "store_monitor_read",
    })
    if (!scope.ok) return scope.error
    const scopeStoreUuid = scope.scopeStoreUuid

    // 1) Store row
    const { data: storeRow } = await supabase
      .from("stores")
      .select("id, store_name, store_code, floor, is_active, created_at")
      .eq("id", scopeStoreUuid)
      .is("deleted_at", null)
      .maybeSingle()
    if (!storeRow) {
      return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 })
    }

    // 2) Today's business_day
    const today = getBusinessDateForOps()
    const { data: bizDay } = await supabase
      .from("store_operating_days")
      .select("id, business_date, status, opened_at, closed_at")
      .eq("store_uuid", scopeStoreUuid)
      .eq("business_date", today)
      .maybeSingle()

    // 3) Rooms + active & recently closed sessions (mirror /api/rooms)
    const { data: rooms } = await supabase
      .from("rooms")
      .select("id, room_no, room_name, is_active")
      .eq("store_uuid", scopeStoreUuid)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true })

    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
    const { data: allSessions } = await supabase
      .from("room_sessions")
      .select("id, room_uuid, status, started_at, ended_at, manager_name, customer_name_snapshot, customer_party_size, business_day_id")
      .eq("store_uuid", scopeStoreUuid)
      .in("status", ["active", "closed"])
      .is("deleted_at", null)

    const activeSessions = (allSessions ?? []).filter((s) => s.status === "active")
    const closedSessions = (allSessions ?? []).filter(
      (s) => s.status === "closed" && s.ended_at && (s.ended_at as string) > sixHoursAgo
    )

    type SessionInfo = {
      id: string
      status: string
      started_at: string
      ended_at: string | null
      participant_count: number
      gross_total: number
      participant_total: number
      order_total: number
      manager_name: string | null
      customer_name_snapshot: string | null
      customer_party_size: number
    }
    const activeMap = new Map<string, SessionInfo>()
    const closedMap = new Map<string, SessionInfo>()

    const sessionIds = [...activeSessions, ...closedSessions].map((s) => s.id as string)
    const partCount = new Map<string, number>()
    const partTotal = new Map<string, number>()
    const orderTotal = new Map<string, number>()

    if (sessionIds.length > 0) {
      const [{ data: parts }, { data: ords }] = await Promise.all([
        supabase
          .from("session_participants")
          .select("session_id, price_amount")
          .in("session_id", sessionIds)
          .eq("store_uuid", scopeStoreUuid)
          .is("deleted_at", null),
        supabase
          .from("orders")
          .select("session_id, customer_amount")
          .in("session_id", sessionIds)
          .eq("store_uuid", scopeStoreUuid)
          .is("deleted_at", null),
      ])
      for (const p of parts ?? []) {
        const sid = p.session_id as string
        partCount.set(sid, (partCount.get(sid) ?? 0) + 1)
        partTotal.set(sid, (partTotal.get(sid) ?? 0) + ((p.price_amount as number) ?? 0))
      }
      for (const o of ords ?? []) {
        const sid = o.session_id as string
        orderTotal.set(sid, (orderTotal.get(sid) ?? 0) + ((o.customer_amount as number) ?? 0))
      }
    }

    for (const s of activeSessions) {
      const sid = s.id as string
      const pT = partTotal.get(sid) ?? 0
      const oT = orderTotal.get(sid) ?? 0
      activeMap.set(s.room_uuid as string, {
        id: sid,
        status: s.status as string,
        started_at: s.started_at as string,
        ended_at: (s.ended_at as string) ?? null,
        participant_count: partCount.get(sid) ?? 0,
        gross_total: pT + oT,
        participant_total: pT,
        order_total: oT,
        manager_name: (s.manager_name as string) ?? null,
        customer_name_snapshot: (s.customer_name_snapshot as string) ?? null,
        customer_party_size: ((s.customer_party_size as number) ?? 0),
      })
    }
    for (const s of closedSessions) {
      const sid = s.id as string
      const pT = partTotal.get(sid) ?? 0
      const oT = orderTotal.get(sid) ?? 0
      closedMap.set(s.room_uuid as string, {
        id: sid,
        status: s.status as string,
        started_at: s.started_at as string,
        ended_at: (s.ended_at as string) ?? null,
        participant_count: partCount.get(sid) ?? 0,
        gross_total: pT + oT,
        participant_total: pT,
        order_total: oT,
        manager_name: (s.manager_name as string) ?? null,
        customer_name_snapshot: (s.customer_name_snapshot as string) ?? null,
        customer_party_size: ((s.customer_party_size as number) ?? 0),
      })
    }

    const roomsWithSessions = (rooms ?? []).map((r) => ({
      id: r.id as string,
      room_no: r.room_no as string,
      room_name: r.room_name as string,
      is_active: !!r.is_active,
      session: activeMap.get(r.id as string) ?? null,
      closed_session: closedMap.get(r.id as string) ?? null,
    }))

    // 4) Today rolling KPIs from receipts of today's business_day
    let totalSessionsToday = 0
    let totalGrossToday = 0
    let finalizedCount = 0
    let draftCount = 0
    let unsettledCount = 0
    if (bizDay?.id) {
      const { data: todaySessions } = await supabase
        .from("room_sessions")
        .select("id")
        .eq("store_uuid", scopeStoreUuid)
        .eq("business_day_id", bizDay.id as string)
      const todayIds = (todaySessions ?? []).map((s) => s.id as string)
      totalSessionsToday = todayIds.length

      const { data: todayReceipts } = await supabase
        .from("receipts")
        .select("session_id, status, gross_total, version")
        .eq("store_uuid", scopeStoreUuid)
        .eq("business_day_id", bizDay.id as string)
        .order("version", { ascending: false })
      const latestBySession = new Map<string, { status: string; gross_total: number }>()
      for (const r of todayReceipts ?? []) {
        if (!latestBySession.has(r.session_id as string)) {
          latestBySession.set(r.session_id as string, {
            status: r.status as string,
            gross_total: (r.gross_total as number) ?? 0,
          })
        }
      }
      for (const r of latestBySession.values()) {
        totalGrossToday += r.gross_total ?? 0
        if (r.status === "finalized") finalizedCount++
        if (r.status === "draft") draftCount++
      }
      unsettledCount = totalSessionsToday - latestBySession.size
    }

    return NextResponse.json({
      store: {
        id: storeRow.id,
        store_name: storeRow.store_name,
        store_code: storeRow.store_code,
        floor: storeRow.floor,
        is_active: storeRow.is_active,
      },
      business_day: bizDay
        ? {
            id: bizDay.id,
            business_date: bizDay.business_date,
            status: bizDay.status,
            opened_at: bizDay.opened_at ?? null,
            closed_at: bizDay.closed_at ?? null,
          }
        : null,
      rooms: roomsWithSessions,
      kpis_today: {
        total_sessions: totalSessionsToday,
        gross_total: totalGrossToday,
        finalized_count: finalizedCount,
        draft_count: draftCount,
        unsettled_count: unsettledCount,
      },
      viewer: {
        is_super_admin: true,
        cross_store: scope.isCrossStore,
      },
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" ? 401 :
        error.type === "AUTH_INVALID" ? 401 :
        error.type === "MEMBERSHIP_NOT_FOUND" ? 403 :
        error.type === "MEMBERSHIP_INVALID" ? 403 :
        error.type === "MEMBERSHIP_NOT_APPROVED" ? 403 :
        error.type === "SERVER_CONFIG_ERROR" ? 500 :
        500
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Unexpected error." }, { status: 500 })
  }
}
