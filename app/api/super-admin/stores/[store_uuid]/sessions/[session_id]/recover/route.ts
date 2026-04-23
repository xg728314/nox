import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { logAdminAccess } from "@/lib/audit/adminAccessLog"

/**
 * POST /api/super-admin/stores/[store_uuid]/sessions/[session_id]/recover
 *
 * Session state recovery — DIAGNOSTIC + READINESS ASSESSMENT.
 *
 * Scope constraints (locked by DB + policy):
 *   - room_sessions.status values are ('active','closed','void'). No
 *     'checkout_pending' state exists in the DB — that is a UI shorthand.
 *   - STEP-4B `trg_session_status_transition` hard-blocks closed→active
 *     and void→active. Any attempt (via direct UPDATE, this route, or
 *     anything else) raises ILLEGAL_SESSION_TRANSITION.
 *   - Policy also forbids terminal→active.
 *
 * Consequence: there is NO valid "state mutation" this endpoint can
 * perform — the DB model already prohibits the only operations the spec
 * rules out. The recovery action that actually unblocks a stuck session
 * is a combination of force-leave/force-clean (participants) and
 * override-price (orders), performed while the session is still active.
 *
 * This route therefore:
 *   1. Inspects the session + all blockers that `close_session_atomic`
 *      would reject on.
 *   2. Returns a structured readiness assessment: whether force-close
 *      would succeed right now, and if not, exactly which recovery steps
 *      remain.
 *   3. Writes an audit record tagged action_detail='recover_session' so
 *      every diagnostic invocation is traceable alongside the mutation
 *      actions taken afterwards.
 *
 * No mutation. Safe to call repeatedly.
 */

