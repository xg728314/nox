import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { cached, invalidate as invalidateCache } from "@/lib/cache/inMemoryTtl"

// 2026-05-03 R-Speed-x10: store_settings 는 영업일 중 잠겨있고 owner 만 변경 →
//   변경 빈도 매우 낮음. 카운터 / 정산 / 청구서 화면이 자주 읽음 (TC율, 카드수수료,
//   웨이터팁 default 등). 30초 TTL + SWR 충분. PATCH 시 invalidate.
const SETTINGS_TTL_MS = 30_000

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

    // R29-fix: migration 018/087 미적용 환경 → 42703 (column does not exist).
    //   credits 와 같은 FULL → BASE 폴백 패턴. migration 095 적용하면 자동 복구.
    const FULL_COLS = "id, store_uuid, tc_rate, manager_payout_rate, hostess_payout_rate, payout_basis, rounding_unit, card_fee_rate, default_waiter_tip, attendance_period_days, attendance_min_days, performance_unit, performance_min_count, monthly_rent, monthly_utilities, monthly_misc, liquor_target_mode, liquor_target_amount, updated_at"
    const BASE_COLS = "id, store_uuid, tc_rate, manager_payout_rate, hostess_payout_rate, payout_basis, rounding_unit, card_fee_rate, default_waiter_tip, updated_at"

    type SettingsResp = {
      store_uuid: string
      settings: Record<string, unknown> | null
      message?: string
    }

    const payload = await cached<SettingsResp>(
      "store_settings",
      authContext.store_uuid,
      SETTINGS_TTL_MS,
      async () => {
        async function tryQuery(cols: string) {
          return await supabase
            .from("store_settings")
            .select(cols)
            .eq("store_uuid", authContext.store_uuid)
            .is("deleted_at", null)
            .maybeSingle()
        }

        let { data: settings, error: fetchError } = await tryQuery(FULL_COLS)
        if (fetchError && (fetchError as { code?: string }).code === "42703") {
          console.warn(
            "[store/settings GET] 42703 — migration 095 미적용. BASE_COLS 폴백.",
          )
          const r = await tryQuery(BASE_COLS)
          settings = r.data
          fetchError = r.error
        }

        if (fetchError) {
          console.error(
            "[store/settings GET] fetchError:",
            JSON.stringify(fetchError),
          )
          throw new Error(
            `QUERY_FAILED:${(fetchError as { message?: string }).message ?? "Failed to query store settings."}`,
          )
        }

        if (!settings) {
          return {
            store_uuid: authContext.store_uuid,
            settings: null,
            message: "No settings found. Default values apply.",
          }
        }

        const s = settings as unknown as Record<string, unknown>
        return {
          store_uuid: authContext.store_uuid,
          settings: {
            id: s.id,
            tc_rate: s.tc_rate,
            manager_payout_rate: s.manager_payout_rate,
            hostess_payout_rate: s.hostess_payout_rate,
            payout_basis: s.payout_basis,
            rounding_unit: s.rounding_unit,
            card_fee_rate: s.card_fee_rate,
            default_waiter_tip: s.default_waiter_tip,
            attendance_period_days: s.attendance_period_days ?? 7,
            attendance_min_days: s.attendance_min_days ?? 3,
            performance_unit: s.performance_unit ?? "weekly",
            performance_min_count: s.performance_min_count ?? 5,
            monthly_rent: s.monthly_rent ?? 0,
            monthly_utilities: s.monthly_utilities ?? 0,
            monthly_misc: s.monthly_misc ?? 0,
            liquor_target_mode: s.liquor_target_mode ?? "auto",
            liquor_target_amount: s.liquor_target_amount ?? 0,
            updated_at: s.updated_at,
          },
        }
      },
    )

    const res = NextResponse.json(payload)
    // 30초 max-age + 5분 SWR — settings 가 자주 안 바뀌므로 안전한 큰 값.
    res.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=300")
    return res
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
    if (error instanceof Error && error.message.startsWith("QUERY_FAILED:")) {
      return NextResponse.json(
        { error: "QUERY_FAILED", message: error.message.slice("QUERY_FAILED:".length) },
        { status: 500 },
      )
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

    // 동적 필드 접근은 whitelist 기반 + unknown 타입. `as any` 금지.
    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "Request body must be valid JSON." },
        { status: 400 }
      )
    }
    const body: Record<string, unknown> =
      rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>)
        : {}

    const ALLOWED_FIELDS = [
      "tc_rate",
      "manager_payout_rate",
      "hostess_payout_rate",
      "payout_basis",
      "rounding_unit",
      "card_fee_rate",
      "default_waiter_tip",
      "attendance_period_days",
      "attendance_min_days",
      "performance_unit",
      "performance_min_count",
      // 2026-04-25: 운영비 기준 (양주 손익분기 계산)
      "monthly_rent",
      "monthly_utilities",
      "monthly_misc",
      "liquor_target_mode",
      "liquor_target_amount",
    ] as const
    const updateData: Record<string, unknown> = {}

    for (const field of ALLOWED_FIELDS) {
      const v = body[field]
      if (v !== undefined) {
        updateData[field] = v
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
      .select("id, store_uuid, tc_rate, manager_payout_rate, hostess_payout_rate, payout_basis, rounding_unit, card_fee_rate, default_waiter_tip, attendance_period_days, attendance_min_days, performance_unit, performance_min_count, monthly_rent, monthly_utilities, monthly_misc, liquor_target_mode, liquor_target_amount, updated_at")
      .single()

    if (updateError || !updated) {
      return NextResponse.json(
        { error: "UPDATE_FAILED", message: "Failed to update store settings." },
        { status: 500 }
      )
    }

    // 캐시 invalidate — 다음 GET 은 fresh fetch.
    invalidateCache("store_settings", authContext.store_uuid)

    // Audit (background fire — PATCH 응답 지연 X).
    // .then() 트리거 필수: Supabase builder 는 await/then 호출까진 fire 안 됨.
    void supabase
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
      .then(undefined, () => {
        /* swallow audit failure — 정상 흐름에 영향 없음 */
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
        monthly_rent: updated.monthly_rent ?? 0,
        monthly_utilities: updated.monthly_utilities ?? 0,
        monthly_misc: updated.monthly_misc ?? 0,
        liquor_target_mode: updated.liquor_target_mode ?? "auto",
        liquor_target_amount: updated.liquor_target_amount ?? 0,
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
