import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { formatRoomLabel } from "@/lib/rooms/formatRoomLabel"
import { getBusinessDateForOps } from "@/lib/time/businessDate"

/**
 * GET /api/admin/dashboard
 * 관제 대시보드 — 방 현황, 세션, 출근, 매출 통합 (owner 전용)
 */
export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role !== "owner") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const storeUuid = authContext.store_uuid

    // 1. 방 현황
    const { data: rooms } = await supabase
      .from("rooms")
      .select("id, room_no, room_name, is_active")
      .eq("store_uuid", storeUuid)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true })

    // 2. 활성 세션
    const { data: activeSessions } = await supabase
      .from("room_sessions")
      .select("id, room_uuid, started_at")
      .eq("store_uuid", storeUuid)
      .eq("status", "active")

    const activeRoomSet = new Set((activeSessions ?? []).map((s: { room_uuid: string }) => s.room_uuid))

    const roomStatus = (rooms ?? []).map((r: { id: string; room_no: string; room_name: string | null }) => ({
      room_uuid: r.id,
      room_no: r.room_no,
      room_name: formatRoomLabel(r),
      status: activeRoomSet.has(r.id) ? "occupied" : "empty",
    }))

    // 3. 오늘 영업일
    const today = getBusinessDateForOps()
    let { data: bizDay } = await supabase
      .from("store_operating_days")
      .select("id, business_date, status")
      .eq("store_uuid", storeUuid)
      .eq("business_date", today)
      .maybeSingle()

    if (!bizDay) {
      const { data: latestDay } = await supabase
        .from("store_operating_days")
        .select("id, business_date, status")
        .eq("store_uuid", storeUuid)
        .eq("status", "open")
        .order("business_date", { ascending: false })
        .limit(1)
        .maybeSingle()
      bizDay = latestDay
    }

    // 4. 출근 현황
    let attendanceCount = 0
    let managerOnDuty = 0
    let hostessOnDuty = 0
    if (bizDay) {
      type AttRow = { role: string }
      const { data: att } = await supabase
        .from("staff_attendance")
        .select("role")
        .eq("store_uuid", storeUuid)
        .eq("business_day_id", bizDay.id)
        .neq("status", "off_duty")

      attendanceCount = (att ?? []).length
      managerOnDuty = (att ?? []).filter((a: AttRow) => a.role === "manager").length
      hostessOnDuty = (att ?? []).filter((a: AttRow) => a.role === "hostess").length
    }

    // 5. 오늘 매출
    let todayGross = 0
    let todaySessionCount = 0
    if (bizDay) {
      const { data: receipts } = await supabase
        .from("receipts")
        .select("gross_total")
        .eq("store_uuid", storeUuid)
        .eq("business_day_id", bizDay.id)

      todaySessionCount = (receipts ?? []).length
      todayGross = (receipts ?? []).reduce((s: number, r: { gross_total: number }) => s + (r.gross_total ?? 0), 0)
    }

    // 6. 최근 감사 로그 5건
    const { data: recentAudit } = await supabase
      .from("audit_events")
      .select("id, action, entity_table, actor_role, created_at")
      .eq("store_uuid", storeUuid)
      .order("created_at", { ascending: false })
      .limit(5)

    return NextResponse.json({
      store_uuid: storeUuid,
      business_day: bizDay ? {
        id: bizDay.id,
        business_date: bizDay.business_date,
        status: bizDay.status,
      } : null,
      rooms: {
        total: roomStatus.length,
        occupied: roomStatus.filter((r: { status: string }) => r.status === "occupied").length,
        empty: roomStatus.filter((r: { status: string }) => r.status === "empty").length,
        list: roomStatus,
      },
      sessions: {
        active: (activeSessions ?? []).length,
        today_settled: todaySessionCount,
      },
      attendance: {
        total: attendanceCount,
        managers: managerOnDuty,
        hostesses: hostessOnDuty,
      },
      revenue: {
        today_gross: todayGross,
      },
      recent_audit: (recentAudit ?? []).map((a: { id: string; action: string; entity_table: string; actor_role: string; created_at: string }) => ({
        id: a.id,
        action: a.action,
        entity_table: a.entity_table,
        actor_role: a.actor_role,
        created_at: a.created_at,
      })),
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
