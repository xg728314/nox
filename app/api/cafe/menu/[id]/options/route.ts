import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { isValidUUID } from "@/lib/validation"

/**
 * GET /api/cafe/menu/[id]/options — 메뉴의 옵션 그룹 + 옵션 list (활성 것만, 누구나).
 * POST /api/cafe/menu/[id]/options — 그룹 추가 (카페 owner/manager/staff).
 *   body: { name, is_required, min_select, max_select, sort_order, options: [{name, price_delta, ...}] }
 */

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!isValidUUID(id)) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })

    const svc = createServiceClient()
    if (svc.error) return svc.error

    const { data: groups } = await svc.supabase
      .from("cafe_menu_option_groups")
      .select("id, menu_id, name, is_required, min_select, max_select, sort_order")
      .eq("menu_id", id)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("sort_order")
    const grpList = (groups ?? []) as Array<{ id: string; menu_id: string; name: string; is_required: boolean; min_select: number; max_select: number; sort_order: number }>
    if (grpList.length === 0) return NextResponse.json({ groups: [] })

    const groupIds = grpList.map((g) => g.id)
    const { data: opts } = await svc.supabase
      .from("cafe_menu_options")
      .select("id, group_id, name, price_delta, is_default, sort_order")
      .in("group_id", groupIds)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("sort_order")
    const optMap = new Map<string, Array<{ id: string; name: string; price_delta: number; is_default: boolean; sort_order: number }>>()
    for (const o of (opts ?? [])) {
      const arr = optMap.get(o.group_id) ?? []
      arr.push({ id: o.id, name: o.name, price_delta: o.price_delta, is_default: o.is_default, sort_order: o.sort_order })
      optMap.set(o.group_id, arr)
    }

    return NextResponse.json({
      groups: grpList.map((g) => ({ ...g, options: optMap.get(g.id) ?? [] })),
    })
  } catch (e) {
    return handleRouteError(e, "cafe/menu/options GET")
  }
}

export async function POST(
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

    const parsed = await parseJsonBody<{
      name?: string
      is_required?: boolean
      min_select?: number
      max_select?: number
      sort_order?: number
      options?: Array<{ name: string; price_delta?: number; is_default?: boolean; sort_order?: number }>
    }>(request)
    if (parsed.error) return parsed.error
    const b = parsed.body
    if (!b.name || !Array.isArray(b.options) || b.options.length === 0) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "name + options[] required" }, { status: 400 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 메뉴 소속 검증 (auth.store_uuid 와 일치)
    const { data: menu } = await supabase
      .from("cafe_menu_items").select("id, store_uuid").eq("id", id).maybeSingle()
    if (!menu || menu.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }

    // 그룹 INSERT
    const { data: grp, error: gErr } = await supabase
      .from("cafe_menu_option_groups")
      .insert({
        menu_id: id,
        name: b.name.trim(),
        is_required: b.is_required ?? false,
        min_select: b.min_select ?? 0,
        max_select: b.max_select ?? 1,
        sort_order: b.sort_order ?? 0,
      })
      .select("id")
      .single()
    if (gErr || !grp) return NextResponse.json({ error: "INSERT_FAILED", message: gErr?.message }, { status: 500 })

    // 옵션 일괄 INSERT
    const optRows = b.options.map((o, i) => ({
      group_id: grp.id,
      name: o.name.trim(),
      price_delta: o.price_delta ?? 0,
      is_default: o.is_default ?? false,
      sort_order: o.sort_order ?? i,
    }))
    const { error: oErr } = await supabase.from("cafe_menu_options").insert(optRows)
    if (oErr) return NextResponse.json({ error: "OPT_INSERT_FAILED", message: oErr.message }, { status: 500 })

    return NextResponse.json({ group_id: grp.id, option_count: optRows.length }, { status: 201 })
  } catch (e) {
    return handleRouteError(e, "cafe/menu/options POST")
  }
}
