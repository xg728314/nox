import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { getMeAccounts } from "@/lib/server/queries/meAccounts"

/**
 * STEP-010: GET/POST /api/me/accounts
 *
 * Personal settlement bank accounts owned by the caller's store_membership.
 * Store-scoped + owner-scoped — callers can only see their own accounts.
 * At most one is_default row at a time (partial unique index enforces this).
 */

type AccountRow = {
  id: string
  bank_name: string | null
  account_holder_name: string | null
  account_number: string | null
  account_type: string | null
  is_default: boolean
  is_active: boolean
  note: string | null
  created_at: string
  updated_at: string
}

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    try {
      const data = await getMeAccounts(auth)
      return NextResponse.json(data)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "err"
      return NextResponse.json({ error: "QUERY_FAILED", message: msg }, { status: 500 })
    }
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const bank_name = typeof body.bank_name === "string" ? body.bank_name.trim() : ""
    const account_holder_name = typeof body.account_holder_name === "string" ? body.account_holder_name.trim() : ""
    const account_number = typeof body.account_number === "string" ? body.account_number.trim() : ""
    const account_type = typeof body.account_type === "string" ? body.account_type.trim() : null
    const note = typeof body.note === "string" ? body.note.trim() : null
    const is_default = body.is_default === true
    const is_active = body.is_active !== false

    if (!bank_name || !account_holder_name || !account_number) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "은행명/예금주/계좌번호는 필수입니다." }, { status: 400 })
    }

    const supabase = supa()

    // If this one becomes default, clear prior defaults for this owner.
    if (is_default) {
      await supabase
        .from("settlement_accounts")
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq("store_uuid", auth.store_uuid)
        .eq("owner_membership_id", auth.membership_id)
        .eq("is_default", true)
        .is("deleted_at", null)
    }

    const { data, error } = await supabase
      .from("settlement_accounts")
      .insert({
        store_uuid: auth.store_uuid,
        owner_membership_id: auth.membership_id,
        bank_name,
        account_holder_name,
        account_number,
        account_type,
        is_default,
        is_active,
        note,
      })
      .select("id")
      .single()
    if (error || !data) {
      return NextResponse.json({ error: "CREATE_FAILED", message: error?.message }, { status: 500 })
    }
    return NextResponse.json({ id: data.id }, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
