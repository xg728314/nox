import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { formatRoomLabel } from "@/lib/rooms/formatRoomLabel"
import { getBusinessDateForOps } from "@/lib/time/businessDate"

/**
 * GET /api/inventory/sales-trace?business_day_id=xxx
 *
 * Inventory outbound / sales trace for the given (or current) business day.
 *
 * Per item:
 *   - current stock snapshot (box + converted bottles)
 *   - today bottles sold (qty * units_per_box when applicable)
 *   - today amount sold (store_price basis — 사장 매출 기준)
 *   - grouped manager breakdown with per-room / per-order details
 * Plus a flat chronological trace for the full day.
 *
 * Scoped by auth store_uuid. Uses inventory_item_id on orders (set when a liquor
 * order was placed from the counter picker). Orders without inventory_item_id
 * (manual entry) are ignored — they cannot be attributed to stock.
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

    // 1. Resolve business_day_id (param or today's open day for this store).
    const { searchParams } = new URL(request.url)
    let businessDayId: string | null = searchParams.get("business_day_id")
    if (!businessDayId) {
      const today = getBusinessDateForOps()
      const { data: bizDay } = await supabase
        .from("store_operating_days")
        .select("id")
        .eq("store_uuid", authContext.store_uuid)
        .eq("business_date", today)
        .maybeSingle()
      if (bizDay) {
        businessDayId = bizDay.id
      } else {
        const { data: latest } = await supabase
          .from("store_operating_days")
          .select("id")
          .eq("store_uuid", authContext.store_uuid)
          .eq("status", "open")
          .order("business_date", { ascending: false })
          .limit(1)
          .maybeSingle()
        businessDayId = latest?.id ?? null
      }
    }

    // 2. Load active inventory items (master).
    const { data: items } = await supabase
      .from("inventory_items")
      .select("id, name, unit, current_stock, min_stock, store_price, units_per_box")
      .eq("store_uuid", authContext.store_uuid)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("name", { ascending: true })

    type InvItem = {
      id: string; name: string; unit: string; current_stock: number;
      min_stock: number; store_price: number | null; units_per_box: number | null
    }
    const itemRows = (items ?? []) as InvItem[]

    if (!businessDayId || itemRows.length === 0) {
      return NextResponse.json({
        business_day_id: businessDayId,
        items: itemRows.map((it) => {
          const upb = it.units_per_box && it.units_per_box > 1 ? it.units_per_box : 1
          return {
            id: it.id,
            name: it.name,
            unit: it.unit,
            units_per_box: upb,
            current_stock: it.current_stock,
            current_bottles: it.current_stock * upb,
            bottles_sold_today: 0,
            amount_today: 0,
            managers: [],
          }
        }),
        trace: [],
      })
    }

    // 3. Orders for this business day that are linked to inventory.
    const { data: orders } = await supabase
      .from("orders")
      .select("id, session_id, inventory_item_id, item_name, qty, store_price, sale_price, unit_price, created_at")
      .eq("store_uuid", authContext.store_uuid)
      .eq("business_day_id", businessDayId)
      .not("inventory_item_id", "is", null)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })

    type OrderRow = {
      id: string; session_id: string; inventory_item_id: string | null;
      item_name: string; qty: number;
      store_price: number | null; sale_price: number | null; unit_price: number;
      created_at: string
    }
    const orderRows = (orders ?? []) as OrderRow[]

    // 4. Load sessions + rooms + manager info in one batch.
    const sessionIds = [...new Set(orderRows.map((o) => o.session_id))]
    let sessionMap = new Map<string, { room_uuid: string; manager_name: string | null }>()
    if (sessionIds.length > 0) {
      const { data: sessions } = await supabase
        .from("room_sessions")
        .select("id, room_uuid, manager_name")
        .in("id", sessionIds)
        .eq("store_uuid", authContext.store_uuid)
      for (const s of (sessions ?? []) as { id: string; room_uuid: string; manager_name: string | null }[]) {
        sessionMap.set(s.id, { room_uuid: s.room_uuid, manager_name: s.manager_name })
      }
    }
    const roomUuids = [...new Set(Array.from(sessionMap.values()).map((s) => s.room_uuid))]
    const roomLabel = new Map<string, string>()
    if (roomUuids.length > 0) {
      const { data: rooms } = await supabase
        .from("rooms")
        .select("id, room_no, room_name")
        .in("id", roomUuids)
        .eq("store_uuid", authContext.store_uuid)
        .is("deleted_at", null)
      for (const r of (rooms ?? []) as { id: string; room_no: string; room_name: string | null }[]) {
        roomLabel.set(r.id, formatRoomLabel(r))
      }
    }

    // 5. Build per-item aggregations.
    const itemById = new Map<string, InvItem>(itemRows.map((it) => [it.id, it]))

    type ManagerDetail = { order_id: string; time: string; room_label: string; bottles: number }
    type ManagerGroup = { manager_name: string; bottles: number; amount: number; details: ManagerDetail[] }

    const itemAgg = new Map<string, {
      bottles_sold_today: number
      amount_today: number
      managerByName: Map<string, ManagerGroup>
    }>()

    const trace: { time: string; manager_name: string; room_label: string; item_name: string; bottles: number }[] = []

    for (const o of orderRows) {
      const itemId = o.inventory_item_id!
      const inv = itemById.get(itemId)
      if (!inv) continue
      const upb = inv.units_per_box && inv.units_per_box > 1 ? inv.units_per_box : 1
      const bottles = (o.qty ?? 0) * upb
      const unitPrice = (o.store_price ?? inv.store_price ?? o.unit_price ?? 0)
      const amount = unitPrice * (o.qty ?? 0)
      const sess = sessionMap.get(o.session_id)
      const mgrName = sess?.manager_name || "미지정"
      const roomNm = sess ? (roomLabel.get(sess.room_uuid) || "-") : "-"

      if (!itemAgg.has(itemId)) {
        itemAgg.set(itemId, { bottles_sold_today: 0, amount_today: 0, managerByName: new Map() })
      }
      const agg = itemAgg.get(itemId)!
      agg.bottles_sold_today += bottles
      agg.amount_today += amount

      if (!agg.managerByName.has(mgrName)) {
        agg.managerByName.set(mgrName, { manager_name: mgrName, bottles: 0, amount: 0, details: [] })
      }
      const mgr = agg.managerByName.get(mgrName)!
      mgr.bottles += bottles
      mgr.amount += amount
      mgr.details.push({
        order_id: o.id,
        time: o.created_at,
        room_label: roomNm,
        bottles,
      })

      trace.push({
        time: o.created_at,
        manager_name: mgrName,
        room_label: roomNm,
        item_name: inv.name,
        bottles,
      })
    }

    // 6. Final per-item payload with sorted managers (bottles desc).
    const itemsPayload = itemRows.map((it) => {
      const upb = it.units_per_box && it.units_per_box > 1 ? it.units_per_box : 1
      const agg = itemAgg.get(it.id)
      const managers: ManagerGroup[] = agg
        ? Array.from(agg.managerByName.values()).sort((a, b) => b.bottles - a.bottles)
        : []
      return {
        id: it.id,
        name: it.name,
        unit: it.unit,
        units_per_box: upb,
        current_stock: it.current_stock,
        current_bottles: it.current_stock * upb,
        min_stock: it.min_stock,
        store_price: it.store_price ?? 0,
        bottles_sold_today: agg?.bottles_sold_today ?? 0,
        amount_today: agg?.amount_today ?? 0,
        managers,
      }
    })

    return NextResponse.json({
      business_day_id: businessDayId,
      items: itemsPayload,
      trace,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
