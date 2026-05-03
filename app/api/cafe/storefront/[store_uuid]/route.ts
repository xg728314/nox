import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { isValidUUID } from "@/lib/validation"
import { CAFE_FLOOR } from "@/lib/building/floors"

/**
 * GET /api/cafe/storefront/[store_uuid] — 고객 페이지 (배민 스타일) 단일 bootstrap.
 *
 * 응답: { store: {id, name, floor}, menu: [...], account: {bank, ...} | null }
 * 기존: /api/cafe/stores + /api/cafe/menu = 2 round-trip
 * 신규: 1 round-trip (store + menu + account 병렬 query).
 *
 * 모바일/PC 양쪽에서 첫 진입 latency 절감.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ store_uuid: string }> },
) {
  try {
    await resolveAuthContext(request)
    const { store_uuid } = await context.params
    if (!isValidUUID(store_uuid)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    const [storeRes, menuRes, accountRes] = await Promise.all([
      supabase
        .from("stores")
        .select("id, store_name, floor")
        .eq("id", store_uuid)
        .is("deleted_at", null)
        .maybeSingle(),
      supabase
        .from("cafe_menu_items")
        .select("id, store_uuid, name, category, price, description, image_url, thumbnail_url, is_active, sold_out, sort_order, created_at, updated_at")
        .eq("store_uuid", store_uuid)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("sort_order")
        .order("name"),
      supabase
        .from("cafe_account_info")
        .select("bank_name, account_number, account_holder, is_active")
        .eq("store_uuid", store_uuid)
        .maybeSingle(),
    ])

    if (!storeRes.data) {
      return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 })
    }
    // 카페 매장 검증 (3F)
    if (storeRes.data.floor !== CAFE_FLOOR) {
      return NextResponse.json({ error: "NOT_A_CAFE" }, { status: 400 })
    }

    return NextResponse.json({
      store: {
        id: storeRes.data.id,
        name: storeRes.data.store_name,
        floor: storeRes.data.floor,
      },
      menu: menuRes.data ?? [],
      account: accountRes.data ?? null,
    })
  } catch (e) {
    return handleRouteError(e, "cafe/storefront")
  }
}
