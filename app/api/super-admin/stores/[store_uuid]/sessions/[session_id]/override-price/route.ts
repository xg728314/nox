import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { logAdminAccess } from "@/lib/audit/adminAccessLog"

/**
 * POST /api/super-admin/stores/[store_uuid]/sessions/[session_id]/override-price
 *
 * Body: { total_amount: number, reason: string }
 *
 * Purpose: resolve orders that block `close_session_atomic` because of
 *   (a) store_price IS NULL OR sale_price IS NULL → INVALID_ORDER_PRICES
 *   (b) sale_price < store_price                  → PRICE_VALIDATION_FAILED
 *
 * Safety scope — this endpoint DOES NOT invent settlement economics:
 *   - Acts on exactly ONE problem order. If the session has multiple
 *     orders that fail the price checks, we refuse with 409 and require
 *     the operator to resolve them individually (or re-evaluate which
 *     orders are legitimate). Auto-allocating a single total across
 *     multiple orders would fabricate economics.
 *   - Sets `store_price = sale_price = floor(total_amount / qty)` so:
 *       customer_amount = qty * sale_price = floor(total/qty) * qty <= total
 *     Zero manager margin by construction — the safest "just get to close"
 *     posture. Operator/owner can reconcile post-close if the force-close
 *     session needs a fine-grained receipt.
 *   - `total_amount` must be >= (existing customer_amount if any) and
 *     non-negative — prevents accidental reduction of already-charged
 *     amounts and clearly-invalid negative totals.
 *
 * Reuses the existing orders table columns (no new schema). The session
 * must be active for the DB trigger `trg_block_orders_on_nonactive_session`
 * to permit the write.
 */

