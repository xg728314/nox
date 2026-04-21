import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { assertBusinessDayOpen } from "@/lib/auth/assertBusinessDayOpen"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * STEP-043: Settlement-tree manager prepayment ledger.
 *
 *   POST /api/payouts/manager-prepayment
 *     Body: { target_store_uuid, target_manager_membership_id,
 *             amount, memo?, business_day_id? }
 *     Returns { ok, id, manager_prepaid, store_prepaid, ... }.
 *
 *   GET  /api/payouts/manager-prepayment
 *        ?counterpart_store_uuid=...[&manager_membership_id=...]
 *     Returns the list of active prepayment rows scoped to the caller's
 *     store and the counterpart store (optionally narrowed to one
 *     manager). Cancelled/soft-deleted rows are excluded.
 *
 * Store-total and manager-total are derived from session_participants in
 * lockstep with /api/reports/settlement-tree-operational to keep the
 * "우리가 상대 매장 실장에게 줘야 할 돈" balance truthful without needing
 * a cross_store_settlements header row.
 *
 * Access: owner + manager (hostess blocked).
 */

function num(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

type ParticipantRow = {
  manager_membership_id: string | null
  origin_store_uuid: string | null
  store_uuid: string
  hostess_payout_amount: number
  role: string
  status: string
}

/**
 * Compute outstanding debt owed by `auth.store_uuid` to managers at
 * `counterpart_store_uuid`, grouped by manager. Same semantics as
 * settlement-tree-operational Level 2 Outbound (external hostesses who
 * worked at our store — we owe their origin-store managers).
 */
async function computeOperationalManagerTotals(
  supabase: SupabaseClient,
  store_uuid: string,
  counterpart_store_uuid: string,
): Promise<Map<string, number>> {
  // Rows where the hostess ORIGINATES FROM counterpart, WORKED AT us.
  // These rows represent an obligation from us → counterpart manager.
  const { data: rows } = await supabase
    .from("session_participants")
    .select("manager_membership_id, origin_store_uuid, store_uuid, hostess_payout_amount, role, status")
    .eq("origin_store_uuid", counterpart_store_uuid)
    .eq("store_uuid", store_uuid)
    .eq("role", "hostess")
    .is("deleted_at", null)

  const totals = new Map<string, number>()
  for (const r of (rows ?? []) as ParticipantRow[]) {
    if (r.status !== "active" && r.status !== "left") continue
    const mid = r.manager_membership_id
    if (!mid) continue
    totals.set(mid, (totals.get(mid) ?? 0) + num(r.hostess_payout_amount))
  }
  return totals
}

async function computeExistingPrepaid(
  supabase: SupabaseClient,
  store_uuid: string,
  counterpart_store_uuid: string,
): Promise<{ byManager: Map<string, number>; total: number }> {
  const { data: rows } = await supabase
    .from("manager_prepayments")
    .select("target_manager_membership_id, amount")
    .eq("store_uuid", store_uuid)
    .eq("target_store_uuid", counterpart_store_uuid)
    .eq("status", "active")
    .is("deleted_at", null)

  const byManager = new Map<string, number>()
  let total = 0
  for (const r of (rows ?? []) as { target_manager_membership_id: string; amount: number }[]) {
    const a = num(r.amount)
    total += a
    byManager.set(
      r.target_manager_membership_id,
      (byManager.get(r.target_manager_membership_id) ?? 0) + a,
    )
  }
  return { byManager, total }
}

// ── POST ───────────────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)

    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Only owner / manager can record a prepayment." },
        { status: 403 }
      )
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const target_store_uuid = typeof body.target_store_uuid === "string" ? body.target_store_uuid : ""
    const target_manager_membership_id =
      typeof body.target_manager_membership_id === "string" ? body.target_manager_membership_id : ""
    const amount = num(body.amount)
    const memo = typeof body.memo === "string" && body.memo.trim().length > 0 ? body.memo.trim() : null
    const business_day_id =
      typeof body.business_day_id === "string" && body.business_day_id.length > 0
        ? body.business_day_id
        : null

    if (!target_store_uuid) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "target_store_uuid is required." }, { status: 400 })
    }
    if (!target_manager_membership_id) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "target_manager_membership_id is required." }, { status: 400 })
    }
    if (target_store_uuid === auth.store_uuid) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "target_store_uuid must differ from caller's store_uuid (cross-store only)." },
        { status: 400 }
      )
    }
    if (!(amount > 0) || !Number.isFinite(amount)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "amount must be a finite positive number." }, { status: 400 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // Closed-day guard when business_day_id supplied.
    if (business_day_id) {
      const guard = await assertBusinessDayOpen(supabase, business_day_id)
      if (guard) return guard
    }

    // Recompute operational totals + existing prepayments to gate overpay.
    const managerTotals = await computeOperationalManagerTotals(
      supabase,
      auth.store_uuid,
      target_store_uuid,
    )
    const storeTotal = Array.from(managerTotals.values()).reduce((s, v) => s + v, 0)

    const { byManager: prepaidByMgr, total: prepaidStoreTotal } =
      await computeExistingPrepaid(supabase, auth.store_uuid, target_store_uuid)

    const thisManagerTotal = managerTotals.get(target_manager_membership_id) ?? 0
    const thisManagerPrepaid = prepaidByMgr.get(target_manager_membership_id) ?? 0
    const thisManagerRemaining = thisManagerTotal - thisManagerPrepaid
    const storeRemaining = storeTotal - prepaidStoreTotal

    if (amount > thisManagerRemaining) {
      return NextResponse.json(
        {
          error: "MANAGER_OVERPAY",
          message: "실장 잔액을 초과하는 선지급은 허용되지 않습니다.",
          manager_total: thisManagerTotal,
          manager_prepaid: thisManagerPrepaid,
          manager_remaining: thisManagerRemaining,
        },
        { status: 409 }
      )
    }
    if (amount > storeRemaining) {
      return NextResponse.json(
        {
          error: "STORE_OVERPAY",
          message: "가게 총 잔액을 초과하는 선지급은 허용되지 않습니다.",
          store_total: storeTotal,
          store_prepaid: prepaidStoreTotal,
          store_remaining: storeRemaining,
        },
        { status: 409 }
      )
    }

    // Insert ledger row.
    const { data: inserted, error: insErr } = await supabase
      .from("manager_prepayments")
      .insert({
        store_uuid: auth.store_uuid,
        target_store_uuid,
        target_manager_membership_id,
        business_day_id,
        amount,
        memo,
        status: "active",
        created_by: auth.user_id,
      })
      .select("id, amount, created_at")
      .single()

    if (insErr || !inserted) {
      return NextResponse.json(
        { error: "INSERT_FAILED", message: insErr?.message || "Failed to record prepayment." },
        { status: 500 }
      )
    }

    // Audit log — best-effort (do not fail the request on audit write error).
    try {
      await supabase.from("audit_events").insert({
        store_uuid: auth.store_uuid,
        actor_user_id: auth.user_id,
        actor_role: auth.role,
        actor_type: auth.role,
        entity_table: "manager_prepayments",
        entity_id: inserted.id,
        action: "manager_prepayment_created",
        after: {
          target_store_uuid,
          target_manager_membership_id,
          amount,
          business_day_id,
        },
      })
    } catch {
      /* audit write failure is non-blocking */
    }

    return NextResponse.json({
      ok: true,
      id: inserted.id,
      created_at: inserted.created_at,
      manager_total: thisManagerTotal,
      manager_prepaid: thisManagerPrepaid + amount,
      manager_remaining: thisManagerRemaining - amount,
      store_total: storeTotal,
      store_prepaid: prepaidStoreTotal + amount,
      store_remaining: storeRemaining - amount,
    })
  } catch (error) {
    return handleRouteError(error, "payouts/manager-prepayment")
  }
}

// ── GET ────────────────────────────────────────────────────────────
export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)

    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const url = new URL(request.url)
    const counterpart = url.searchParams.get("counterpart_store_uuid")
    const manager = url.searchParams.get("manager_membership_id")
    const businessDayId = url.searchParams.get("business_day_id")

    if (!counterpart) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "counterpart_store_uuid is required." },
        { status: 400 }
      )
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    let q = supabase
      .from("manager_prepayments")
      .select("id, target_manager_membership_id, amount, memo, business_day_id, status, created_at, created_by")
      .eq("store_uuid", auth.store_uuid)
      .eq("target_store_uuid", counterpart)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })

    if (manager) q = q.eq("target_manager_membership_id", manager)
    if (businessDayId) q = q.eq("business_day_id", businessDayId)

    const { data, error } = await q
    if (error) {
      return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    }

    return NextResponse.json({
      store_uuid: auth.store_uuid,
      counterpart_store_uuid: counterpart,
      prepayments: data ?? [],
    })
  } catch (error) {
    return handleRouteError(error, "payouts/manager-prepayment")
  }
}
