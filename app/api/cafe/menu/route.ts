import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { isValidUUID } from "@/lib/validation"

/**
 * GET /api/cafe/menu?store_uuid=X — 그 카페의 활성 메뉴 list. 인증된 누구나.
 * POST /api/cafe/menu — 카페 owner/manager/staff 만 메뉴 추가.
 */

export async function GET(request: Request) {
  try {
    await resolveAuthContext(request)
    const url = new URL(request.url)
    const store_uuid = url.searchParams.get("store_uuid")
    if (!store_uuid || !isValidUUID(store_uuid)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "store_uuid required" }, { status: 400 })
    }
    const svc = createServiceClient()
    if (svc.error) return svc.error

    const { data, error } = await svc.supabase
      .from("cafe_menu_items")
      .select("id, store_uuid, name, category, price, description, image_url, is_active, sort_order, created_at, updated_at")
      .eq("store_uuid", store_uuid)
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
    if (error) return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    return NextResponse.json({ menu: data ?? [] })
  } catch (e) {
    return handleRouteError(e, "cafe/menu")
  }
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    // 카페 owner/manager/staff 만. auth.store_uuid 가 카페여야 함.
    if (!["owner", "manager", "staff"].includes(auth.role)) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const parsed = await parseJsonBody<{
      name?: string
      category?: string
      price?: number
      description?: string | null
      description_long?: string | null
      image_url?: string | null
      thumbnail_url?: string | null
      sort_order?: number
    }>(request)
    if (parsed.error) return parsed.error
    const b = parsed.body
    if (!b.name || !b.category || typeof b.price !== "number" || b.price < 0) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "name/category/price required" }, { status: 400 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const { data, error } = await svc.supabase
      .from("cafe_menu_items")
      .insert({
        store_uuid: auth.store_uuid,
        name: b.name.trim(),
        category: b.category.trim(),
        price: b.price,
        description: b.description?.trim() || null,
        description_long: b.description_long?.trim() || null,
        image_url: b.image_url?.trim() || null,
        thumbnail_url: b.thumbnail_url?.trim() || null,
        sort_order: b.sort_order ?? 0,
      })
      .select("id, name, category, price")
      .single()
    if (error) return NextResponse.json({ error: "INSERT_FAILED", message: error.message }, { status: 500 })
    return NextResponse.json({ item: data }, { status: 201 })
  } catch (e) {
    return handleRouteError(e, "cafe/menu POST")
  }
}
