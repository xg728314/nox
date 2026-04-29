/**
 * Visualize Phase 2 — audit node builder (P2.1d).
 *
 * Reads `audit_events` (90-day hot, no archive) within the resolved
 * business-date window and emits one `audit` node per
 * (entity_table, entity_id) cluster. Each cluster carries the count of
 * collapsed events and the max severity across its actions.
 *
 * READ-ONLY. Stored values only. Failures degrade silently into
 * warnings — never throws (the network.ts caller relies on this).
 *
 * Edge attachment policy:
 *   1. Resolve entity_table/entity_id to a known graph node using the
 *      passed-in maps (no extra DB calls).
 *   2. If matched: emit one attach edge (approved_by | edited_by) from
 *      the entity node → audit node, with status = max severity.
 *   3. If unmatched: emit the audit node WITHOUT an attach edge
 *      ("floating") and increment the orphan counter. A single warning
 *      summarizes the count at the end.
 *
 * Aggregation key is `<entity_table>:<entity_id>` — same UUID across
 * different tables would collide otherwise.
 */

import type { ReadClient } from "../readClient"
import {
  classifyAuditAction,
  classifyActionSeverity,
  classifyActionVerb,
  severityRank,
} from "../graph/categories"
import type {
  NetworkAuditCategory,
  NetworkEdge,
  NetworkNode,
  NetworkStatus,
  NetworkWarning,
} from "../shapes"

// Hard cap on raw audit_events fetched per request (defence-in-depth).
// 90d × 14 stores × ~50 actions/day = ~63k. We slice 5k newest and warn.
const AUDIT_FETCH_CAP = 5000

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

export type MembershipMini = {
  id: string
  store_uuid: string
  role: string
}

export type AuditQueryInput = {
  client: ReadClient
  /** All store_uuids in scope. */
  store_ids: string[]
  /** Categories to include (caller-supplied default `settlement,payout`). */
  audit_categories: NetworkAuditCategory[]
  /** KST yyyy-mm-dd inclusive. */
  business_date_from: string
  business_date_to: string
  /** Currently-emitted node ids (used to decide attach vs float). */
  node_ids: ReadonlySet<string>

  // Entity resolution maps (built by network.ts from already-fetched data).
  settlement_item_to_settlement_id: ReadonlyMap<string, string>
  participant_to_session_id: ReadonlyMap<string, string>
  membership_by_id: ReadonlyMap<string, MembershipMini>
  cross_store_id_to_store_uuid: ReadonlyMap<string, string>
  profile_to_membership: ReadonlyMap<string, string>
}

export type AuditQueryResult = {
  nodes: NetworkNode[]
  edges: NetworkEdge[]
  source_tables: string[]
  warnings: NetworkWarning[]
}

type AuditRow = {
  id: string
  store_uuid: string
  entity_table: string
  entity_id: string
  action: string
  actor_role: string | null
  actor_membership_id: string | null
  created_at: string
}

type AuditAgg = {
  entity_table: string
  entity_id: string
  /** Distinct actions and their counts (capped to 5 distinct in meta). */
  actions: Map<string, number>
  total: number
  last_at: string
  last_action: string
  severity: NetworkStatus
  actor_membership_ids: Set<string>
}

