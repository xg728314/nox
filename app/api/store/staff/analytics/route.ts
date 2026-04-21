import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * GET /api/store/staff/analytics
 *
 * Returns hostess-level attendance + performance metrics for staff management.
 * Metrics are computed from staff_attendance and session_participants tables.
 *
 * Query params:
 *   attendance_period_days (default: 7)
 *   attendance_min_days (default: 3)
 *   performance_unit (default: 'weekly') — 'daily' | 'weekly' | 'monthly'
 *   performance_min_count (default: 5)
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
    const { searchParams } = new URL(request.url)

    const periodDays = parseInt(searchParams.get("attendance_period_days") || "7", 10) || 7
    const minDays = parseInt(searchParams.get("attendance_min_days") || "3", 10) || 3
    const perfUnit = searchParams.get("performance_unit") || "weekly"
    const perfMinCount = parseInt(searchParams.get("performance_min_count") || "5", 10) || 5

    const storeUuid = authContext.store_uuid

    // Date range
    const now = new Date()
    const periodStart = new Date(now)
    periodStart.setDate(periodStart.getDate() - periodDays)
    const periodStartISO = periodStart.toISOString()

    // 1) Get all approved hostess memberships for this store
    const { data: memberships } = await supabase
      .from("store_memberships")
      .select("id, role")
      .eq("store_uuid", storeUuid)
      .eq("role", "hostess")
      .eq("status", "approved")
      .is("deleted_at", null)

    const membershipIds = (memberships ?? []).map((m: { id: string }) => m.id)
    if (membershipIds.length === 0) {
      return NextResponse.json({ analytics: [], criteria: { periodDays, minDays, perfUnit, perfMinCount } })
    }

    // 2) Get hostess records (name, grade, manager)
    const { data: hostessRows } = await supabase
      .from("hostesses")
      .select("membership_id, name, stage_name, grade, grade_updated_at, manager_membership_id")
      .in("membership_id", membershipIds)

    const hostessMap = new Map<string, {
      name: string; grade: string | null; grade_updated_at: string | null; manager_membership_id: string | null
    }>()
    for (const h of (hostessRows ?? []) as { membership_id: string; name: string | null; stage_name: string | null; grade: string | null; grade_updated_at: string | null; manager_membership_id: string | null }[]) {
      hostessMap.set(h.membership_id, {
        name: h.name || h.stage_name || "이름 없음",
        grade: h.grade,
        grade_updated_at: h.grade_updated_at,
        manager_membership_id: h.manager_membership_id,
      })
    }

    // 3) Attendance: count distinct business days with attendance in period
    const { data: attendanceRows } = await supabase
      .from("staff_attendance")
      .select("membership_id, business_day_id, checked_in_at")
      .eq("store_uuid", storeUuid)
      .in("membership_id", membershipIds)
      .gte("checked_in_at", periodStartISO)

    // Count distinct business_day_id per membership
    const attendanceCount = new Map<string, Set<string>>()
    // Track consecutive absent days
    const lastCheckinMap = new Map<string, string>()

    for (const row of (attendanceRows ?? []) as { membership_id: string; business_day_id: string; checked_in_at: string }[]) {
      if (!attendanceCount.has(row.membership_id)) {
        attendanceCount.set(row.membership_id, new Set())
      }
      attendanceCount.get(row.membership_id)!.add(row.business_day_id)
      // Track latest checkin
      const prev = lastCheckinMap.get(row.membership_id)
      if (!prev || row.checked_in_at > prev) {
        lastCheckinMap.set(row.membership_id, row.checked_in_at)
      }
    }

    // 4) Performance: count session participations in period
    const { data: participantRows } = await supabase
      .from("session_participants")
      .select("membership_id, id, entered_at")
      .eq("store_uuid", storeUuid)
      .eq("role", "hostess")
      .in("membership_id", membershipIds)
      .is("deleted_at", null)
      .gte("entered_at", periodStartISO)

    const sessionCount = new Map<string, number>()
    for (const row of (participantRows ?? []) as { membership_id: string; id: string }[]) {
      sessionCount.set(row.membership_id, (sessionCount.get(row.membership_id) || 0) + 1)
    }

    // Performance threshold adjusted by unit
    // perfMinCount is specified "per unit". Convert to period total:
    // daily → perfMinCount * periodDays
    // weekly → perfMinCount * (periodDays / 7)
    // monthly → perfMinCount * (periodDays / 30)
    let perfThreshold: number
    switch (perfUnit) {
      case "daily":
        perfThreshold = perfMinCount * periodDays
        break
      case "monthly":
        perfThreshold = Math.ceil(perfMinCount * (periodDays / 30))
        break
      case "weekly":
      default:
        perfThreshold = Math.ceil(perfMinCount * (periodDays / 7))
        break
    }

    // 5) Build analytics per hostess
    type StaffStatus = "양호" | "출근관리 필요" | "갯수관리 필요" | "집중관리"

    const analytics = membershipIds.map((mid: string) => {
      const info = hostessMap.get(mid)
      const attDays = attendanceCount.get(mid)?.size ?? 0
      const sessions = sessionCount.get(mid) ?? 0
      const lastCheckin = lastCheckinMap.get(mid) ?? null

      // Calculate consecutive absent days from now
      let consecutiveAbsent = 0
      if (lastCheckin) {
        const lastDate = new Date(lastCheckin)
        consecutiveAbsent = Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24))
      } else {
        consecutiveAbsent = periodDays
      }

      const attRate = periodDays > 0 ? Math.round((attDays / periodDays) * 100) : 0
      const avgSessions = attDays > 0 ? Math.round((sessions / attDays) * 10) / 10 : 0

      const attendanceLow = attDays < minDays
      const performanceLow = sessions < perfThreshold

      let status: StaffStatus
      if (attendanceLow && performanceLow) {
        status = "집중관리"
      } else if (attendanceLow) {
        status = "출근관리 필요"
      } else if (performanceLow) {
        status = "갯수관리 필요"
      } else {
        status = "양호"
      }

      return {
        membership_id: mid,
        name: info?.name ?? "이름 없음",
        grade: info?.grade ?? null,
        grade_updated_at: info?.grade_updated_at ?? null,
        manager_membership_id: info?.manager_membership_id ?? null,
        status,
        attendance: {
          days: attDays,
          rate: attRate,
          consecutive_absent: consecutiveAbsent,
        },
        performance: {
          total_sessions: sessions,
          avg_per_day: avgSessions,
          threshold: perfThreshold,
        },
      }
    })

    // Manager scope: if manager, filter to their hostesses
    let filtered = analytics
    if (authContext.role === "manager") {
      filtered = analytics.filter(a => a.manager_membership_id === authContext.membership_id)
    }

    return NextResponse.json({
      analytics: filtered,
      criteria: { periodDays, minDays, perfUnit, perfMinCount, perfThreshold },
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = ["AUTH_MISSING", "AUTH_INVALID"].includes(error.type) ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
