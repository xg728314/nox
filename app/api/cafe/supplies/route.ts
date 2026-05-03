import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"

/**
 * GET /api/cafe/supplies?store_uuid=X — 카페 소모품 list (인증 누구나).
 *   ?low_only=1 부족 (current<min) 만.
 * POST /api/cafe/supplies — 신규 소모품 추가 (카페 owner/manager/staff).
 */

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const url = new URL(request.url)
    const reqStore = url.searchParams.get("store_uuid")
    const lowOnly = url.searchParams.get("low_only") === "1"
    const scopeStore = (auth.is_super_admin && reqStore) ? reqStore : auth.store_uuid

    const svc = createServiceClient()
    if (svc.error) return svc.error
    let q = svc.supabase
      .from("cafe_supplies")
      .select("id, store_uuid, name, category, unit, current_stock, min_stock, unit_cost, is_active, notes, created_at, updated_at")
      .eq("store_uuid", scopeStore)
      .is("deleted_at", null)
      .order("category", { nullsFirst: false })
      .order("name")
    const { data, error } = await q
    if (error) return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    let rows = data ?? []
    if (lowOnly) {
      rows = rows.filter((r) => Number(r.current_stock) < Number(r.min_stock))
    }
    return NextResponse.json({ supplies: rows })
  } catch (e) {
    return handleRouteError(e, "cafe/supplies GET")
  }
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (!["owner", "manager", "staff"].includes(auth.role)) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const parsed = await parseJsonBody<{
      name?: string; category?: string; unit?: string;
      current_stock?: number; min_stock?: number; unit_cost?: number; notes?: string | null;
    }>(request)
    if (parsed.error) return parsed.error
    const b = parsed.body
    if (!b.name || !b.name.trim()) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "name required" }, { status: 400 })
    }
    const svc = createServiceClient()
    if (svc.error) return svc.error
    const { data, error } = await svc.supabase
      .from("cafe_supplies")
      .insert({
        store_uuid: auth.store_uuid,
        name: b.name.trim(),
        category: b.category?.trim() || null,
        unit: b.unit?.trim() || "개",
        current_stock: b.current_stock ?? 0,
        min_stock: b.min_stock ?? 0,
        unit_cost: typeof b.unit_cost === "number" ? b.unit_cost : null,
        notes: b.notes?.trim() || null,
      })
      .select("id, name, category, unit, current_stock, min_stock")
      .single()
    if (error) return NextResponse.json({ error: "INSERT_FAILED", message: error.message }, { status: 500 })
    return NextResponse.json({ supply: data }, { status: 201 })
  } catch (e) {
    return handleRouteError(e, "cafe/supplies POST")
  }
}
