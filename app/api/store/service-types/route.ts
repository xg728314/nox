import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { invalidateStoreServiceTypesCache } from "@/lib/session/services/pricingLookup"

/**
 * GET /api/store/service-types
 * 매장 종목별 단가 조회 (owner/manager)
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

    const { data, error } = await supabase
      .from("store_service_types")
      .select("id, service_type, time_type, time_minutes, price, manager_deduction, has_greeting_check, sort_order")
      .eq("store_uuid", authContext.store_uuid)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })

    if (error) {
      return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    }

    return NextResponse.json({ store_uuid: authContext.store_uuid, service_types: data ?? [] })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

/**
 * PATCH /api/store/service-types
 * 종목별 단가 수정 (owner 전용)
 * body: { updates: [{ id, price, manager_deduction }] }
 */
export async function PATCH(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role !== "owner") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "Only owner can modify service types." }, { status: 403 })
    }

    let body: { updates?: { id: string; price: number; manager_deduction: number }[] }
    try { body = await request.json() } catch {
      return NextResponse.json({ error: "BAD_REQUEST", message: "Invalid JSON." }, { status: 400 })
    }

    const { updates } = body
    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "updates array is required." }, { status: 400 })
    }

    if (updates.length > 20) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "Maximum 20 updates at once." }, { status: 400 })
    }

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
        { error: "BUSINESS_DAY_OPEN", message: "영업일 진행 중에는 단가를 변경할 수 없습니다. 마감 후 변경하세요." },
        { status: 403 }
      )
    }

    // 각 항목 검증 + 업데이트
    let updated = 0
    for (const u of updates) {
      if (!u.id || typeof u.price !== "number" || typeof u.manager_deduction !== "number") {
        return NextResponse.json({ error: "BAD_REQUEST", message: `Invalid update: id=${u.id}` }, { status: 400 })
      }
      if (u.price < 0 || u.price > 9999999) {
        return NextResponse.json({ error: "BAD_REQUEST", message: `price out of range: ${u.price}` }, { status: 400 })
      }
      if (u.manager_deduction < 0 || u.manager_deduction > 9999999) {
        return NextResponse.json({ error: "BAD_REQUEST", message: `manager_deduction out of range: ${u.manager_deduction}` }, { status: 400 })
      }

      const { error: updateError } = await supabase
        .from("store_service_types")
        .update({
          price: u.price,
          manager_deduction: u.manager_deduction,
          updated_at: new Date().toISOString(),
        })
        .eq("id", u.id)
        .eq("store_uuid", authContext.store_uuid)

      if (updateError) {
        return NextResponse.json({ error: "UPDATE_FAILED", message: updateError.message }, { status: 500 })
      }
      updated++
    }

    // 2026-05-01 R-Counter-Speed: pricing cache 무효화 (변경 즉시 반영).
    invalidateStoreServiceTypesCache(authContext.store_uuid)

    // Audit
    await supabase.from("audit_events").insert({
      store_uuid: authContext.store_uuid,
      actor_profile_id: authContext.user_id,
      actor_membership_id: authContext.membership_id,
      actor_role: authContext.role,
      actor_type: authContext.role,
      entity_table: "store_service_types",
      entity_id: authContext.store_uuid,
      action: "service_types_updated",
      after: { updated_count: updated, updates },
    })

    // 최신 목록 반환
    const { data } = await supabase
      .from("store_service_types")
      .select("id, service_type, time_type, time_minutes, price, manager_deduction, has_greeting_check, sort_order")
      .eq("store_uuid", authContext.store_uuid)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })

    return NextResponse.json({ store_uuid: authContext.store_uuid, updated_count: updated, service_types: data ?? [] })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
