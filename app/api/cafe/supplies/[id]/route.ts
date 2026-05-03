import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { isValidUUID } from "@/lib/validation"

/**
 * PATCH /api/cafe/supplies/[id] — 소모품 수정 + 수동 조정 (adjust/waste).
 *   body 에 `adjust_delta` + `reason` 보내면 stock 변경 + ledger 추가.
 *   그 외 patch (name/min_stock 등) 는 단순 UPDATE.
 * DELETE /api/cafe/supplies/[id] — soft delete.
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
    if (!isValidUUID(id)) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })

    const parsed = await parseJsonBody<{
      name?: string; category?: string; unit?: string;
      min_stock?: number; unit_cost?: number; notes?: string | null; is_active?: boolean;
      adjust_delta?: number;          // 수동 조정 (음수=폐기/깨짐, 양수=보정)
      adjust_reason?: "adjust" | "waste";
      adjust_notes?: string;
    }>(request)
    if (parsed.error) return parsed.error
    const b = parsed.body

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 1) 메타 update (있으면)
    const patch: Record<string, unknown> = {}
    if (typeof b.name === "string") patch.name = b.name.trim()
    if (typeof b.category === "string") patch.category = b.category.trim()
    if (typeof b.unit === "string") patch.unit = b.unit.trim()
    if (typeof b.min_stock === "number") patch.min_stock = b.min_stock
    if (typeof b.unit_cost === "number") patch.unit_cost = b.unit_cost
    if (b.notes !== undefined) patch.notes = b.notes?.trim() || null
    if (typeof b.is_active === "boolean") patch.is_active = b.is_active

    if (Object.keys(patch).length > 0) {
      const { error: uErr } = await supabase
        .from("cafe_supplies").update(patch)
        .eq("id", id).eq("store_uuid", auth.store_uuid).is("deleted_at", null)
      if (uErr) return NextResponse.json({ error: "UPDATE_FAILED", message: uErr.message }, { status: 500 })
    }

    // 2) 수동 조정 (adjust/waste) — stock + ledger
    if (typeof b.adjust_delta === "number" && b.adjust_delta !== 0) {
      const reason = b.adjust_reason === "waste" ? "waste" : "adjust"
      // current_stock 갱신
      const { data: cur, error: gErr } = await supabase
        .from("cafe_supplies").select("current_stock, store_uuid").eq("id", id).maybeSingle()
      if (gErr || !cur) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
      if (cur.store_uuid !== auth.store_uuid) {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
      }
      const newStock = Number(cur.current_stock) + b.adjust_delta
      await supabase.from("cafe_supplies").update({ current_stock: newStock }).eq("id", id)
      await supabase.from("cafe_supply_ledger").insert({
        store_uuid: auth.store_uuid,
        supply_id: id,
        delta: b.adjust_delta,
        reason,
        resulting_stock: newStock,
        membership_id: auth.membership_id,
        notes: b.adjust_notes?.trim() || null,
      })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleRouteError(e, "cafe/supplies PATCH")
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
      .from("cafe_supplies")
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq("id", id).eq("store_uuid", auth.store_uuid).is("deleted_at", null)
    if (error) return NextResponse.json({ error: "DELETE_FAILED", message: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleRouteError(e, "cafe/supplies DELETE")
  }
}
