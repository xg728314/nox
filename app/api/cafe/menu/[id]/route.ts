import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { isValidUUID } from "@/lib/validation"

/**
 * PATCH/DELETE /api/cafe/menu/[id] — 메뉴 수정/삭제 (카페 owner/manager/staff).
 *   store_uuid scope 검증 필수 — 다른 카페 메뉴 수정 불가.
 */

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    if (!["owner", "manager", "staff"].includes(auth.role)) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const { id } = await context.params
    if (!isValidUUID(id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    const parsed = await parseJsonBody<{
      name?: string; category?: string; price?: number;
      description?: string | null; image_url?: string | null;
      is_active?: boolean; sort_order?: number;
    }>(request)
    if (parsed.error) return parsed.error
    const b = parsed.body
    const patch: Record<string, unknown> = {}
    if (typeof b.name === "string") patch.name = b.name.trim()
    if (typeof b.category === "string") patch.category = b.category.trim()
    if (typeof b.price === "number" && b.price >= 0) patch.price = b.price
    if (b.description !== undefined) patch.description = b.description?.trim() || null
    if (b.image_url !== undefined) patch.image_url = b.image_url?.trim() || null
    if (typeof b.is_active === "boolean") patch.is_active = b.is_active
    if (typeof b.sort_order === "number") patch.sort_order = b.sort_order

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const { data, error } = await svc.supabase
      .from("cafe_menu_items")
      .update(patch)
      .eq("id", id)
      .eq("store_uuid", auth.store_uuid)  // scope guard
      .is("deleted_at", null)
      .select("id, name, category, price, is_active")
      .maybeSingle()
    if (error) return NextResponse.json({ error: "UPDATE_FAILED", message: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    return NextResponse.json({ item: data })
  } catch (e) {
    return handleRouteError(e, "cafe/menu PATCH")
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    if (!["owner", "manager", "staff"].includes(auth.role)) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const { id } = await context.params
    if (!isValidUUID(id)) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const { error } = await svc.supabase
      .from("cafe_menu_items")
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq("id", id)
      .eq("store_uuid", auth.store_uuid)
      .is("deleted_at", null)
    if (error) return NextResponse.json({ error: "DELETE_FAILED", message: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleRouteError(e, "cafe/menu DELETE")
  }
}