const REASON_MIN = 3
const REASON_MAX = 500
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(
  request: Request,
  { params }: { params: Promise<{ store_uuid: string; session_id: string }> }
) {
  try {
    const auth = await resolveAuthContext(request)
    if (!auth.is_super_admin) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const { store_uuid, session_id } = await params
    if (!UUID_RE.test(store_uuid) || !UUID_RE.test(session_id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

    const body = (await request.json().catch(() => ({}))) as { reason?: unknown }
    const rawReason = typeof body.reason === "string" ? body.reason.trim() : ""
    if (rawReason.length < REASON_MIN) {
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
    const SCREEN = `/super-admin/stores/${store_uuid}`

    const { data: sessionRow } = await supabase
      .from("room_sessions")
      .select("id, status, business_day_id, started_at, ended_at, manager_name")
      .eq("id", session_id)
      .eq("store_uuid", store_uuid)
      .is("deleted_at", null)
      .maybeSingle()
    if (!sessionRow) {
      await logAdminAccess(supabase, {
        actor_user_id: auth.user_id, target_store_uuid: store_uuid, screen: SCREEN,
        action_kind: "write", action_detail: "recover_session",
        metadata: { session_id, reason, result: "rejected", denial_reason: "SESSION_NOT_FOUND" },
      })
      return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 })
    }

    const status = sessionRow.status as string

    // Terminal check — the DB will block any attempt to un-terminate.
    if (status === "closed" || status === "void") {
      await logAdminAccess(supabase, {
        actor_user_id: auth.user_id, target_store_uuid: store_uuid, screen: SCREEN,
        action_kind: "write", action_detail: "recover_session",
        metadata: {
          session_id, reason, result: "rejected",
          denial_reason: "TERMINAL_STATE_NOT_RECOVERABLE",
          current_status: status,
        },
      })
      return NextResponse.json(
        {
          error: "TERMINAL_STATE_NOT_RECOVERABLE",
          message: `세션이 이미 ${status} 상태입니다. 종결 상태는 복구할 수 없습니다 (DB 트리거 규정).`,
          current_status: status,
        },
        { status: 409 }
      )
    }

    // Active session — collect blockers that close_session_atomic would
    // reject on. These are the exact same predicates the RPC uses.
    const { data: bizDay } = await supabase
      .from("store_operating_days")
      .select("id, status, business_date")
      .eq("id", sessionRow.business_day_id as string)
      .eq("store_uuid", store_uuid)
      .is("deleted_at", null)
      .maybeSingle()
    const businessDayOk = !!bizDay && bizDay.status !== "closed"

    const { data: activeParticipants } = await supabase
      .from("session_participants")
      .select("id, external_name, category, time_minutes, status")
      .eq("session_id", session_id)
      .eq("store_uuid", store_uuid)
      .eq("status", "active")
      .is("deleted_at", null)
    const unresolvedParticipants = (activeParticipants ?? []).filter(
      (p: { category: string | null; time_minutes: number | null }) =>
        !p.category || !p.time_minutes
    )
    const activeParticipantCount = activeParticipants?.length ?? 0

    const { data: orders } = await supabase
      .from("orders")
      .select("id, item_name, qty, store_price, sale_price")
      .eq("session_id", session_id)
      .eq("store_uuid", store_uuid)
      .is("deleted_at", null)
    const invalidPriceOrders = (orders ?? []).filter(
      (o: { store_price: number | null; sale_price: number | null }) =>
        o.store_price == null || o.sale_price == null
    )
    const mismatchPriceOrders = (orders ?? []).filter(
      (o: { store_price: number | null; sale_price: number | null }) =>
        o.store_price != null && o.sale_price != null && o.sale_price < o.store_price
    )

    const issues: string[] = []
    const nextActions: string[] = []
    if (!businessDayOk) {
      issues.push(bizDay ? `영업일이 ${bizDay.status} 상태입니다.` : "영업일 정보를 찾을 수 없습니다.")
      nextActions.push("영업일을 재오픈하거나 owner 확인이 필요합니다. (super_admin이 수정할 수 없음)")
    }
    if (activeParticipantCount > 0) {
      issues.push(`활성 참가자 ${activeParticipantCount}명 존재 (force-close는 내부에서 left 처리하므로 정상이지만, unresolved 종목/시간 존재 시 실패).`)
    }
    if (unresolvedParticipants.length > 0) {
      issues.push(`종목/시간 미확정 참가자 ${unresolvedParticipants.length}명.`)
      nextActions.push(`미확정 참가자 정리 — "참가자 전체 정리" 사용 (활성 참가자를 left 처리).`)
    }
    if (invalidPriceOrders.length > 0) {
      issues.push(`가격 미설정 주문 ${invalidPriceOrders.length}건.`)
      nextActions.push("가격 미설정 주문을 1건씩 '가격 수정'으로 복구 (복수 주문 일괄 수정은 미지원).")
    }
    if (mismatchPriceOrders.length > 0) {
      issues.push(`판매가 < 입금가인 주문 ${mismatchPriceOrders.length}건.`)
      nextActions.push("비정상 가격 주문을 1건씩 '가격 수정'으로 복구.")
    }

    const recoverable = businessDayOk && unresolvedParticipants.length === 0 &&
      invalidPriceOrders.length === 0 && mismatchPriceOrders.length === 0
    if (recoverable) {
      nextActions.push("차단 요소 없음 — '강제 종료'를 바로 실행할 수 있습니다.")
    }

    await logAdminAccess(supabase, {
      actor_user_id: auth.user_id, target_store_uuid: store_uuid, screen: SCREEN,
      action_kind: "write", action_detail: "recover_session",
      metadata: {
        session_id, reason,
        result: "diagnostic",
        before_state: { status },
        after_state: { status },
        readiness: {
          force_close_ready: recoverable,
          active_participant_count: activeParticipantCount,
          unresolved_participant_count: unresolvedParticipants.length,
          invalid_price_order_count: invalidPriceOrders.length,
          mismatch_price_order_count: mismatchPriceOrders.length,
          business_day_ok: businessDayOk,
        },
      },
    })

    return NextResponse.json({
      ok: true,
      session_id,
      current_status: status,
      recoverable,
      issues,
      next_actions: nextActions,
      detail: {
        business_day: bizDay
          ? { id: bizDay.id, status: bizDay.status, business_date: bizDay.business_date }
          : null,
        active_participant_count: activeParticipantCount,
        unresolved_participants: unresolvedParticipants.map((p: { id: string; external_name: string | null; category: string | null; time_minutes: number | null }) => ({
          id: p.id,
          external_name: p.external_name,
          category: p.category,
          time_minutes: p.time_minutes,
        })),
        invalid_price_orders: invalidPriceOrders.map((o: { id: string; item_name: string | null }) => ({
          id: o.id, item_name: o.item_name,
        })),
        mismatch_price_orders: mismatchPriceOrders.map((o: { id: string; item_name: string | null; store_price: number | null; sale_price: number | null }) => ({
          id: o.id, item_name: o.item_name, store_price: o.store_price, sale_price: o.sale_price,
        })),
      },
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 :
        error.type === "SERVER_CONFIG_ERROR" ? 500 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
