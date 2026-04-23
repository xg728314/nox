import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { getAttendance } from "@/lib/server/queries/attendance"
import { loadAttendanceVisibility } from "@/lib/server/queries/attendanceVisibility"
import { getServiceClient } from "@/lib/supabase/serviceClient"

/**
 * GET /api/attendance
 * 현재 영업일 출근 현황 조회
 */
export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager"].includes(authContext.role)) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    try {
      const visibilityMode = await loadAttendanceVisibility(getServiceClient(), authContext)
      const data = await getAttendance(authContext, { visibilityMode })
      return NextResponse.json({ ...data, visibility_mode: visibilityMode })
    } catch (e) {
      const msg = e instanceof Error ? e.message : "err"
      return NextResponse.json({ error: "QUERY_FAILED", message: msg }, { status: 500 })
    }
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : error.type.startsWith("MEMBERSHIP") ? 403 : 500
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

/**
 * POST /api/attendance
 * 출근/퇴근/상태 변경
 * body: { membership_id, action: "checkin"|"checkout"|"assign"|"unassign", room_uuid?, notes? }
 */
export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager"].includes(authContext.role)) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    let body: {
      membership_id?: string
      action?: string
      room_uuid?: string
      notes?: string
    }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "BAD_REQUEST", message: "Invalid JSON." }, { status: 400 })
    }

    const { membership_id, action, room_uuid, notes } = body

    if (!membership_id) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "membership_id is required." }, { status: 400 })
    }
    if (!action || !["checkin", "checkout", "assign", "unassign"].includes(action)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "action must be checkin|checkout|assign|unassign." }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 멤버십 확인
    const { data: membership } = await supabase
      .from("store_memberships")
      .select("id, role")
      .eq("id", membership_id)
      .eq("store_uuid", authContext.store_uuid)
      .eq("status", "approved")
      .maybeSingle()

    if (!membership) {
      return NextResponse.json({ error: "MEMBERSHIP_NOT_FOUND" }, { status: 404 })
    }

    // ROUND-STAFF-1: manager 는 자기 담당 hostess 에만 attendance 작업 가능.
    //   대상이 hostess 인 경우: hostesses.manager_membership_id === auth.membership_id 검증.
    //   owner / super_admin 은 영향 없음. 대상이 non-hostess (manager 자신 출근 등) 도 제외.
    if (
      authContext.role === "manager" &&
      membership.role === "hostess"
    ) {
      const { data: hostessRow, error: hErr } = await supabase
        .from("hostesses")
        .select("manager_membership_id")
        .eq("membership_id", membership_id)
        .eq("store_uuid", authContext.store_uuid)
        .is("deleted_at", null)
        .maybeSingle()
      if (hErr) {
        return NextResponse.json(
          { error: "INTERNAL_ERROR", message: "hostess 조회에 실패했습니다." },
          { status: 500 },
        )
      }
      if (!hostessRow) {
        return NextResponse.json(
          { error: "HOSTESS_NOT_FOUND", message: "아가씨 레코드를 찾을 수 없습니다." },
          { status: 404 },
        )
      }
      if (hostessRow.manager_membership_id !== authContext.membership_id) {
        return NextResponse.json(
          {
            error: "ASSIGNMENT_FORBIDDEN",
            message: "본인 담당 아가씨만 출근/퇴근 처리할 수 있습니다.",
          },
          { status: 403 },
        )
      }
    }

    // 영업일 조회 (없으면 자동 생성)
    const today = new Date().toISOString().split("T")[0]
    let { data: bizDay } = await supabase
      .from("store_operating_days")
      .select("id")
      .eq("store_uuid", authContext.store_uuid)
      .eq("business_date", today)
      .maybeSingle()

    if (!bizDay) {
      const { data: newDay, error: dayError } = await supabase
        .from("store_operating_days")
        .insert({
          store_uuid: authContext.store_uuid,
          business_date: today,
          status: "open",
          opened_by: authContext.user_id,
        })
        .select("id")
        .single()

      if (dayError || !newDay) {
        return NextResponse.json({ error: "BUSINESS_DAY_CREATE_FAILED" }, { status: 500 })
      }
      bizDay = newDay
    }

    const businessDayId = bizDay.id

    if (action === "checkin") {
      // 출근: INSERT (중복 시 409)
      const { data: existing } = await supabase
        .from("staff_attendance")
        .select("id, status")
        .eq("store_uuid", authContext.store_uuid)
        .eq("business_day_id", businessDayId)
        .eq("membership_id", membership_id)
        .neq("status", "off_duty")
        .maybeSingle()

      if (existing) {
        return NextResponse.json(
          { error: "ALREADY_CHECKED_IN", message: "이미 출근 상태입니다.", attendance_id: existing.id },
          { status: 409 }
        )
      }

      const { data: inserted, error: insertError } = await supabase
        .from("staff_attendance")
        .insert({
          store_uuid: authContext.store_uuid,
          business_day_id: businessDayId,
          membership_id,
          role: membership.role,
          status: "available",
          notes: notes || null,
        })
        .select("id, membership_id, role, status, checked_in_at")
        .single()

      if (insertError || !inserted) {
        return NextResponse.json({ error: "CHECKIN_FAILED", message: insertError?.message || "Failed." }, { status: 500 })
      }

      await auditLog(supabase, authContext, "staff_checkin", "staff_attendance", inserted.id, { membership_id, status: "available" })

      return NextResponse.json(inserted, { status: 201 })
    }

    // checkout / assign / unassign: 기존 출근 레코드 필요
    const { data: record } = await supabase
      .from("staff_attendance")
      .select("id, status, assigned_room_uuid")
      .eq("store_uuid", authContext.store_uuid)
      .eq("business_day_id", businessDayId)
      .eq("membership_id", membership_id)
      .neq("status", "off_duty")
      .maybeSingle()

    if (!record) {
      return NextResponse.json({ error: "NOT_CHECKED_IN", message: "출근 기록이 없습니다." }, { status: 404 })
    }

    if (action === "checkout") {
      const { data: updated, error: updateError } = await supabase
        .from("staff_attendance")
        .update({ status: "off_duty", checked_out_at: new Date().toISOString(), assigned_room_uuid: null, updated_at: new Date().toISOString() })
        .eq("id", record.id)
        .select("id, membership_id, status, checked_out_at")
        .single()

      if (updateError || !updated) {
        return NextResponse.json({ error: "CHECKOUT_FAILED" }, { status: 500 })
      }

      await auditLog(supabase, authContext, "staff_checkout", "staff_attendance", record.id, { membership_id, status: "off_duty" })
      return NextResponse.json(updated)
    }

    if (action === "assign") {
      if (!room_uuid) {
        return NextResponse.json({ error: "BAD_REQUEST", message: "room_uuid is required for assign." }, { status: 400 })
      }

      const { data: updated, error: updateError } = await supabase
        .from("staff_attendance")
        .update({ status: "assigned", assigned_room_uuid: room_uuid, assigned_by: authContext.user_id, updated_at: new Date().toISOString() })
        .eq("id", record.id)
        .select("id, membership_id, status, assigned_room_uuid")
        .single()

      if (updateError || !updated) {
        return NextResponse.json({ error: "ASSIGN_FAILED" }, { status: 500 })
      }

      await auditLog(supabase, authContext, "staff_assigned", "staff_attendance", record.id, { membership_id, room_uuid, status: "assigned" })
      return NextResponse.json(updated)
    }

    if (action === "unassign") {
      const { data: updated, error: updateError } = await supabase
        .from("staff_attendance")
        .update({ status: "available", assigned_room_uuid: null, assigned_by: null, updated_at: new Date().toISOString() })
        .eq("id", record.id)
        .select("id, membership_id, status")
        .single()

      if (updateError || !updated) {
        return NextResponse.json({ error: "UNASSIGN_FAILED" }, { status: 500 })
      }

      await auditLog(supabase, authContext, "staff_unassigned", "staff_attendance", record.id, { membership_id, status: "available" })
      return NextResponse.json(updated)
    }

    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : error.type.startsWith("MEMBERSHIP") ? 403 : 500
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function auditLog(supabase: any, ctx: { store_uuid: string; user_id: string; membership_id: string; role: string }, action: string, entityTable: string, entityId: string, after: Record<string, unknown>) {
  await supabase.from("audit_events").insert({ store_uuid: ctx.store_uuid, actor_profile_id: ctx.user_id, actor_membership_id: ctx.membership_id, actor_role: ctx.role, actor_type: ctx.role, entity_table: entityTable, entity_id: entityId, action, after })
}
