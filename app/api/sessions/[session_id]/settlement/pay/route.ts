import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { isValidUUID } from "@/lib/validation"

/**
 * STEP-011C: POST /api/sessions/[session_id]/settlement/pay
 *
 * Transitions a confirmed settlement to paid. Paid is the terminal state
 * in this step — rebuild and recalculation are blocked for both confirmed
 * and paid states by STEP-011A's /settlement POST and STEP-011B's
 * /recalculate route.
 *
 * Rules:
 *   - resolveAuthContext required.
 *   - Session must exist in the caller's store (cross-store → 404).
 *   - A live settlement row must exist for the session.
 *   - settlement.status must be exactly 'confirmed'. draft / paid / other
 *     → 409 INVALID_TRANSITION.
 *   - On success: status='paid', updated_at=now(). confirmed_at is NOT
 *     touched — it still reflects the original confirmation timestamp.
 *   - Audit_events row emitted with action='settlement_paid'.
 */

type Params = { params: Promise<{ session_id: string }> }

type SettlementRow = {
  id: string
  store_uuid: string
  session_id: string
  status: string
  confirmed_at: string | null
  created_at: string
  updated_at: string
}

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

    // 2. Live settlement must exist and be in confirmed state.
    const { data: currentRaw } = await supabase
      .from("settlements")
      .select("id, store_uuid, session_id, status, confirmed_at, created_at, updated_at")
      .eq("session_id", session_id)
      .eq("store_uuid", auth.store_uuid)
      .is("deleted_at", null)
      .maybeSingle()
    const current = currentRaw as SettlementRow | null
    if (!current) {
      return NextResponse.json({ error: "SETTLEMENT_NOT_FOUND" }, { status: 404 })
    }
    if (current.status !== "confirmed") {
      return NextResponse.json(
        {
          error: "INVALID_TRANSITION",
          message: `정산은 confirmed 상태에서만 결제 완료 처리할 수 있습니다. (현재: ${current.status})`,
          from: current.status,
          to: "paid",
        },
        { status: 409 }
      )
    }

    const nowIso = new Date().toISOString()

    // 3. Transition confirmed → paid. Double-guard via expected status.
    const { data: updatedRows, error: upErr } = await supabase
      .from("settlements")
      .update({
        status: "paid",
        updated_at: nowIso,
      })
      .eq("id", current.id)
      .eq("store_uuid", auth.store_uuid)
      .eq("status", "confirmed")
      .is("deleted_at", null)
      .select("id, status, confirmed_at")
    if (upErr) {
      return NextResponse.json({ error: "UPDATE_FAILED", message: upErr.message }, { status: 500 })
    }
    if (!updatedRows || updatedRows.length === 0) {
      return NextResponse.json({ error: "CONCURRENT_TRANSITION" }, { status: 409 })
    }

    // 4. Audit.
    const { error: auditErr } = await supabase.from("audit_events").insert({
      store_uuid: auth.store_uuid,
      actor_profile_id: auth.user_id,
      actor_membership_id: auth.membership_id,
      actor_role: auth.role,
      actor_type: "user",
      session_id,
      entity_table: "settlements",
      entity_id: current.id,
      action: "settlement_paid",
      before: { status: "confirmed" },
      after: { status: "paid" },
      reason: null,
    })
    if (auditErr) {
      console.warn("[settlement/pay] audit insert failed:", auditErr.message)
    }

    return NextResponse.json({
      settlement_id: current.id,
      session_id,
      status: "paid",
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
