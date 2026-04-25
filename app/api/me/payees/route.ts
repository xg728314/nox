import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { getMePayees } from "@/lib/server/queries/me/payees"

/**
 * STEP-010: GET/POST /api/me/payees
 *
 * Store-scoped payee accounts. linked_membership_id is optional — a payee
 * may be an external party with no membership in this store. Listed to all
 * authenticated members of the store so they can pick a target for future
 * settlement payouts.
 */

type PayeeRow = {
  id: string
  linked_membership_id: string | null
  payee_name: string | null
  role_type: string | null
  bank_name: string | null
  account_holder_name: string | null
  account_number: string | null
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
      const data = await getMePayees(auth)
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

    const payee_name = typeof body.payee_name === "string" ? body.payee_name.trim() : ""
    const role_type = typeof body.role_type === "string" ? body.role_type.trim() : null
    const bank_name = typeof body.bank_name === "string" ? body.bank_name.trim() : ""
    const account_holder_name = typeof body.account_holder_name === "string" ? body.account_holder_name.trim() : ""
    const account_number = typeof body.account_number === "string" ? body.account_number.trim() : ""
    const note = typeof body.note === "string" ? body.note : null
    const is_active = body.is_active !== false
    const linked_membership_id = typeof body.linked_membership_id === "string" && body.linked_membership_id
      ? body.linked_membership_id
      : null

    if (!payee_name || !bank_name || !account_holder_name || !account_number) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "지급 대상명/은행명/예금주/계좌번호는 필수입니다." }, { status: 400 })
    }

    const supabase = supa()
    const { data, error } = await supabase
      .from("payee_accounts")
      .insert({
        store_uuid: auth.store_uuid,
        linked_membership_id,
        payee_name,
        role_type,
        bank_name,
        account_holder_name,
        account_number,
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
