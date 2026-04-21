import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

export async function GET(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager"].includes(authContext.role)) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Access denied." },
        { status: 403 }
      )
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: settings, error: fetchError } = await supabase
      .from("store_settings")
      .select("id, store_uuid, tc_rate, manager_payout_rate, hostess_payout_rate, payout_basis, rounding_unit, card_fee_rate, default_waiter_tip, attendance_period_days, attendance_min_days, performance_unit, performance_min_count, updated_at")
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .maybeSingle()

    if (fetchError) {
      return NextResponse.json(
        { error: "QUERY_FAILED", message: "Failed to query store settings." },
        { status: 500 }
      )
    }

    if (!settings) {
      return NextResponse.json({
        store_uuid: authContext.store_uuid,
        settings: null,
        message: "No settings found. Default values apply.",
      })
    }

    return NextResponse.json({
      store_uuid: authContext.store_uuid,
      settings: {
        id: settings.id,
        tc_rate: settings.tc_rate,
        manager_payout_rate: settings.manager_payout_rate,
        hostess_payout_rate: settings.hostess_payout_rate,
        payout_basis: settings.payout_basis,
        rounding_unit: settings.rounding_unit,
        card_fee_rate: settings.card_fee_rate,
        default_waiter_tip: settings.default_waiter_tip,
        attendance_period_days: settings.attendance_period_days ?? 7,
        attendance_min_days: settings.attendance_min_days ?? 3,
        performance_unit: settings.performance_unit ?? "weekly",
        performance_min_count: settings.performance_min_count ?? 5,
        updated_at: settings.updated_at,
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
        error.type === "SERVER_CONFIG_ERROR" ? 500 : 500
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role !== "owner") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Only owner can modify store settings." },
        { status: 403 }
      )
    }

    let body: {
      tc_rate?: number
      manager_payout_rate?: number
      hostess_payout_rate?: number
      payout_basis?: string
      rounding_unit?: number
    }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "Request body must be valid JSON." },
        { status: 400 }
      )
    }

    const allowedFields = ["tc_rate", "manager_payout_rate", "hostess_payout_rate", "payout_basis", "rounding_unit", "card_fee_rate", "default_waiter_tip", "attendance_period_days", "attendance_min_days", "performance_unit", "performance_min_count"]
    const updateData: Record<string, any> = {}

    for (const field of allowedFields) {
      if ((body as any)[field] !== undefined) {
        updateData[field] = (body as any)[field]
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "No valid fields to update." },
        { status: 400 }
      )
    }

    updateData.updated_at = new Date().toISOString()

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 영업일 중 설정 변경 잠금: open 영업일이 있으면 차단
    const { data: openDay } = await supabase
      .from("store_operating_days")
      .select("id")
      .eq("store_uuid", authContext.store_uuid)
      .eq("status", "open")
      .limit(1)
      .maybeSingle()

    if (openDay) {
      return NextResponse.json(
        { error: "BUSINESS_DAY_OPEN", message: "영업일 진행 중에는 설정을 변경할 수 없습니다. 마감 후 변경하세요." },
        { status: 403 }
      )
    }

    const { data: updated, error: updateError } = await supabase
      .from("store_settings")
      .update(updateData)
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .select("id, store_uuid, tc_rate, manager_payout_rate, hostess_payout_rate, payout_basis, rounding_unit, card_fee_rate, default_waiter_tip, attendance_period_days, attendance_min_days, performance_unit, performance_min_count, updated_at")
      .single()

    if (updateError || !updated) {
      return NextResponse.json(
        { error: "UPDATE_FAILED", message: "Failed to update store settings." },
        { status: 500 }
      )
    }

    // Audit
    await supabase
      .from("audit_events")
      .insert({
        store_uuid: authContext.store_uuid,
        actor_profile_id: authContext.user_id,
        actor_membership_id: authContext.membership_id,
        actor_role: authContext.role,
        actor_type: authContext.role,
        entity_table: "store_settings",
        entity_id: updated.id,
        action: "store_settings_updated",
        after: updateData,
      })

    return NextResponse.json({
      store_uuid: authContext.store_uuid,
      settings: {
        id: updated.id,
        tc_rate: updated.tc_rate,
        manager_payout_rate: updated.manager_payout_rate,
        hostess_payout_rate: updated.hostess_payout_rate,
        payout_basis: updated.payout_basis,
        rounding_unit: updated.rounding_unit,
        card_fee_rate: updated.card_fee_rate,
        default_waiter_tip: updated.default_waiter_tip,
        attendance_period_days: updated.attendance_period_days ?? 7,
        attendance_min_days: updated.attendance_min_days ?? 3,
        performance_unit: updated.performance_unit ?? "weekly",
        performance_min_count: updated.performance_min_count ?? 5,
        updated_at: updated.updated_at,
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
        error.type === "SERVER_CONFIG_ERROR" ? 500 : 500
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
