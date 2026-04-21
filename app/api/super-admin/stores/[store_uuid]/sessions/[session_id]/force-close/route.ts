import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * POST /api/super-admin/stores/[store_uuid]/sessions/[session_id]/force-close
 *
 * Super-admin-only audited write. Force-closes a single active session by
 * calling the existing `close_session_atomic` RPC (STEP-4B). No direct
 * `UPDATE room_sessions` — all participant transitions, chat close, and
 * atomicity guarantees from the normal checkout path are preserved.
 *
 * Safety model:
 *   - super_admin gate (auth.is_super_admin)
 *   - store scope gate: route params must exactly identify the target row;
 *     we verify (store_uuid, session_id) pair before acting.
 *   - reason required, trimmed, min 3 chars — persisted in audit metadata.
 *   - The underlying RPC still enforces: business day open, no unresolved
 *     participants, no invalid order prices, no sale < store price. If any
 *     of those fail, the force-close is REFUSED and the original session
 *     state is preserved — this is intentional: the "force" here is about
 *     bypassing the operator's UI path, NOT bypassing financial guards.
 *     Operators must first resolve those preconditions (or escalate). The
 *     rejection is logged with action_detail='force_close_session' and
 *     result='rejected' for audit completeness.
 *   - Cross-store reads/writes are audited in admin_access_logs.
 */

const REASON_MIN = 3
const REASON_MAX = 500

