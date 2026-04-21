import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { isValidUUID } from "@/lib/validation"

/**
 * PATCH  /api/inventory/items/[item_id] — 품목 수정
 * DELETE /api/inventory/items/[item_id] — 품목 비활성화 (soft delete)
 */

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ item_id: string }> }
) {
  try {
    const authContext = await resolveAuthContext(request)
    if (authContext.role !== "owner") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const { item_id } = await params
    if (!item_id || !isValidUUID(item_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "item_id must be a valid UUID." }, { status: 400 })
    }

    let body: { name?: string; category?: string; unit?: string; min_stock?: number; unit_cost?: number; store_price?: number; cost_per_box?: number; units_per_box?: number; is_active?: boolean }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: existing } = await supabase
      .from("inventory_items")
      .select("id")
      .eq("id", item_id)
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .maybeSingle()

    if (!existing) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.name !== undefined) updateData.name = body.name.trim()
    if (body.category !== undefined) updateData.category = body.category.trim()
    if (body.unit !== undefined) updateData.unit = body.unit.trim()
    if (body.min_stock !== undefined) updateData.min_stock = body.min_stock
    if (body.unit_cost !== undefined) updateData.unit_cost = body.unit_cost
    if (body.store_price !== undefined) updateData.store_price = body.store_price
    if (body.cost_per_box !== undefined) updateData.cost_per_box = body.cost_per_box
    if (body.units_per_box !== undefined) updateData.units_per_box = body.units_per_box
    if (body.is_active !== undefined) updateData.is_active = body.is_active
    // Auto-compute cost_per_unit if box pricing changed
    if (body.cost_per_box !== undefined || body.units_per_box !== undefined) {
      const cpb = (body.cost_per_box ?? 0) as number
      const upb = (body.units_per_box ?? 1) as number
      updateData.cost_per_unit = upb > 0 ? Math.round(cpb / upb) : 0
    }

    const { data: updated, error: updateError } = await supabase
      .from("inventory_items")
      .update(updateData)
      .eq("id", item_id)
      .eq("store_uuid", authContext.store_uuid)
      .select("id, name, category, unit, current_stock, min_stock, unit_cost, store_price, cost_per_box, units_per_box, cost_per_unit, is_active, updated_at")
      .single()

    if (updateError || !updated) {
      return NextResponse.json({ error: "UPDATE_FAILED" }, { status: 500 })
    }

    await supabase.from("audit_events").insert({
      store_uuid: authContext.store_uuid,
      actor_profile_id: authContext.user_id,
      actor_membership_id: authContext.membership_id,
      actor_role: authContext.role,
      actor_type: authContext.role,
      entity_table: "inventory_items",
      entity_id: item_id,
      action: "inventory_item_updated",
      after: updateData,
    })

    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ item_id: string }> }
) {
  try {
    const authContext = await resolveAuthContext(request)
    if (authContext.role !== "owner") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const { item_id } = await params
    if (!item_id || !isValidUUID(item_id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { error: delError } = await supabase
      .from("inventory_items")
      .update({ deleted_at: new Date().toISOString(), is_active: false, updated_at: new Date().toISOString() })
      .eq("id", item_id)
      .eq("store_uuid", authContext.store_uuid)

    if (delError) {
      return NextResponse.json({ error: "DELETE_FAILED" }, { status: 500 })
    }

    await supabase.from("audit_events").insert({
      store_uuid: authContext.store_uuid,
      actor_profile_id: authContext.user_id,
      actor_membership_id: authContext.membership_id,
      actor_role: authContext.role,
      actor_type: authContext.role,
      entity_table: "inventory_items",
      entity_id: item_id,
      action: "inventory_item_deleted",
    })

    return NextResponse.json({ deleted: true })
  } catch (error) {
    if (error instanceof AuthError) {
      const status = error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
