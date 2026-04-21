import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { isValidUUID } from "@/lib/validation"

/**
 * STEP-010: PATCH/DELETE /api/me/accounts/[id]
 *
 * Store + owner scoped — the caller can only modify their own rows. DELETE
 * is a soft-delete (deleted_at = now()). PATCH accepts any subset of the
 * editable fields; toggling is_default clears prior defaults.
 */

type Params = { params: Promise<{ id: string }> }

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const auth = await resolveAuthContext(request)
    const { id } = await params
    if (!isValidUUID(id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof body.bank_name === "string") patch.bank_name = body.bank_name.trim()
    if (typeof body.account_holder_name === "string") patch.account_holder_name = body.account_holder_name.trim()
    if (typeof body.account_number === "string") patch.account_number = body.account_number.trim()
    if (typeof body.account_type === "string") patch.account_type = body.account_type.trim()
    if (typeof body.note === "string") patch.note = body.note
    if (typeof body.is_active === "boolean") patch.is_active = body.is_active
    const settingDefault = body.is_default === true

    const supabase = supa()

    // Scope check — must belong to caller.
    const { data: existing } = await supabase
      .from("settlement_accounts")
      .select("id")
      .eq("id", id)
      .eq("store_uuid", auth.store_uuid)
      .eq("owner_membership_id", auth.membership_id)
      .is("deleted_at", null)
      .maybeSingle()
    if (!existing) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }

    if (settingDefault) {
      await supabase
        .from("settlement_accounts")
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq("store_uuid", auth.store_uuid)
        .eq("owner_membership_id", auth.membership_id)
        .eq("is_default", true)
        .is("deleted_at", null)
      patch.is_default = true
    } else if (body.is_default === false) {
      patch.is_default = false
    }

    const { error } = await supabase
      .from("settlement_accounts")
      .update(patch)
      .eq("id", id)
      .eq("store_uuid", auth.store_uuid)
      .eq("owner_membership_id", auth.membership_id)
    if (error) {
      return NextResponse.json({ error: "UPDATE_FAILED", message: error.message }, { status: 500 })
    }
    return NextResponse.json({ id })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const auth = await resolveAuthContext(request)
    const { id } = await params
    if (!isValidUUID(id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    const supabase = supa()
    const { data, error } = await supabase
      .from("settlement_accounts")
      .update({ deleted_at: new Date().toISOString(), is_default: false, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("store_uuid", auth.store_uuid)
      .eq("owner_membership_id", auth.membership_id)
      .is("deleted_at", null)
      .select("id")
    if (error) {
      return NextResponse.json({ error: "DELETE_FAILED", message: error.message }, { status: 500 })
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }
    return NextResponse.json({ id })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
