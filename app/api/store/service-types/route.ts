import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { invalidateStoreServiceTypesCache } from "@/lib/session/services/pricingLookup"
import { cached, invalidate as invalidateRouteCache } from "@/lib/cache/inMemoryTtl"

// 2026-05-03 R-Speed-x10: 종목별 단가는 영업일 중 잠금 — 변경 빈도 매우 낮음.
//   체크인 / 정산 / 단가 수정 화면이 자주 hit. 60초 TTL 안전.
//   PATCH 시 invalidate (route 캐시 + pricingLookup 캐시 둘 다).
const SERVICE_TYPES_TTL_MS = 60_000

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

    type ServiceTypeRow = {
      id: string
      service_type: string
      time_type: string
      time_minutes: number | null
      price: number
      manager_deduction: number | null
      has_greeting_check: boolean | null
      sort_order: number | null
    }

    const data = await cached<ServiceTypeRow[]>(
      "store_service_types",
      authContext.store_uuid,
      SERVICE_TYPES_TTL_MS,
      async () => {
        const { data, error } = await supabase
          .from("store_service_types")
          .select(
            "id, service_type, time_type, time_minutes, price, manager_deduction, has_greeting_check, sort_order",
          )
          .eq("store_uuid", authContext.store_uuid)
          .eq("is_active", true)
          .order("sort_order", { ascending: true })

        if (error) throw new Error(`QUERY_FAILED:${error.message}`)
        return (data ?? []) as ServiceTypeRow[]
      },
    )

    const res = NextResponse.json({
      store_uuid: authContext.store_uuid,
      service_types: data,
    })
    res.headers.set(
      "Cache-Control",
      "private, max-age=30, stale-while-revalidate=300",
    )
    return res
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    if (error instanceof Error && error.message.startsWith("QUERY_FAILED:")) {
      return NextResponse.json(
        { error: "QUERY_FAILED", message: error.message.slice("QUERY_FAILED:".length) },
        { status: 500 },
      )
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

    // 검증 (모두 통과해야 update 시작 — 부분 update 방지).
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
    }

    // 2026-05-03 R-Speed-x10: 직렬 for-loop UPDATE → Promise.all 병렬.
    //   max 20 update × 100ms ≈ 2s 직렬 → 100ms 1 wave.
    const updatedAt = new Date().toISOString()
    const updateResults = await Promise.all(
      updates.map((u) =>
        supabase
          .from("store_service_types")
          .update({
            price: u.price,
            manager_deduction: u.manager_deduction,
            updated_at: updatedAt,
          })
          .eq("id", u.id)
          .eq("store_uuid", authContext.store_uuid),
      ),
    )
    const failedUpdate = updateResults.find((r) => r.error)
    if (failedUpdate) {
      return NextResponse.json(
        { error: "UPDATE_FAILED", message: failedUpdate.error?.message ?? "update failed" },
        { status: 500 },
      )
    }
    const updated = updates.length

    // 2026-05-01 R-Counter-Speed: pricing cache 무효화 (변경 즉시 반영).
    invalidateStoreServiceTypesCache(authContext.store_uuid)
    // 2026-05-03 R-Speed-x10: route GET 캐시도 invalidate.
    invalidateRouteCache("store_service_types", authContext.store_uuid)

    // Audit (background fire — PATCH 응답 지연 X).
    void supabase
      .from("audit_events")
      .insert({
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
      .then(undefined, () => {
        /* swallow */
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
