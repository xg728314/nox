import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { isValidUUID } from "@/lib/validation"

/**
 * DELETE /api/cafe/menu/[id]/options/[group_id] — 옵션 그룹 soft delete.
 *   카페 owner/manager/staff 만, 자기 매장 메뉴.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; group_id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    if (!["owner", "manager", "staff"].includes(auth.role)) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const { id, group_id } = await context.params
    if (!isValidUUID(id) || !isValidUUID(group_id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 메뉴 소속 검증
    const { data: menu } = await supabase.from("cafe_menu_items")
      .select("id, store_uuid").eq("id", id).maybeSingle()
    if (!menu || menu.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }

    const now = new Date().toISOString()
    const { error } = await supabase.from("cafe_menu_option_groups")
      .update({ deleted_at: now })
      .eq("id", group_id)
      .eq("menu_id", id)
    if (error) return NextResponse.json({ error: "DELETE_FAILED", message: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleRouteError(e, "cafe/menu/options DELETE")
  }
}
