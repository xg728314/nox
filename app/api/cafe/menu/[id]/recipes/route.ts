import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { isValidUUID } from "@/lib/validation"

/**
 * GET  /api/cafe/menu/[id]/recipes — 메뉴 레시피 라인 list (인증 누구나 — 출력용).
 * PUT  /api/cafe/menu/[id]/recipes — 레시피 일괄 교체 (소유자만).
 *   body: { lines: [{supply_id|null, display_name, qty, unit, note, sort_order}], prep_notes }
 */

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await resolveAuthContext(request)
    const { id } = await context.params
    if (!isValidUUID(id)) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    const svc = createServiceClient()
    if (svc.error) return svc.error
    const [recipesRes, menuRes] = await Promise.all([
      svc.supabase
        .from("cafe_menu_recipes")
        .select("id, supply_id, display_name, qty, unit, note, sort_order, is_active")
        .eq("menu_id", id).is("deleted_at", null).eq("is_active", true)
        .order("sort_order"),
      svc.supabase
        .from("cafe_menu_items")
        .select("id, name, prep_notes")
        .eq("id", id)
        .maybeSingle(),
    ])
    const lines = (recipesRes.data ?? []) as Array<{ id: string; supply_id: string | null; display_name: string | null; qty: number; unit: string | null; note: string | null; sort_order: number; is_active: boolean }>

    // supply_id 가 있는 라인은 supply 이름/단위 enrich
    const supIds = lines.map((l) => l.supply_id).filter(Boolean) as string[]
    const supMap = new Map<string, { name: string; unit: string }>()
    if (supIds.length > 0) {
      const { data: sups } = await svc.supabase
        .from("cafe_supplies").select("id, name, unit").in("id", supIds)
      for (const s of (sups ?? []) as Array<{ id: string; name: string; unit: string }>) {
        supMap.set(s.id, { name: s.name, unit: s.unit })
      }
    }

    return NextResponse.json({
      menu: menuRes.data ?? null,
      lines: lines.map((l) => ({
        ...l,
        supply_name: l.supply_id ? supMap.get(l.supply_id)?.name ?? null : null,
        supply_unit: l.supply_id ? supMap.get(l.supply_id)?.unit ?? null : null,
      })),
    })
  } catch (e) {
    return handleRouteError(e, "cafe/menu/recipes GET")
  }
}

export async function PUT(
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
      lines?: Array<{
        supply_id?: string | null
        display_name?: string | null
        qty: number
        unit?: string | null
        note?: string | null
        sort_order?: number
      }>
      prep_notes?: string | null
    }>(request)
    if (parsed.error) return parsed.error
    const b = parsed.body

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 메뉴 소속 검증
    const { data: menu } = await supabase
      .from("cafe_menu_items").select("id, store_uuid").eq("id", id).maybeSingle()
    if (!menu || menu.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }

    // 기존 레시피 soft delete
    await supabase
      .from("cafe_menu_recipes")
      .update({ deleted_at: new Date().toISOString() })
      .eq("menu_id", id).is("deleted_at", null)

    // prep_notes 업데이트
    if (b.prep_notes !== undefined) {
      await supabase.from("cafe_menu_items")
        .update({ prep_notes: b.prep_notes?.trim() || null })
        .eq("id", id)
    }

    // 새 라인 INSERT
    const lines = (b.lines ?? []).filter((l) => typeof l.qty === "number" && l.qty > 0)
    if (lines.length > 0) {
      const rows = lines.map((l, i) => ({
        menu_id: id,
        supply_id: l.supply_id ?? null,
        display_name: l.display_name?.trim() || null,
        qty: l.qty,
        unit: l.unit?.trim() || null,
        note: l.note?.trim() || null,
        sort_order: l.sort_order ?? i,
      }))
      const { error } = await supabase.from("cafe_menu_recipes").insert(rows)
      if (error) return NextResponse.json({ error: "INSERT_FAILED", message: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, count: lines.length })
  } catch (e) {
    return handleRouteError(e, "cafe/menu/recipes PUT")
  }
}
