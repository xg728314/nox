import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { isValidUUID } from "@/lib/validation"

/**
 * STEP-011D: POST /api/sessions/[session_id]/settlement/payout
 *
 * Records a real money-transfer event against a settlement (or a specific
 * settlement_item). Does NOT touch settlement math — business shares
 * remain frozen. This route only appends a payout_records row.
 *
 * Lifecycle distinction (locked by spec):
 *   - settlement.status = accounting lifecycle (draft/confirmed/paid)
 *   - payout_records    = actual money movement log
 *
 * A settlement may be confirmed with zero payout records, or paid with
 * partial payout logging — this route does not change status.
 */

type Params = { params: Promise<{ session_id: string }> }

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

export async function POST(request: Request, { params }: Params) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "Access denied." }, { status: 403 })
    }
    const { session_id } = await params
    if (!isValidUUID(session_id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const settlement_item_id = typeof body.settlement_item_id === "string" ? body.settlement_item_id : null
    const amountNum = typeof body.amount === "number" ? body.amount : Number(body.amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "amount must be > 0." }, { status: 400 })
    }
    const account_id = typeof body.account_id === "string" ? body.account_id : null
    const payee_account_id = typeof body.payee_account_id === "string" ? body.payee_account_id : null
    const note = typeof body.note === "string" ? body.note : null

    const supabase = supa()

    // 1. Session must exist in caller's store.
    const { data: session } = await supabase
      .from("room_sessions")
      .select("id, store_uuid")
      .eq("id", session_id)
      .eq("store_uuid", auth.store_uuid)
      .maybeSingle()
    if (!session) {
      return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 })
    }

    // 2. Live settlement must exist and be confirmed or paid.
    const { data: settlement } = await supabase
      .from("settlements")
      .select("id, status")
      .eq("session_id", session_id)
      .eq("store_uuid", auth.store_uuid)
      .is("deleted_at", null)
      .maybeSingle()
    if (!settlement) {
      return NextResponse.json({ error: "SETTLEMENT_NOT_FOUND" }, { status: 404 })
    }
    const st = (settlement as { id: string; status: string })
    if (st.status !== "confirmed" && st.status !== "paid") {
      return NextResponse.json(
        { error: "INVALID_STATE", message: `confirmed/paid 상태의 정산만 payout 기록이 가능합니다. (현재: ${st.status})` },
        { status: 409 }
      )
    }

    // 3. Optional item scope check — must belong to this settlement + store.
    if (settlement_item_id) {
      if (!isValidUUID(settlement_item_id)) {
        return NextResponse.json({ error: "BAD_REQUEST", message: "invalid settlement_item_id." }, { status: 400 })
      }
      const { data: item } = await supabase
        .from("settlement_items")
        .select("id, settlement_id, role_type, membership_id")
        .eq("id", settlement_item_id)
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null)
        .maybeSingle()
      if (!item || (item as { settlement_id: string }).settlement_id !== st.id) {
        return NextResponse.json({ error: "ITEM_NOT_IN_SETTLEMENT" }, { status: 404 })
      }
    }

    // 4. Insert payout_records row. Business math is NOT touched.
    const nowIso = new Date().toISOString()
    const { data: inserted, error: insErr } = await supabase
      .from("payout_records")
      .insert({
        store_uuid: auth.store_uuid,
        settlement_id: st.id,
        settlement_item_id,
        amount: amountNum,
        payout_type: "settlement_payout",
        status: "completed",
        account_id,
        payee_account_id,
        note,
        paid_at: nowIso,
      })
      .select("id")
      .single()
    if (insErr || !inserted) {
      return NextResponse.json({ error: "INSERT_FAILED", message: insErr?.message }, { status: 500 })
    }

    // 5. Audit.
    const { error: auditErr } = await supabase.from("audit_events").insert({
      store_uuid: auth.store_uuid,
      actor_profile_id: auth.user_id,
      actor_membership_id: auth.membership_id,
      actor_role: auth.role,
      actor_type: "user",
      session_id,
      entity_table: "payout_records",
      entity_id: inserted.id,
      action: "settlement_payout_recorded",
      before: { settlement_status: st.status },
      after: {
        payout_id: inserted.id,
        settlement_id: st.id,
        settlement_item_id,
        amount: amountNum,
      },
      reason: null,
    })
    if (auditErr) console.warn("[settlement/payout] audit insert failed:", auditErr.message)

    return NextResponse.json({
      payout_id: inserted.id,
      settlement_id: st.id,
      session_id,
      amount: amountNum,
      settlement_item_id,
      paid_at: nowIso,
    }, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