export async function POST(
  request: Request,
  { params }: { params: Promise<{ store_uuid: string; session_id: string }> }
) {
  try {
    const authContext = await resolveAuthContext(request)
    if (!authContext.is_super_admin) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Super admin access required." },
        { status: 403 }
      )
    }

    const { store_uuid, session_id } = await params
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRe.test(store_uuid) || !uuidRe.test(session_id)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "store_uuid and session_id must be valid UUIDs." },
        { status: 400 }
      )
    }

    // Parse + validate reason
    const body = (await request.json().catch(() => ({}))) as { reason?: unknown }
    const rawReason = typeof body.reason === "string" ? body.reason.trim() : ""
    if (!rawReason || rawReason.length < REASON_MIN) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: `reason must be at least ${REASON_MIN} characters.` },
        { status: 400 }
      )
    }
    const reason = rawReason.slice(0, REASON_MAX)

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Store existence check
    const { data: storeRow } = await supabase
      .from("stores")
      .select("id")
      .eq("id", store_uuid)
      .is("deleted_at", null)
      .maybeSingle()
    if (!storeRow) {
      return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 })
    }

    // Pre-fetch session — lets us return 404/409 before involving the RPC,
    // AND lets us capture `previous_status` for the audit record. The RPC
    // re-locks the row with FOR UPDATE so there's no TOCTOU window for the
    // actual transition.
    const { data: sessionRow } = await supabase
      .from("room_sessions")
      .select("id, store_uuid, status, started_at")
      .eq("id", session_id)
      .eq("store_uuid", store_uuid)
      .is("deleted_at", null)
      .maybeSingle()
    if (!sessionRow) {
      // Session doesn't exist OR belongs to a different store. Log denial
      // so probing is visible.
      await logAudit(supabase, {
        actor_user_id: authContext.user_id,
        target_store_uuid: store_uuid,
        screen: `/super-admin/stores/${store_uuid}`,
        action_detail: "force_close_session",
        metadata: { session_id, reason, result: "rejected", denial_reason: "SESSION_NOT_FOUND" },
      })
      return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 })
    }

    const previousStatus = sessionRow.status as string
    if (previousStatus !== "active") {
      await logAudit(supabase, {
        actor_user_id: authContext.user_id,
        target_store_uuid: store_uuid,
        screen: `/super-admin/stores/${store_uuid}`,
        action_detail: "force_close_session",
        metadata: { session_id, previous_status: previousStatus, reason, result: "rejected", denial_reason: "SESSION_NOT_ACTIVE" },
      })
      return NextResponse.json(
        { error: "SESSION_NOT_ACTIVE", message: `세션이 활성 상태가 아닙니다. 현재 상태: ${previousStatus}` },
        { status: 409 }
      )
    }

    // Invoke the existing atomic close RPC. `p_closed_by` is the super_admin's
    // user_id so the session's `closed_by` column accurately reflects who
    // triggered the close (distinguishable from regular operator checkout
    // via the audit log).
    const { data: rpcData, error: rpcError } = await supabase.rpc("close_session_atomic", {
      p_session_id: session_id,
      p_store_uuid: store_uuid,
      p_closed_by: authContext.user_id,
    })

    if (rpcError) {
      const msg = rpcError.message ?? ""
      // Map RPC codes to HTTP — mirror /api/sessions/checkout's STEP-4C
      // mapping. Any failure is audited with the code so operators can
      // debug why force-close didn't apply.
      let status = 500
      let code = "FORCE_CLOSE_FAILED"
      let uiMsg = "강제 종료 실패"
      if (msg.startsWith("SESSION_NOT_FOUND")) {
        status = 404; code = "SESSION_NOT_FOUND"; uiMsg = "세션을 찾을 수 없습니다."
      } else if (msg.startsWith("SESSION_NOT_ACTIVE")) {
        status = 409; code = "SESSION_NOT_ACTIVE"; uiMsg = "세션이 이미 종료되었거나 활성 상태가 아닙니다."
      } else if (msg.startsWith("BUSINESS_DAY_CLOSED")) {
        status = 409; code = "BUSINESS_DAY_CLOSED"; uiMsg = "영업일이 이미 마감되었습니다."
      } else if (msg.startsWith("UNRESOLVED_PARTICIPANTS")) {
        status = 409; code = "UNRESOLVED_PARTICIPANTS"; uiMsg = "미확정 참가자가 있어 종료할 수 없습니다. 먼저 participant 종목/시간을 확정해주세요."
      } else if (msg.startsWith("INVALID_ORDER_PRICES")) {
        status = 409; code = "INVALID_ORDER_PRICES"; uiMsg = "가격 미설정 주문이 있어 종료할 수 없습니다."
      } else if (msg.startsWith("PRICE_VALIDATION_FAILED")) {
        status = 409; code = "PRICE_VALIDATION_FAILED"; uiMsg = "판매가 < 입금가인 주문이 있어 종료할 수 없습니다."
      } else if (msg.startsWith("SESSION_CLOSE_RACE")) {
        status = 409; code = "SESSION_STATE_CHANGED"; uiMsg = "세션 상태가 동시에 변경되었습니다. 다시 시도해 주세요."
      }

      await logAudit(supabase, {
        actor_user_id: authContext.user_id,
        target_store_uuid: store_uuid,
        screen: `/super-admin/stores/${store_uuid}`,
        action_detail: "force_close_session",
        metadata: {
          session_id,
          previous_status: previousStatus,
          reason,
          result: "rejected",
          denial_reason: code,
          rpc_error: msg,
        },
      })
      return NextResponse.json({ error: code, message: uiMsg }, { status })
    }

    const result = (rpcData ?? {}) as {
      session_id: string
      status: string
      ended_at: string
      participants_closed_count: number
      chat_closed: boolean
    }

    // Success — write audit. This is the authoritative record of the
    // force-close; it sits alongside the regular `session_checkout` audit
    // event that the RPC's caller would normally have written. We do NOT
    // duplicate the operational audit here — this is a security audit,
    // explicitly tagged action_detail='force_close_session'.
    await logAudit(supabase, {
      actor_user_id: authContext.user_id,
      target_store_uuid: store_uuid,
      screen: `/super-admin/stores/${store_uuid}`,
      action_detail: "force_close_session",
      metadata: {
        session_id,
        previous_status: previousStatus,
        reason,
        result: "success",
        ended_at: result.ended_at,
        participants_closed_count: result.participants_closed_count,
        chat_closed: result.chat_closed,
      },
    })

    return NextResponse.json({
      ok: true,
      session_id: result.session_id,
      status: result.status,
      ended_at: result.ended_at,
      participants_closed_count: result.participants_closed_count,
      chat_closed: result.chat_closed,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" ? 401 :
        error.type === "AUTH_INVALID" ? 401 :
        error.type === "MEMBERSHIP_NOT_FOUND" ? 403 :
        error.type === "MEMBERSHIP_INVALID" ? 403 :
        error.type === "MEMBERSHIP_NOT_APPROVED" ? 403 :
        error.type === "SERVER_CONFIG_ERROR" ? 500 :
        500
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}

/** Best-effort audit write. Failures never propagate — audit is
 *  observability, not a security gate. */
async function logAudit(
  supabase: SupabaseClient,
  args: {
    actor_user_id: string
    target_store_uuid: string
    screen: string
    action_detail: string
    metadata: Record<string, unknown>
  }
) {
  try {
    await supabase.from("admin_access_logs").insert({
      actor_user_id: args.actor_user_id,
      actor_role: "super_admin",
      target_store_uuid: args.target_store_uuid,
      screen: args.screen,
      action_kind: "write",
      action_detail: args.action_detail,
      metadata: args.metadata,
    })
  } catch {
    /* swallow */
  }
}
