import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { isValidUUID } from "@/lib/validation"
import { recalculateAndPersist } from "@/lib/settlement/computeSessionShares"

/**
 * STEP-011B: POST /api/sessions/[session_id]/settlement/recalculate
 *
 * Triggers the calculation engine to recompute hostess / manager / store
 * shares from confirmed source rows and persist them into
 * session_participants. Does NOT write the settlements / settlement_items
 * tables — that's STEP-011A's /settlement route, which reads the stored
 * share fields after this call lands.
 *
 * Rules enforced here (not in the library):
 *   - resolveAuthContext required.
 *   - session must exist in the caller's store_uuid (cross-store 404).
 *   - if a live settlement row exists and its status is not "draft",
 *     the recalculation is rejected — confirmed/paid settlements are
 *     immutable per STEP-011A's immutability contract, so their underlying
 *     share fields must not be recomputed either.
 *   - session must not be "active" (same gate as STEP-011A's settlement
 *     POST).
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

    const supabase = supa()

    // 1. Store-scoped session existence.
    const { data: session } = await supabase
      .from("room_sessions")
      .select("id, store_uuid, status")
      .eq("id", session_id)
      .eq("store_uuid", auth.store_uuid)
      .maybeSingle()
    if (!session) {
      return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 })
    }
    if ((session as { status: string }).status === "active") {
      return NextResponse.json(
        { error: "SESSION_STILL_ACTIVE", message: "세션이 아직 진행 중입니다." },
        { status: 409 }
      )
    }

    // 2. Immutability gate — if a confirmed or paid settlement exists, the
    //    participant share fields on which it was built are frozen too.
    const { data: existing } = await supabase
      .from("settlements")
      .select("id, status")
      .eq("session_id", session_id)
      .eq("store_uuid", auth.store_uuid)
      .is("deleted_at", null)
      .maybeSingle()
    if (existing && (existing as { status: string }).status !== "draft") {
      return NextResponse.json(
        { error: "SETTLEMENT_LOCKED", message: `정산이 이미 ${(existing as { status: string }).status} 상태입니다.` },
        { status: 409 }
      )
    }

    // 3. Run the engine.
    const result = await recalculateAndPersist(supabase, session_id, auth.store_uuid)

    return NextResponse.json({
      session_id,
      participant_count: result.participants.length,
      liquor_margin: result.liquor_margin,
      store_revenue: result.store_revenue,
      store_profit: result.store_profit,
      totals: result.totals,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    const msg = e instanceof Error ? e.message : "INTERNAL_ERROR"
    return NextResponse.json({ error: "INTERNAL_ERROR", message: msg }, { status: 500 })
  }
}