export async function buildAuditNodes(
  input: AuditQueryInput,
): Promise<AuditQueryResult> {
  const warnings: NetworkWarning[] = []
  const sourceTables: string[] = []

  // ─── 1. derive UTC window from business-date range ─────────────────
  // Each KST business date X covers UTC [X-1 21:00, X 21:00) — 06:00 KST
  // rollover. Then clamp to "last 90 days from now" per user instruction.
  let utcGte: string
  let utcLt: string
  try {
    utcGte = businessDateToUtcStart(input.business_date_from)
    utcLt = businessDateToUtcEnd(input.business_date_to)
  } catch {
    warnings.push({
      type: "query_failed",
      note: `audit_events window resolve failed for ${input.business_date_from}..${input.business_date_to}.`,
    })
    return { nodes: [], edges: [], source_tables: sourceTables, warnings }
  }

  const ninetyDaysAgo = new Date(Date.now() - NINETY_DAYS_MS).toISOString()
  if (utcGte < ninetyDaysAgo) utcGte = ninetyDaysAgo

  // ─── 2. fetch audit rows ───────────────────────────────────────────
  let rows: AuditRow[] = []
  try {
    const { data, error } = await input.client
      .from("audit_events")
      .select(
        "id, store_uuid, entity_table, entity_id, action, actor_role, actor_membership_id, created_at",
      )
      .in("store_uuid", input.store_ids)
      .gte("created_at", utcGte)
      .lt("created_at", utcLt)
      .order("created_at", { ascending: false })
      .limit(AUDIT_FETCH_CAP)
    sourceTables.push("audit_events")
    if (error) {
      warnings.push({
        type: "query_failed",
        note: `audit_events: ${error.message}`,
      })
      return { nodes: [], edges: [], source_tables: sourceTables, warnings }
    }
    rows = ((data ?? []) as unknown) as AuditRow[]
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    warnings.push({
      type: "query_failed",
      note: `audit_events threw: ${msg}`,
    })
    return { nodes: [], edges: [], source_tables: sourceTables, warnings }
  }

  if (rows.length === AUDIT_FETCH_CAP) {
    warnings.push({
      type: "cap_exceeded",
      note: `audit_events fetch hit AUDIT_FETCH_CAP (${AUDIT_FETCH_CAP}); older events truncated.`,
      detail: { fetched: rows.length, cap: AUDIT_FETCH_CAP },
    })
  }

  // ─── 3. category filter + aggregate by (entity_table, entity_id) ───
  const allowedCategories = new Set(input.audit_categories)
  const aggByKey = new Map<string, AuditAgg>()
  let unknownActionCount = 0
  for (const r of rows) {
    if (!r.action || !r.entity_table || !r.entity_id) continue
    const category = classifyAuditAction(r.action)
    if (category === "other") unknownActionCount++
    if (!allowedCategories.has(category)) continue
    const key = `${r.entity_table}:${r.entity_id}`
    let agg = aggByKey.get(key)
    if (!agg) {
      agg = {
        entity_table: r.entity_table,
        entity_id: r.entity_id,
        actions: new Map(),
        total: 0,
        last_at: r.created_at,
        last_action: r.action,
        severity: "normal",
        actor_membership_ids: new Set(),
      }
      aggByKey.set(key, agg)
    }
    agg.actions.set(r.action, (agg.actions.get(r.action) ?? 0) + 1)
    agg.total += 1
    if (r.created_at > agg.last_at) {
      agg.last_at = r.created_at
      agg.last_action = r.action
    }
    if (r.actor_membership_id) {
      agg.actor_membership_ids.add(r.actor_membership_id)
    }
    const sev = classifyActionSeverity(r.action)
    if (severityRank(sev) > severityRank(agg.severity)) {
      agg.severity = sev
    }
  }

  if (unknownActionCount > 0) {
    warnings.push({
      type: "unknown_action",
      note: `${unknownActionCount} audit_events.action value(s) did not match any prefix rule.`,
      detail: { count: unknownActionCount },
    })
  }

  // ─── 4. build nodes + edges ────────────────────────────────────────
  const nodes: NetworkNode[] = []
  const edges: NetworkEdge[] = []
  let floatingCount = 0

  for (const [key, agg] of aggByKey) {
    const auditNodeId = `audit:${key}`
    const labelBase = agg.last_action
    const label = agg.total > 1 ? `${labelBase} (${agg.total})` : labelBase
    // Top-5 distinct actions for tooltip; sort by count desc
    const topActions = Array.from(agg.actions.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)

    const entityNodeId = resolveEntityNodeId(
      agg.entity_table,
      agg.entity_id,
      input,
    )

    nodes.push({
      id: auditNodeId,
      type: "audit",
      label,
      // No store_uuid bind unless we resolved an attached node — keeps
      // floating audits visually unanchored.
      store_uuid: agg.entity_table === "stores" ? agg.entity_id : undefined,
      weight: clamp01(0.1 + agg.total / 10),
      status: agg.severity,
      meta: {
        entity_table: agg.entity_table,
        entity_id: agg.entity_id,
        audit_count: agg.total,
        last_action: agg.last_action,
        last_at: agg.last_at,
        actions: topActions,
        actor_count: agg.actor_membership_ids.size,
        attached: !!entityNodeId,
      },
    })

    if (entityNodeId) {
      const verb = classifyActionVerb(agg.last_action)
      edges.push({
        id: `audit_attach:${key}`,
        source: entityNodeId,
        target: auditNodeId,
        type: verb === "approved" ? "approved_by" : "edited_by",
        weight: clamp01(0.2 + agg.total / 20),
        status: agg.severity,
        started_at: agg.last_at,
        meta: {
          audit_count: agg.total,
          last_action: agg.last_action,
          actor_count: agg.actor_membership_ids.size,
        },
      })
    } else {
      floatingCount++
    }
  }

  if (floatingCount > 0) {
    warnings.push({
      type: "audit_orphan",
      note: `${floatingCount} audit cluster(s) could not be attached to a visible graph node (floating).`,
      detail: { count: floatingCount },
    })
  }

  return { nodes, edges, source_tables: sourceTables, warnings }
}

