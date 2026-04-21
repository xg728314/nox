import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * STEP-011B-FIX: per-session settlement calculation engine (normalized).
 *
 * Writes three destinations:
 *   1. session_participants.hostess_share_amount + share_type
 *      — per-hostess earnings only. No session-level liquor/store money is
 *        forced onto a hostess anchor row any more.
 *   2. session_manager_shares
 *      — one row per manager per source_type (deduction / liquor_margin).
 *   3. session_store_shares
 *      — one row per source_type (store_profit).
 *
 * Ownership invariant:
 *   hostess money → participant row
 *   manager money → session_manager_shares
 *   store money   → session_store_shares
 *
 * Confirmed formulas (LOCKED — not modified in this refactor):
 *
 *   Liquor:
 *     manager_profit = sale_price - deposit_price
 *     hostess_profit_from_liquor = 0
 *     store_revenue = deposit_price
 *     store_profit  = deposit_price - bottle_cost
 *
 *   Hostess:
 *     hostess_base = session_participants.price_amount (already computed by
 *                    participant-entry flow; trusted as-is).
 *
 *   Deduction:
 *     per-hostess override via hostess_deduction_configs keyed by
 *     (store_uuid, hostess_id, service_type, time_type); otherwise falls
 *     back to store_service_types.manager_deduction. Clamped to
 *     [0, hostess_base]. Deduction reduces hostess_final and goes to the
 *     hostess's session_participants.manager_membership_id.
 *
 *   Session-level liquor margin attribution:
 *     liquor margin is session-level. The confirmed source of the
 *     responsible manager for a session is room_sessions.manager_membership_id
 *     (verified via information_schema). The calculator writes one
 *     session_manager_shares row with source_type='liquor_margin' to that
 *     manager. If room_sessions.manager_membership_id is null, no liquor
 *     margin row is written (and it is reported back so callers can handle
 *     the gap — no speculative fallback across participants).
 */

type ParticipantRow = {
  id: string
  session_id: string
  store_uuid: string
  membership_id: string | null
  role: string | null
  category: string | null
  time_minutes: number | null
  price_amount: number | string | null
  cha3_amount: number | string | null
  banti_amount: number | string | null
  greeting_confirmed: boolean | null
  manager_membership_id: string | null
  entered_at: string | null
  status: string | null
}

type OrderRow = {
  id: string
  qty: number | null
  unit_price: number | null
  store_price: number | null
  sale_price: number | null
  customer_amount: number | null
  inventory_item_id: string | null
  order_type: string | null
}

type InventoryRow = {
  id: string
  cost_per_unit: number | null
}

type ServiceTypeRow = {
  service_type: string
  time_type: string
  manager_deduction: number | null
  has_greeting_check: boolean | null
}

type DeductionConfigRow = {
  hostess_id: string
  service_type: string
  time_type: string
  deduction_amount: number | null
}

type HostessRow = {
  id: string
  membership_id: string | null
}

