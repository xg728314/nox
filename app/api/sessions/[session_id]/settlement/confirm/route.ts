import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { isValidUUID } from "@/lib/validation"

/**
 * STEP-011C: POST /api/sessions/[session_id]/settlement/confirm
 *
 * Transitions a draft settlement to confirmed. Confirmed settlements are
 * immutable — rebuild (STEP-011A) and recalculation (STEP-011B) already
 * refuse to touch a non-draft settlement, so this route is the single
 * entrypoint that writes `confirmed`.
 *
 * Rules:
 *   - resolveAuthContext required (auth.store_uuid is the only source of
 *     scope; never read from body).
 *   - Session must exist in the caller's store (cross-store → 404).
 *   - A live settlement row must exist for the session.
 *   - settlement.status must be exactly 'draft'. Any other state (already
 *     confirmed / paid) → 409 INVALID_TRANSITION.
 *   - On success: status='confirmed', confirmed_at=now(), updated_at=now().
 *     An audit_events row is emitted with entity_table='settlements',
 *     action='settlement_confirmed', before/after status snapshots.
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

    // 2. Live settlement must exist and be in draft state.
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
    if (current.status !== "draft") {
      return NextResponse.json(
        {
          error: "INVALID_TRANSITION",
          message: `정산이 이미 ${current.status} 상태입니다.`,
          from: current.status,
          to: "confirmed",
        },
        { status: 409 }
      )
    }

    const nowIso = new Date().toISOString()

    // 3. Transition draft → confirmed. Double-guard by filtering on the
    //    expected current status so a concurrent request can't race us
    //    into an invalid state.
    const { data: updatedRows, error: upErr } = await supabase
      .from("settlements")
      .update({
        status: "confirmed",
        confirmed_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", current.id)
      .eq("store_uuid", auth.store_uuid)
      .eq("status", "draft")
      .is("deleted_at", null)
      .select("id, status, confirmed_at")
    if (upErr) {
      return NextResponse.json({ error: "UPDATE_FAILED", message: upErr.message }, { status: 500 })
    }
    if (!updatedRows || updatedRows.length === 0) {
      return NextResponse.json({ error: "CONCURRENT_TRANSITION" }, { status: 409 })
    }

    // 4. Audit. Store_uuid scoped. Swallow any audit-layer failure after
    //    logging because the transition itself already succeeded — we do
    //    not want to roll back the authoritative state write.
    const { error: auditErr } = await supabase.from("audit_events").insert({
      store_uuid: auth.store_uuid,
      actor_profile_id: auth.user_id,
      actor_membership_id: auth.membership_id,
      actor_role: auth.role,
      actor_type: "user",
      session_id,
      entity_table: "settlements",
      entity_id: current.id,
      action: "settlement_confirmed",
      before: { status: "draft", confirmed_at: null },
      after: { status: "confirmed", confirmed_at: nowIso },
      reason: null,
    })
    if (auditErr) {
      console.warn("[settlement/confirm] audit insert failed:", auditErr.message)
    }

    return NextResponse.json({
      settlement_id: current.id,
      session_id,
      status: "confirmed",
      confirmed_at: nowIso,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