// ─── entity resolution ───────────────────────────────────────────────

function resolveEntityNodeId(
  entityTable: string,
  entityId: string,
  ctx: AuditQueryInput,
): string | null {
  switch (entityTable) {
    case "settlements": {
      const candidate = `settlement:${entityId}`
      return ctx.node_ids.has(candidate) ? candidate : null
    }
    case "settlement_items": {
      const settlementId = ctx.settlement_item_to_settlement_id.get(entityId)
      if (!settlementId) return null
      const candidate = `settlement:${settlementId}`
      return ctx.node_ids.has(candidate) ? candidate : null
    }
    case "room_sessions": {
      const candidate = `session:${entityId}`
      return ctx.node_ids.has(candidate) ? candidate : null
    }
    case "session_participants": {
      const sessionId = ctx.participant_to_session_id.get(entityId)
      if (!sessionId) return null
      const candidate = `session:${sessionId}`
      return ctx.node_ids.has(candidate) ? candidate : null
    }
    case "store_memberships": {
      const m = ctx.membership_by_id.get(entityId)
      if (!m) return null
      const t = roleToType(m.role)
      if (!t) return null
      const candidate = `${t}:${entityId}`
      return ctx.node_ids.has(candidate) ? candidate : null
    }
    case "cross_store_settlements": {
      const debtorStore = ctx.cross_store_id_to_store_uuid.get(entityId)
      if (!debtorStore) return null
      const candidate = `store:${debtorStore}`
      return ctx.node_ids.has(candidate) ? candidate : null
    }
    case "profiles": {
      const membershipId = ctx.profile_to_membership.get(entityId)
      if (!membershipId) return null
      // Try each person type — first hit wins.
      for (const t of ["manager", "hostess", "staff"] as const) {
        const candidate = `${t}:${membershipId}`
        if (ctx.node_ids.has(candidate)) return candidate
      }
      return null
    }
    case "stores": {
      const candidate = `store:${entityId}`
      return ctx.node_ids.has(candidate) ? candidate : null
    }
    default:
      // store_operating_days, credits, visualize, auth_*, admin_access_logs,
      // payout_records (aggregated under different key), etc.
      return null
  }
}

function roleToType(role: string): "manager" | "hostess" | "staff" | null {
  if (role === "manager") return "manager"
  if (role === "hostess") return "hostess"
  if (role === "waiter" || role === "staff") return "staff"
  return null
}

// ─── time helpers (KST business_date → UTC) ──────────────────────────
//
// NOX operations day rolls over at 06:00 KST. KST = UTC+9, so 06:00 KST =
// 21:00 UTC of the previous calendar day. Therefore business_date X
// covers UTC [X-1 21:00:00, X 21:00:00). For a [from, to] range, the
// effective UTC window is [from-1 21:00:00, to 21:00:00).
//
// Equivalently:
//   start_utc = Date.UTC(yyyy, mm-1, dd, -3, 0, 0, 0)   // -3h from midnight
//   end_utc   = Date.UTC(yyyy, mm-1, dd+1, -3, 0, 0, 0) // next day -3h

function businessDateToUtcStart(date: string): string {
  const [y, m, d] = parseYmd(date)
  return new Date(Date.UTC(y, m - 1, d, -3, 0, 0, 0)).toISOString()
}

function businessDateToUtcEnd(date: string): string {
  const [y, m, d] = parseYmd(date)
  return new Date(Date.UTC(y, m - 1, d + 1, -3, 0, 0, 0)).toISOString()
}

function parseYmd(s: string): [number, number, number] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`bad yyyy-mm-dd: ${s}`)
  }
  return [Number(s.slice(0, 4)), Number(s.slice(5, 7)), Number(s.slice(8, 10))]
}

function clamp01(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0
  if (v >= 1) return 1
  return v
}
