import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"

/**
 * POST /api/cafe/supplies/purchases — 입고 등록. trigger 가 stock 자동 가산 + ledger 추가.
 * GET /api/cafe/supplies/purchases?supply_id=X — 입고 이력
 */

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (!["owner", "manager", "staff"].includes(auth.role)) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const parsed = await parseJsonBody<{
      supply_id?: string; qty?: number; unit_cost?: number; total_cost?: number;
      vendor?: string | null; notes?: string | null;
    }>(request)
    if (parsed.error) return parsed.error
    const b = parsed.body
    if (!b.supply_id || typeof b.qty !== "number" || b.qty <= 0) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "supply_id + qty required" }, { status: 400 })
    }
    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 소속 검증
    const { data: sup } = await supabase
      .from("cafe_supplies").select("id, store_uuid").eq("id", b.supply_id).maybeSingle()
    if (!sup || sup.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }

    const totalCost = b.total_cost ?? (b.unit_cost ? b.unit_cost * b.qty : null)
    const { data, error } = await supabase
      .from("cafe_supply_purchases")
      .insert({
        store_uuid: auth.store_uuid,
        supply_id: b.supply_id,
        qty: b.qty,
        unit_cost: b.unit_cost ?? null,
        total_cost: totalCost,
        vendor: b.vendor?.trim() || null,
        purchased_by: auth.membership_id,
        notes: b.notes?.trim() || null,
      })
      .select("id, qty, total_cost, purchased_at")
      .single()
    if (error) return NextResponse.json({ error: "INSERT_FAILED", message: error.message }, { status: 500 })
    return NextResponse.json({ purchase: data }, { status: 201 })
  } catch (e) {
    return handleRouteError(e, "cafe/supplies/purchases POST")
  }
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const url = new URL(request.url)
    const supplyId = url.searchParams.get("supply_id")
    const svc = createServiceClient()
    if (svc.error) return svc.error
    let q = svc.supabase
      .from("cafe_supply_purchases")
      .select("id, supply_id, qty, unit_cost, total_cost, vendor, purchased_at, notes")
      .eq("store_uuid", auth.store_uuid)
      .order("purchased_at", { ascending: false })
      .limit(100)
    if (supplyId) q = q.eq("supply_id", supplyId)
    const { data, error } = await q
    if (error) return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    return NextResponse.json({ purchases: data ?? [] })
  } catch (e) {
    return handleRouteError(e, "cafe/supplies/purchases GET")
  }
}