const REASON_MIN = 3
const REASON_MAX = 500
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Sanity cap — mirrors "비정상 과대값 방지". Pragmatic upper bound rather
// than a business rule. 10억 is far above any realistic single-order total.
const MAX_TOTAL = 1_000_000_000

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

    const body = (await request.json().catch(() => ({}))) as { total_amount?: unknown; reason?: unknown }
    const rawReason = typeof body.reason === "string" ? body.reason.trim() : ""
    if (rawReason.length < REASON_MIN) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: `reason must be at least ${REASON_MIN} characters.` },
        { status: 400 }
      )
    }
    const reason = rawReason.slice(0, REASON_MAX)

    const totalRaw = body.total_amount
    if (typeof totalRaw !== "number" || !Number.isFinite(totalRaw) || Math.floor(totalRaw) !== totalRaw) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "total_amount must be a non-negative integer." },
        { status: 400 }
      )
    }
    if (totalRaw < 0) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "total_amount cannot be negative." },
        { status: 400 }
      )
    }
    if (totalRaw > MAX_TOTAL) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "total_amount exceeds sanity cap." },
        { status: 400 }
      )
    }
    const totalAmount = totalRaw

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const SCREEN = `/super-admin/stores/${store_uuid}`

    // Session scope check
    const { data: sessionRow } = await supabase
      .from("room_sessions")
      .select("id, status")
      .eq("id", session_id)
      .eq("store_uuid", store_uuid)
      .is("deleted_at", null)
      .maybeSingle()
    if (!sessionRow) {
      await logAdminAccess(supabase, {
        actor_user_id: auth.user_id, target_store_uuid: store_uuid, screen: SCREEN,
        action_kind: "write", action_detail: "override_price",
        metadata: { session_id, total_amount: totalAmount, reason, result: "rejected", denial_reason: "SESSION_NOT_FOUND" },
      })
      return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 })
    }
    if (sessionRow.status !== "active") {
      await logAdminAccess(supabase, {
        actor_user_id: auth.user_id, target_store_uuid: store_uuid, screen: SCREEN,
        action_kind: "write", action_detail: "override_price",
        metadata: { session_id, total_amount: totalAmount, reason, result: "rejected", denial_reason: "SESSION_NOT_ACTIVE", previous_session_status: sessionRow.status },
      })
      return NextResponse.json(
        { error: "SESSION_NOT_ACTIVE", message: `세션이 활성 상태가 아닙니다.` },
        { status: 409 }
      )
    }

    // Find problem orders — same predicate close_session_atomic uses.
    const { data: allOrders } = await supabase
      .from("orders")
      .select("id, item_name, qty, unit_price, store_price, sale_price, customer_amount")
      .eq("session_id", session_id)
      .eq("store_uuid", store_uuid)
      .is("deleted_at", null)

    type OrderRow = {
      id: string
      item_name: string | null
      qty: number
      unit_price: number
      store_price: number | null
      sale_price: number | null
      customer_amount: number | null
    }
    const problem = (allOrders ?? []).filter((o: OrderRow) => {
      if (o.store_price == null || o.sale_price == null) return true
      if (o.sale_price < o.store_price) return true
      return false
    }) as OrderRow[]

    if (problem.length === 0) {
      await logAdminAccess(supabase, {
        actor_user_id: auth.user_id, target_store_uuid: store_uuid, screen: SCREEN,
        action_kind: "write", action_detail: "override_price",
        metadata: { session_id, total_amount: totalAmount, reason, result: "rejected", denial_reason: "NO_PROBLEM_ORDER" },
      })
      return NextResponse.json(
        { error: "NO_PROBLEM_ORDER", message: "수정이 필요한 주문이 없습니다." },
        { status: 409 }
      )
    }
    if (problem.length > 1) {
      await logAdminAccess(supabase, {
        actor_user_id: auth.user_id, target_store_uuid: store_uuid, screen: SCREEN,
        action_kind: "write", action_detail: "override_price",
        metadata: {
          session_id, total_amount: totalAmount, reason,
          result: "rejected", denial_reason: "MULTIPLE_PROBLEM_ORDERS",
          problem_order_count: problem.length,
          problem_order_ids: problem.map((p) => p.id),
        },
      })
      return NextResponse.json(
        {
          error: "MULTIPLE_PROBLEM_ORDERS",
          message: `가격 문제 주문이 ${problem.length}개입니다. 복수 주문 일괄 수정은 지원하지 않습니다. 개별 주문을 확인해주세요.`,
          problem_order_ids: problem.map((p) => p.id),
        },
        { status: 409 }
      )
    }

    const target = problem[0]
    if (!target.qty || target.qty <= 0) {
      await logAdminAccess(supabase, {
        actor_user_id: auth.user_id, target_store_uuid: store_uuid, screen: SCREEN,
        action_kind: "write", action_detail: "override_price",
        metadata: { session_id, order_id: target.id, total_amount: totalAmount, reason, result: "rejected", denial_reason: "INVALID_QTY" },
      })
      return NextResponse.json(
        { error: "INVALID_QTY", message: "주문 수량이 비정상입니다. 운영자가 주문을 다시 확인해야 합니다." },
        { status: 409 }
      )
    }

    // Zero-manager-margin replacement: store_price = sale_price = floor(total/qty).
    // customer_amount is computed as qty * sale_price (matches how existing
    // bill/receipt display paths aggregate customer_amount from orders).
    const newUnit = Math.floor(totalAmount / target.qty)
    const newCustomerAmount = newUnit * target.qty

    // Do NOT allow the override to REDUCE a pre-existing customer_amount —
    // that would contradict the invariant that the customer was already
    // charged more. If operator truly wants to reduce, they must cancel
    // the order through the normal operator flow.
    if (target.customer_amount != null && newCustomerAmount < target.customer_amount) {
      await logAdminAccess(supabase, {
        actor_user_id: auth.user_id, target_store_uuid: store_uuid, screen: SCREEN,
        action_kind: "write", action_detail: "override_price",
        metadata: {
          session_id, order_id: target.id, total_amount: totalAmount, reason,
          result: "rejected", denial_reason: "REDUCES_EXISTING_CHARGE",
          existing_customer_amount: target.customer_amount,
          proposed_customer_amount: newCustomerAmount,
        },
      })
      return NextResponse.json(
        {
          error: "REDUCES_EXISTING_CHARGE",
          message: "기존 손님 결제액보다 낮은 금액으로 변경할 수 없습니다. 주문 자체 취소는 운영자 플로우로 처리해주세요.",
        },
        { status: 409 }
      )
    }

    const before = {
      store_price: target.store_price,
      sale_price: target.sale_price,
      customer_amount: target.customer_amount,
      unit_price: target.unit_price,
      qty: target.qty,
    }
    const now = new Date().toISOString()
    const { data: updated, error: updErr } = await supabase
      .from("orders")
      .update({
        store_price: newUnit,
        sale_price: newUnit,
        customer_amount: newCustomerAmount,
        updated_at: now,
      })
      .eq("id", target.id)
      .eq("session_id", session_id)
      .eq("store_uuid", store_uuid)
      .is("deleted_at", null)
      .select("id, store_price, sale_price, customer_amount")
      .maybeSingle()

    if (updErr || !updated) {
      await logAdminAccess(supabase, {
        actor_user_id: auth.user_id, target_store_uuid: store_uuid, screen: SCREEN,
        action_kind: "write", action_detail: "override_price",
        metadata: { session_id, order_id: target.id, total_amount: totalAmount, reason, result: "rejected", denial_reason: "UPDATE_FAILED", db_error: updErr?.message },
      })
      return NextResponse.json({ error: "UPDATE_FAILED" }, { status: 500 })
    }

    await logAdminAccess(supabase, {
      actor_user_id: auth.user_id, target_store_uuid: store_uuid, screen: SCREEN,
      action_kind: "write", action_detail: "override_price",
      metadata: {
        session_id,
        order_id: target.id,
        item_name: target.item_name,
        qty: target.qty,
        total_amount: totalAmount,
        reason,
        result: "success",
        before_state: before,
        after_state: {
          store_price: updated.store_price,
          sale_price: updated.sale_price,
          customer_amount: updated.customer_amount,
          manager_margin: 0,
        },
      },
    })

    return NextResponse.json({
      ok: true,
      order_id: updated.id,
      store_price: updated.store_price,
      sale_price: updated.sale_price,
      customer_amount: updated.customer_amount,
      manager_margin: 0,
      message: "주문 가격을 복구 가능 상태로 설정했습니다. 이제 강제 종료를 시도할 수 있습니다.",
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
