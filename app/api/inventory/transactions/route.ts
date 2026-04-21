import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { isValidUUID } from "@/lib/validation"

const VALID_TYPES = ["in", "out", "adjust", "loss"] as const

/**
 * POST /api/inventory/transactions — 입고(in), 출고(out), 조정(adjust), 손실(loss)
 * GET  /api/inventory/transactions?item_id=xxx — 품목별 이력
 */

export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (!["owner", "manager"].includes(authContext.role)) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    let body: {
      item_id?: string
      type?: string
      quantity?: number
      memo?: string
      session_id?: string
    }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

    const { item_id, type, quantity, memo, session_id } = body

    if (!item_id || !isValidUUID(item_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "item_id is required." }, { status: 400 })
    }
    if (!type || !(VALID_TYPES as readonly string[]).includes(type)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "type must be one of: in, out, adjust, loss." }, { status: 400 })
    }
    if (!quantity || typeof quantity !== "number" || quantity <= 0) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "quantity must be a positive number." }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. 품목 조회
    const { data: item } = await supabase
      .from("inventory_items")
      .select("id, current_stock, unit_cost")
      .eq("id", item_id)
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .maybeSingle()

    if (!item) {
      return NextResponse.json({ error: "ITEM_NOT_FOUND" }, { status: 404 })
    }

    // 2. 재고 계산
    const beforeStock = item.current_stock
    let afterStock: number

    if (type === "in") {
      afterStock = beforeStock + quantity
    } else if (type === "out" || type === "loss") {
      if (beforeStock < quantity) {
        return NextResponse.json(
          { error: "INSUFFICIENT_STOCK", message: `재고 부족: 현재 ${beforeStock}, 요청 ${quantity}` },
          { status: 400 }
        )
      }
      afterStock = beforeStock - quantity
    } else {
      // adjust: quantity를 절대값으로 설정
      afterStock = quantity
    }

    const unitCost = item.unit_cost
    const totalCost = (type === "adjust" ? Math.abs(afterStock - beforeStock) : quantity) * unitCost

    // 3. 영업일 조회
    let businessDayId: string | null = null
    const today = new Date().toISOString().split("T")[0]
    const { data: bizDay } = await supabase
      .from("store_operating_days")
      .select("id")
      .eq("store_uuid", authContext.store_uuid)
      .eq("business_date", today)
      .maybeSingle()
    if (bizDay) businessDayId = bizDay.id

    // 4. 트랜잭션 기록
    const { data: tx, error: txError } = await supabase
      .from("inventory_transactions")
      .insert({
        store_uuid: authContext.store_uuid,
        item_id,
        type,
        quantity: type === "adjust" ? Math.abs(afterStock - beforeStock) : quantity,
        before_stock: beforeStock,
        after_stock: afterStock,
        unit_cost: unitCost,
        total_cost: totalCost,
        memo: memo?.trim() || null,
        actor_membership_id: authContext.membership_id,
        session_id: session_id && isValidUUID(session_id) ? session_id : null,
        business_day_id: businessDayId,
      })
      .select("id, type, quantity, before_stock, after_stock, created_at")
      .single()

    if (txError || !tx) {
      return NextResponse.json({ error: "TX_FAILED" }, { status: 500 })
    }

    // 5. 재고 업데이트
    await supabase
      .from("inventory_items")
      .update({ current_stock: afterStock, updated_at: new Date().toISOString() })
      .eq("id", item_id)
      .eq("store_uuid", authContext.store_uuid)

    // 6. Audit
    await supabase.from("audit_events").insert({
      store_uuid: authContext.store_uuid,
      actor_profile_id: authContext.user_id,
      actor_membership_id: authContext.membership_id,
      actor_role: authContext.role,
      actor_type: authContext.role,
      entity_table: "inventory_transactions",
      entity_id: tx.id,
      action: `inventory_${type}`,
      after: { item_id, type, quantity, before_stock: beforeStock, after_stock: afterStock },
    })

    return NextResponse.json({
      transaction_id: tx.id,
      item_id,
      type: tx.type,
      quantity: tx.quantity,
      before_stock: tx.before_stock,
      after_stock: tx.after_stock,
    }, { status: 201 })
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

    const { searchParams } = new URL(request.url)
    const itemId = searchParams.get("item_id")
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 100)

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    let query = supabase
      .from("inventory_transactions")
      .select("id, item_id, type, quantity, before_stock, after_stock, unit_cost, total_cost, memo, actor_membership_id, created_at")
      .eq("store_uuid", authContext.store_uuid)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (itemId && isValidUUID(itemId)) {
      query = query.eq("item_id", itemId)
    }

    const { data: transactions, error: queryError } = await query

    if (queryError) {
      return NextResponse.json({ error: "QUERY_FAILED" }, { status: 500 })
    }

    // 처리자 이름
    const actorIds = [...new Set((transactions ?? []).map((t: { actor_membership_id: string }) => t.actor_membership_id))]
    const nameMap = new Map<string, string>()
    if (actorIds.length > 0) {
      const { data: mgrNames } = await supabase
        .from("managers").select("membership_id, name").eq("store_uuid", authContext.store_uuid).in("membership_id", actorIds)
      for (const m of mgrNames ?? []) nameMap.set(m.membership_id, m.name)
      const { data: hstNames } = await supabase
        .from("hostesses").select("membership_id, name").eq("store_uuid", authContext.store_uuid).in("membership_id", actorIds)
      for (const h of hstNames ?? []) { if (!nameMap.has(h.membership_id)) nameMap.set(h.membership_id, h.name) }
    }

    const enriched = (transactions ?? []).map((t: {
      id: string; item_id: string; type: string; quantity: number;
      before_stock: number; after_stock: number; unit_cost: number; total_cost: number;
      memo: string | null; actor_membership_id: string; created_at: string
    }) => ({
      ...t,
      actor_name: nameMap.get(t.actor_membership_id) || null,
    }))

    return NextResponse.json({ transactions: enriched })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
