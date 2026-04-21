import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"

/**
 * POST /api/inventory/items — 품목 등록
 * GET  /api/inventory/items — 품목 목록 (저재고 경고 포함)
 */

export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role !== "owner") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Only owner can manage inventory items." },
        { status: 403 }
      )
    }

    let body: {
      name?: string
      unit?: string
      current_stock?: number
      min_stock?: number
      store_price?: number
      cost_per_box?: number
      units_per_box?: number
    }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "BAD_REQUEST", message: "Request body must be valid JSON." }, { status: 400 })
    }

    const { name, unit, current_stock, min_stock, store_price, cost_per_box, units_per_box } = body

    if (!name || name.trim().length === 0) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "name is required." }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Compute cost_per_unit from box pricing if provided
    const resolvedUnitsPerBox = units_per_box && units_per_box > 0 ? units_per_box : 1
    const resolvedCostPerUnit = cost_per_box && cost_per_box > 0
      ? Math.round(cost_per_box / resolvedUnitsPerBox)
      : 0

    const { data: item, error: insertError } = await supabase
      .from("inventory_items")
      .insert({
        store_uuid: authContext.store_uuid,
        name: name.trim(),
        category: "general",
        unit: unit?.trim() || "ea",
        current_stock: current_stock ?? 0,
        min_stock: min_stock ?? 0,
        unit_cost: resolvedCostPerUnit,
        store_price: store_price ?? 0,
        cost_per_box: cost_per_box ?? 0,
        units_per_box: resolvedUnitsPerBox,
        cost_per_unit: resolvedCostPerUnit,
      })
      .select("id, name, unit, current_stock, min_stock, unit_cost, store_price, cost_per_box, units_per_box, cost_per_unit, is_active, created_at")
      .single()

    if (insertError || !item) {
      if (insertError?.code === "23505") {
        return NextResponse.json({ error: "DUPLICATE", message: "같은 이름의 품목이 이미 있습니다." }, { status: 409 })
      }
      return NextResponse.json({ error: "CREATE_FAILED", message: "품목 등록에 실패했습니다." }, { status: 500 })
    }

    // 초기 재고가 있으면 입고 트랜잭션 기록
    if ((current_stock ?? 0) > 0) {
      await supabase.from("inventory_transactions").insert({
        store_uuid: authContext.store_uuid,
        item_id: item.id,
        type: "initial",
        quantity: current_stock ?? 0,
        before_stock: 0,
        after_stock: current_stock ?? 0,
        unit_cost: resolvedCostPerUnit,
        total_cost: (current_stock ?? 0) * resolvedCostPerUnit,
        memo: "초기 재고",
        actor_membership_id: authContext.membership_id,
      })
    }

    await supabase.from("audit_events").insert({
      store_uuid: authContext.store_uuid,
      actor_profile_id: authContext.user_id,
      actor_membership_id: authContext.membership_id,
      actor_role: authContext.role,
      actor_type: authContext.role,
      entity_table: "inventory_items",
      entity_id: item.id,
      action: "inventory_item_created",
      after: { name: name.trim(), unit, current_stock, min_stock, store_price, cost_per_box, units_per_box: resolvedUnitsPerBox, cost_per_unit: resolvedCostPerUnit },
    })

    return NextResponse.json(item, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

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
    const showInactive = searchParams.get("include_inactive") === "true"

    let query = supabase
      .from("inventory_items")
      .select("id, name, unit, current_stock, min_stock, unit_cost, store_price, units_per_box, cost_per_box, cost_per_unit, is_active, updated_at")
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .order("name", { ascending: true })

    if (!showInactive) {
      query = query.eq("is_active", true)
    }

    const { data: items, error: queryError } = await query

    if (queryError) {
      return NextResponse.json({ error: "QUERY_FAILED" }, { status: 500 })
    }

    const enriched = (items ?? []).map((item: {
      id: string; name: string; unit: string;
      current_stock: number; min_stock: number; unit_cost: number;
      store_price?: number | null; cost_per_box?: number | null; cost_per_unit?: number | null;
      units_per_box?: number | null;
      is_active: boolean; updated_at: string
    }) => {
      const upb = item.units_per_box && item.units_per_box > 0 ? item.units_per_box : 1
      const isBoxed = (item.unit === "박스") && upb > 1
      return {
        ...item,
        units_per_box: upb,
        converted_stock: isBoxed ? item.current_stock * upb : item.current_stock,
        is_low_stock: item.min_stock > 0 && item.current_stock <= item.min_stock,
        is_out_of_stock: item.current_stock <= 0,
      }
    })

    const lowStockCount = enriched.filter((i: { is_low_stock: boolean }) => i.is_low_stock).length
    const outOfStockCount = enriched.filter((i: { is_out_of_stock: boolean }) => i.is_out_of_stock).length

    return NextResponse.json({
      items: enriched,
      summary: {
        total: enriched.length,
        low_stock: lowStockCount,
        out_of_stock: outOfStockCount,
      },
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
