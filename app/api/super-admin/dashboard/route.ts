import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { getBusinessDateForOps } from "@/lib/time/businessDate"

/**
 * GET /api/super-admin/dashboard
 *
 * Global read-only dashboard for super_admin. Aggregates across EVERY
 * non-deleted store. Non-super_admin callers receive 403.
 *
 * Response shape:
 *   {
 *     summary: {
 *       total_stores, open_stores, active_sessions, active_rooms,
 *       gross_total_today, credit_outstanding, unsettled_count,
 *     },
 *     floors: [
 *       { floor: 5, stores: [ ...store summary... ] },
 *       ...
 *     ],
 *   }
 *
 * No business-rule mutation, no settlement recalculation — reads existing
 * aggregates from `receipts`, `room_sessions`, `credits`.
 */
export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)
    if (!authContext.is_super_admin) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Super admin access required." },
        { status: 403 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: "SERVER_CONFIG_ERROR", message: "Supabase env missing." },
        { status: 500 }
      )
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1) All active stores
    const { data: stores, error: storesErr } = await supabase
      .from("stores")
      .select("id, store_name, store_code, floor, is_active")
      .is("deleted_at", null)
      .order("floor", { ascending: true, nullsFirst: false })
      .order("store_name", { ascending: true })
    if (storesErr || !stores) {
      return NextResponse.json({ error: "QUERY_FAILED", message: "stores query failed." }, { status: 500 })
    }

    const storeIds = stores.map((s) => s.id)

    // 2) Today's business_days across all stores
    const today = getBusinessDateForOps()
    const { data: bizDays } = await supabase
      .from("store_operating_days")
      .select("id, store_uuid, business_date, status")
      .in("store_uuid", storeIds)
      .eq("business_date", today)

    const bizDayByStore = new Map<string, { id: string; status: string }>()
    for (const d of bizDays ?? []) {
      bizDayByStore.set(d.store_uuid as string, { id: d.id as string, status: d.status as string })
    }
    const todayBizDayIds = (bizDays ?? []).map((d) => d.id as string)

    // 3) Active sessions (status='active') across all stores — current open rooms
    const { data: activeSessionsRaw } = await supabase
      .from("room_sessions")
      .select("id, store_uuid, status, room_uuid")
      .in("store_uuid", storeIds)
      .eq("status", "active")
      .is("deleted_at", null)

    const activeSessionsByStore = new Map<string, number>()
    const activeRoomsByStore = new Map<string, Set<string>>()
    for (const s of activeSessionsRaw ?? []) {
      const sid = s.store_uuid as string
      activeSessionsByStore.set(sid, (activeSessionsByStore.get(sid) ?? 0) + 1)
      if (!activeRoomsByStore.has(sid)) activeRoomsByStore.set(sid, new Set())
      activeRoomsByStore.get(sid)!.add(s.room_uuid as string)
    }

    // 4) Today's closed sessions across all stores (for checkout-pending / settlement-pending)
    const todaySessionsByStore = new Map<string, string[]>()
    let receiptMap = new Map<string, { session_id: string; store_uuid: string; status: string; gross_total: number }>()
    if (todayBizDayIds.length > 0) {
      const { data: todaySessions } = await supabase
        .from("room_sessions")
        .select("id, store_uuid, status, business_day_id")
        .in("business_day_id", todayBizDayIds)
        .is("deleted_at", null)
      for (const s of todaySessions ?? []) {
        const arr = todaySessionsByStore.get(s.store_uuid as string) ?? []
        arr.push(s.id as string)
        todaySessionsByStore.set(s.store_uuid as string, arr)
      }

      const { data: todayReceipts } = await supabase
        .from("receipts")
        .select("session_id, store_uuid, status, gross_total, version")
        .in("business_day_id", todayBizDayIds)
        .order("version", { ascending: false })
      const latestByReceiptSession = new Map<string, { session_id: string; store_uuid: string; status: string; gross_total: number }>()
      for (const r of todayReceipts ?? []) {
        if (!latestByReceiptSession.has(r.session_id as string)) {
          latestByReceiptSession.set(r.session_id as string, {
            session_id: r.session_id as string,
            store_uuid: r.store_uuid as string,
            status: r.status as string,
            gross_total: (r.gross_total as number) ?? 0,
          })
        }
      }
      receiptMap = latestByReceiptSession
    }

    // 5) Pending credits (status='pending') — outstanding external debt
    const { data: pendingCredits } = await supabase
      .from("credits")
      .select("store_uuid, amount")
      .in("store_uuid", storeIds)
      .eq("status", "pending")
      .is("deleted_at", null)
    const creditByStore = new Map<string, number>()
    for (const c of pendingCredits ?? []) {
      const v = (c.amount as number) ?? 0
      creditByStore.set(c.store_uuid as string, (creditByStore.get(c.store_uuid as string) ?? 0) + v)
    }

    // 6) Per-store derived summary
    type StoreCard = {
      store_uuid: string
      store_name: string
      store_code: string | null
      floor: number | null
      is_active: boolean
      business_day_id: string | null
      business_day_status: string | null
      active_rooms: number
      active_sessions: number
      checkout_pending: number  // today's closed sessions without any receipt yet
      unsettled_count: number   // today's sessions whose latest receipt is not finalized
      gross_total_today: number
      credit_outstanding: number
    }
    const storeCards: StoreCard[] = stores.map((s) => {
      const bizDay = bizDayByStore.get(s.id as string) ?? null
      const todaySessionIds = todaySessionsByStore.get(s.id as string) ?? []
      let storeGross = 0
      let unsettled = 0
      let checkoutPending = 0
      for (const sid of todaySessionIds) {
        const r = receiptMap.get(sid)
        if (r) {
          storeGross += r.gross_total ?? 0
          if (r.status !== "finalized") unsettled++
        } else {
          // Session exists but no receipt generated yet
          checkoutPending++
        }
      }
      return {
        store_uuid: s.id as string,
        store_name: s.store_name as string,
        store_code: (s.store_code as string) ?? null,
        floor: (s.floor as number) ?? null,
        is_active: !!s.is_active,
        business_day_id: bizDay?.id ?? null,
        business_day_status: bizDay?.status ?? null,
        active_rooms: activeRoomsByStore.get(s.id as string)?.size ?? 0,
        active_sessions: activeSessionsByStore.get(s.id as string) ?? 0,
        checkout_pending: checkoutPending,
        unsettled_count: unsettled,
        gross_total_today: storeGross,
        credit_outstanding: creditByStore.get(s.id as string) ?? 0,
      }
    })

    // 7) Global KPIs
    const openStores = storeCards.filter((c) => c.business_day_status === "open").length
    const totalActiveSessions = storeCards.reduce((a, c) => a + c.active_sessions, 0)
    const totalActiveRooms = storeCards.reduce((a, c) => a + c.active_rooms, 0)
    const totalGross = storeCards.reduce((a, c) => a + c.gross_total_today, 0)
    const totalCredit = storeCards.reduce((a, c) => a + c.credit_outstanding, 0)
    const totalUnsettled = storeCards.reduce((a, c) => a + c.unsettled_count, 0)

    // 8) Group by floor
    const byFloor = new Map<number | "unknown", StoreCard[]>()
    for (const c of storeCards) {
      const key = (c.floor ?? "unknown") as number | "unknown"
      if (!byFloor.has(key)) byFloor.set(key, [])
      byFloor.get(key)!.push(c)
    }
    const floors = Array.from(byFloor.entries())
      .sort((a, b) => {
        if (a[0] === "unknown") return 1
        if (b[0] === "unknown") return -1
        return (a[0] as number) - (b[0] as number)
      })
      .map(([floor, list]) => ({ floor, stores: list }))

    return NextResponse.json({
      summary: {
        total_stores: stores.length,
        open_stores: openStores,
        active_sessions: totalActiveSessions,
        active_rooms: totalActiveRooms,
        gross_total_today: totalGross,
        credit_outstanding: totalCredit,
        unsettled_count: totalUnsettled,
      },
      floors,
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