function num(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Resolve the time_type key for a participant row.
 *
 * Mapping (only the three types the confirmed rules mention):
 *   - cha3_amount  > 0  → "cha3"
 *   - banti_amount > 0  → "half"
 *   - otherwise         → "base"
 *
 * Shirt greeting exception (confirmed rule): when service_type is shirt
 * and greeting is confirmed, cha3 is upgraded to half.
 */
function resolveTimeType(p: ParticipantRow): "base" | "half" | "cha3" {
  const cha3 = num(p.cha3_amount)
  const banti = num(p.banti_amount)
  if (cha3 > 0) {
    if ((p.category ?? "") === "shirt" && p.greeting_confirmed === true) {
      return "half"
    }
    return "cha3"
  }
  if (banti > 0) return "half"
  return "base"
}

export type ParticipantShareResult = {
  participant_id: string
  membership_id: string | null
  manager_membership_id: string | null
  hostess_base_amount: number
  deduction_amount: number
  hostess_final: number
  time_type: "base" | "half" | "cha3"
  service_type: string
}

export type ManagerShareResult = {
  manager_membership_id: string
  amount: number
  source_type: "deduction" | "liquor_margin"
}

export type StoreShareResult = {
  amount: number
  source_type: "store_profit"
}

export type SessionShareResult = {
  participants: ParticipantShareResult[]
  manager_shares: ManagerShareResult[]
  store_shares: StoreShareResult[]
  liquor_margin: number
  store_revenue: number
  store_profit: number
  liquor_margin_unassigned: boolean   // true when room_sessions.manager_membership_id is null
  totals: {
    hostess_total: number
    manager_total: number        // sum of emitted manager rows
    store_total: number          // sum of emitted store rows
    manager_deduction_total: number
  }
}

/**
 * Pure calculation — no I/O. Exposed for testing and for callers that have
 * already loaded the source rows.
 */
export function computeShares(input: {
  participants: ParticipantRow[]
  orders: OrderRow[]
  inventoryById: Map<string, InventoryRow>
  deductionDefaultsByTypeKey: Map<string, number>
  deductionOverridesByKey: Map<string, number>
  hostessByMembership: Map<string, HostessRow>
  sessionManagerMembershipId: string | null   // from room_sessions.manager_membership_id
}): SessionShareResult {
  const {
    participants, orders, inventoryById,
    deductionDefaultsByTypeKey, deductionOverridesByKey,
    hostessByMembership, sessionManagerMembershipId,
  } = input

  // ── Session-level liquor math ─────────────────────────────────────────
  let liquor_margin = 0
  let store_revenue = 0
  let store_profit = 0
  for (const o of orders) {
    const qty = num(o.qty)
    const store_price = num(o.store_price)
    const sale_price = num(o.sale_price)
    if (store_price > 0 && sale_price > 0 && qty > 0) {
      liquor_margin += qty * (sale_price - store_price)
      store_revenue += qty * store_price
      const inv = o.inventory_item_id ? inventoryById.get(o.inventory_item_id) : null
      const bottle_cost = inv ? num(inv.cost_per_unit) : 0
      store_profit += qty * (store_price - bottle_cost)
    }
  }

  // ── Per-participant hostess + deduction math ───────────────────────────
  const results: ParticipantShareResult[] = []
  const deductionByManager = new Map<string, number>()

  for (const p of participants) {
    const service_type = (p.category ?? "").trim()
    const time_type = resolveTimeType(p)
    const base = num(p.price_amount)

    let deduction = 0
    if (p.membership_id) {
      const hostess = hostessByMembership.get(p.membership_id)
      if (hostess) {
        const overrideKey = `${hostess.id}|${service_type}|${time_type}`
        if (deductionOverridesByKey.has(overrideKey)) {
          deduction = deductionOverridesByKey.get(overrideKey) ?? 0
        } else {
          deduction = deductionDefaultsByTypeKey.get(`${service_type}|${time_type}`) ?? 0
        }
      } else {
        deduction = deductionDefaultsByTypeKey.get(`${service_type}|${time_type}`) ?? 0
      }
    } else {
      deduction = deductionDefaultsByTypeKey.get(`${service_type}|${time_type}`) ?? 0
    }

    if (deduction > base) deduction = base
    if (deduction < 0) deduction = 0

    const hostess_final = base - deduction

    results.push({
      participant_id: p.id,
      membership_id: p.membership_id,
      manager_membership_id: p.manager_membership_id,
      hostess_base_amount: base,
      deduction_amount: deduction,
      hostess_final,
      time_type,
      service_type,
    })

    // Deduction is attributed to the hostess's own manager_membership_id.
    // No fallback invented — if the hostess row has no manager set, the
    // deduction is skipped from manager aggregation (not silently reassigned).
    if (deduction > 0 && p.manager_membership_id) {
      deductionByManager.set(
        p.manager_membership_id,
        (deductionByManager.get(p.manager_membership_id) ?? 0) + deduction,
      )
    }
  }

  // ── Manager rows ─────────────────────────────────────────────────────
  const manager_shares: ManagerShareResult[] = []
  for (const [mgrId, amount] of deductionByManager) {
    manager_shares.push({
      manager_membership_id: mgrId,
      amount,
      source_type: "deduction",
    })
  }

  // liquor_margin: single row for the session's responsible manager.
  // If room_sessions.manager_membership_id is null → no row written and
  // liquor_margin_unassigned=true so callers can surface the gap.
  const liquor_margin_unassigned = liquor_margin > 0 && !sessionManagerMembershipId
  if (liquor_margin > 0 && sessionManagerMembershipId) {
    manager_shares.push({
      manager_membership_id: sessionManagerMembershipId,
      amount: liquor_margin,
      source_type: "liquor_margin",
    })
  }

  // ── Store row ───────────────────────────────────────────────────────
  const store_shares: StoreShareResult[] = []
  if (store_profit > 0) {
    store_shares.push({ amount: store_profit, source_type: "store_profit" })
  }

  const hostess_total = results.reduce((s, r) => s + r.hostess_final, 0)
  const manager_deduction_total = [...deductionByManager.values()].reduce((s, v) => s + v, 0)
  const manager_total = manager_shares.reduce((s, r) => s + r.amount, 0)
  const store_total = store_shares.reduce((s, r) => s + r.amount, 0)

  return {
    participants: results,
    manager_shares,
    store_shares,
    liquor_margin,
    store_revenue,
    store_profit,
    liquor_margin_unassigned,
    totals: {
      hostess_total,
      manager_total,
      store_total,
      manager_deduction_total,
    },
  }
}

/**
 * Load-and-persist orchestrator. Owns all SELECTs, and three rewrites:
 *   - session_participants (hostess share + share_type)
 *   - session_manager_shares (soft-delete prior live + insert fresh)
 *   - session_store_shares (soft-delete prior live + insert fresh)
 *
 * Idempotent: calling twice on an unchanged session produces the same
 * final state. No hard deletes — every rewrite is soft-delete-then-insert.
 */
export async function recalculateAndPersist(
  supabase: SupabaseClient,
  session_id: string,
  store_uuid: string,
): Promise<SessionShareResult> {
  // session header for responsible manager
  const { data: sessionRaw } = await supabase
    .from("room_sessions")
    .select("id, store_uuid, manager_membership_id")
    .eq("id", session_id)
    .eq("store_uuid", store_uuid)
    .maybeSingle()
  const sessionManagerMembershipId =
    (sessionRaw as { manager_membership_id: string | null } | null)?.manager_membership_id ?? null

  // participants (hostess rows only)
  const { data: partRaw, error: partErr } = await supabase
    .from("session_participants")
    .select("id, session_id, store_uuid, membership_id, role, category, time_minutes, price_amount, cha3_amount, banti_amount, greeting_confirmed, manager_membership_id, entered_at, status")
    .eq("session_id", session_id)
    .eq("store_uuid", store_uuid)
    .is("deleted_at", null)
  if (partErr) throw new Error("PARTICIPANTS_QUERY_FAILED: " + partErr.message)
  const participants = ((partRaw ?? []) as ParticipantRow[]).filter(p => (p.role ?? "") !== "manager")

  // orders for liquor math
  const { data: ordersRaw, error: ordersErr } = await supabase
    .from("orders")
    .select("id, qty, unit_price, store_price, sale_price, customer_amount, inventory_item_id, order_type")
    .eq("session_id", session_id)
    .eq("store_uuid", store_uuid)
    .is("deleted_at", null)
  if (ordersErr) throw new Error("ORDERS_QUERY_FAILED: " + ordersErr.message)
  const orders = (ordersRaw ?? []) as OrderRow[]

  // inventory items referenced by those orders (for bottle_cost)
  const invIds = [...new Set(orders.map(o => o.inventory_item_id).filter((x): x is string => !!x))]
  const inventoryById = new Map<string, InventoryRow>()
  if (invIds.length > 0) {
    const { data: invRaw } = await supabase
      .from("inventory_items")
      .select("id, cost_per_unit")
      .eq("store_uuid", store_uuid)
      .in("id", invIds)
    for (const r of (invRaw ?? []) as InventoryRow[]) inventoryById.set(r.id, r)
  }

  // store service type defaults
  const deductionDefaultsByTypeKey = new Map<string, number>()
  {
    const { data: svcRaw } = await supabase
      .from("store_service_types")
      .select("service_type, time_type, manager_deduction, has_greeting_check")
      .eq("store_uuid", store_uuid)
      .eq("is_active", true)
    for (const r of (svcRaw ?? []) as ServiceTypeRow[]) {
      deductionDefaultsByTypeKey.set(`${r.service_type}|${r.time_type}`, num(r.manager_deduction))
    }
  }

  // per-hostess overrides
  const deductionOverridesByKey = new Map<string, number>()
  {
    const { data: cfgRaw } = await supabase
      .from("hostess_deduction_configs")
      .select("hostess_id, service_type, time_type, deduction_amount")
      .eq("store_uuid", store_uuid)
      .is("deleted_at", null)
    for (const r of (cfgRaw ?? []) as DeductionConfigRow[]) {
      deductionOverridesByKey.set(`${r.hostess_id}|${r.service_type}|${r.time_type}`, num(r.deduction_amount))
    }
  }

  // hostess membership → id map for override lookup
  const hostessByMembership = new Map<string, HostessRow>()
  {
    const memberIds = [...new Set(participants.map(p => p.membership_id).filter((x): x is string => !!x))]
    if (memberIds.length > 0) {
      const { data: hstRaw } = await supabase
        .from("hostesses")
        .select("id, membership_id")
        .eq("store_uuid", store_uuid)
        .in("membership_id", memberIds)
      for (const r of (hstRaw ?? []) as HostessRow[]) {
        if (r.membership_id) hostessByMembership.set(r.membership_id, r)
      }
    }
  }

  const result = computeShares({
    participants,
    orders,
    inventoryById,
    deductionDefaultsByTypeKey,
    deductionOverridesByKey,
    hostessByMembership,
    sessionManagerMembershipId,
  })

  const nowIso = new Date().toISOString()

  // ── 1. Persist hostess rows (per-participant). NO liquor/store anchor. ──
  for (const r of result.participants) {
    const { error: upErr } = await supabase
      .from("session_participants")
      .update({
        hostess_share_amount: r.hostess_final,
        // Legacy columns kept NULL/zero on hostess rows — they are no
        // longer authoritative. Settlement aggregation reads from the
        // dedicated manager/store tables below.
        manager_share_amount: 0,
        store_share_amount: 0,
        share_type: r.time_type,
        updated_at: nowIso,
      })
      .eq("id", r.participant_id)
      .eq("store_uuid", store_uuid)
    if (upErr) throw new Error("PERSIST_PARTICIPANT_FAILED: " + upErr.message)
  }

  // ── 2. Rewrite session_manager_shares ──
  // Soft-delete prior live rows, then insert fresh.
  {
    const { error: delErr } = await supabase
      .from("session_manager_shares")
      .update({ deleted_at: nowIso, updated_at: nowIso })
      .eq("session_id", session_id)
      .eq("store_uuid", store_uuid)
      .is("deleted_at", null)
    if (delErr) throw new Error("SOFT_DELETE_MANAGER_SHARES_FAILED: " + delErr.message)
  }
  if (result.manager_shares.length > 0) {
    const { error: insErr } = await supabase
      .from("session_manager_shares")
      .insert(result.manager_shares.map(r => ({
        store_uuid,
        session_id,
        manager_membership_id: r.manager_membership_id,
        amount: r.amount,
        source_type: r.source_type,
      })))
    if (insErr) throw new Error("INSERT_MANAGER_SHARES_FAILED: " + insErr.message)
  }

  // ── 3. Rewrite session_store_shares ──
  {
    const { error: delErr } = await supabase
      .from("session_store_shares")
      .update({ deleted_at: nowIso, updated_at: nowIso })
      .eq("session_id", session_id)
      .eq("store_uuid", store_uuid)
      .is("deleted_at", null)
    if (delErr) throw new Error("SOFT_DELETE_STORE_SHARES_FAILED: " + delErr.message)
  }
  if (result.store_shares.length > 0) {
    const { error: insErr } = await supabase
      .from("session_store_shares")
      .insert(result.store_shares.map(r => ({
        store_uuid,
        session_id,
        amount: r.amount,
        source_type: r.source_type,
      })))
    if (insErr) throw new Error("INSERT_STORE_SHARES_FAILED: " + insErr.message)
  }

  return result
}
