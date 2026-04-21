import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * GET /api/manager/hostess-stats
 *
 * Returns manager-scoped hostess aggregation:
 * - managed_total: total hostesses assigned to this manager
 * - on_duty_count: checked-in today (available / assigned / in_room)
 * - waiting_count: checked-in but not in any active room (available)
 * - in_room_count: currently in an active session
 *
 * Scope rules:
 * - manager: only hostesses with manager_membership_id = my membership_id
 * - owner: all hostesses in the store
 */

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager"].includes(authContext.role)) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. Get managed hostess membership_ids (scope filter)
    let hostessQuery = supabase
      .from("hostesses")
      .select("membership_id")
      .eq("store_uuid", authContext.store_uuid)
      .eq("is_active", true)
      .is("deleted_at", null)

    // Manager scope: only hostesses assigned to this manager
    if (authContext.role === "manager") {
      hostessQuery = hostessQuery.eq("manager_membership_id", authContext.membership_id)
    }
    // Owner scope: all hostesses in the store (no filter)

    const { data: hostesses, error: hostessError } = await hostessQuery

    if (hostessError) {
      console.error("[hostess-stats] hostess query failed:", hostessError.message)
      return NextResponse.json({ error: "QUERY_FAILED" }, { status: 500 })
    }

    const managedMembershipIds = (hostesses ?? []).map(
      (h: { membership_id: string }) => h.membership_id
    )
    const managedTotal = managedMembershipIds.length

    // 2. If no managed hostesses, return zeros
    if (managedTotal === 0) {
      return NextResponse.json({
        store_uuid: authContext.store_uuid,
        scope: authContext.role === "manager" ? "manager" : "store",
        managed_total: 0,
        on_duty_count: 0,
        waiting_count: 0,
        in_room_count: 0,
      })
    }

    // 3. Get today's business day
    const today = new Date().toISOString().split("T")[0]
    let { data: bizDay } = await supabase
      .from("store_operating_days")
      .select("id")
      .eq("store_uuid", authContext.store_uuid)
      .eq("business_date", today)
      .maybeSingle()

    if (!bizDay) {
      // Fallback: latest open business day
      const { data: latestDay } = await supabase
        .from("store_operating_days")
        .select("id")
        .eq("store_uuid", authContext.store_uuid)
        .eq("status", "open")
        .order("business_date", { ascending: false })
        .limit(1)
        .maybeSingle()
      bizDay = latestDay
    }

    if (!bizDay) {
      // No business day → no attendance data
      return NextResponse.json({
        store_uuid: authContext.store_uuid,
        scope: authContext.role === "manager" ? "manager" : "store",
        managed_total: managedTotal,
        on_duty_count: 0,
        waiting_count: 0,
        in_room_count: 0,
      })
    }

    // 4. Get attendance records for managed hostesses
    const { data: attendance } = await supabase
      .from("staff_attendance")
      .select("membership_id, status")
      .eq("store_uuid", authContext.store_uuid)
      .eq("business_day_id", bizDay.id)
      .in("membership_id", managedMembershipIds)
      .in("status", ["available", "assigned", "in_room"])

    const attendanceSet = new Set(
      (attendance ?? []).map((a: { membership_id: string }) => a.membership_id)
    )
    const statusMap = new Map<string, string>()
    for (const a of attendance ?? []) {
      statusMap.set((a as { membership_id: string }).membership_id, (a as { status: string }).status)
    }

    const onDutyCount = attendanceSet.size
    const waitingCount = [...statusMap.values()].filter(s => s === "available").length
    const inRoomCount = [...statusMap.values()].filter(s => s === "in_room" || s === "assigned").length

    return NextResponse.json({
      store_uuid: authContext.store_uuid,
      scope: authContext.role === "manager" ? "manager" : "store",
      managed_total: managedTotal,
      on_duty_count: onDutyCount,
      waiting_count: waitingCount,
      in_room_count: inRoomCount,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    console.error("[hostess-stats] unexpected:", error)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
