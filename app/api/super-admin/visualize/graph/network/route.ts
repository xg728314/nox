/**
 * GET /api/super-admin/visualize/graph/network
 *
 * Phase 2.1a — STUB. Validates params, resolves time scope, fetches
 * business_day_ids, returns the canonical NetworkGraphResponse shape
 * with empty nodes/edges. Subsequent phases (P2.1b–d) fill in:
 *
 *   P2.1b → store / manager / hostess / belongs_to / managed_by
 *   P2.1c → session / settlement / payout + time-scoped relations
 *   P2.1d → audit nodes + risk classification
 *
 * READ-ONLY. super_admin only. Audit-logged.
 *
 * Query params:
 *   scope               'building' | 'store'              default 'building'
 *   store_uuid          UUID                              required when scope='store'
 *   time_range          today | yesterday | this_month |
 *                       last_7_days | custom              default 'today'
 *   from, to            yyyy-mm-dd                        required for custom
 *   include             csv NetworkNodeType subset        default all
 *   audit_categories    csv NetworkAuditCategory          default 'settlement,payout'
 *   node_cap            int 1..5000                       default 1500
 *   edge_cap            int 1..20000                      default 5000
 *   unmask              'true'                            default false (P2.1a unused)
 */

import { NextResponse } from "next/server"
import {
  visualizeGate,
  writeVisualizeAudit,
  isUuid,
} from "@/lib/visualize/guards"
import {
  resolveTimeRange,
  resolveBusinessDays,
} from "@/lib/visualize/graph/timeScope"
import {
  parseAuditCategories,
} from "@/lib/visualize/graph/categories"
import { queryNetworkGraph } from "@/lib/visualize/query/network"
import {
  NETWORK_DEFAULT_AUDIT_CATEGORIES,
  type NetworkAuditCategory,
  type NetworkEdge,
  type NetworkEdgeType,
  type NetworkGraphResponse,
  type NetworkNode,
  type NetworkNodeType,
  type NetworkScope,
  type NetworkScopeKind,
  type NetworkTimeRange,
  type NetworkWarning,
} from "@/lib/visualize/shapes"

const NODE_TYPES: readonly NetworkNodeType[] = [
  "store",
  "manager",
  "hostess",
  "staff",
  "session",
  "settlement",
  "payout",
  "audit",
]

const TIME_RANGES: readonly NetworkTimeRange[] = [
  "today",
  "yesterday",
  "this_month",
  "last_7_days",
  "custom",
]

const NODE_CAP_DEFAULT = 1500
const NODE_CAP_MAX = 5000
const EDGE_CAP_DEFAULT = 5000
const EDGE_CAP_MAX = 20_000

export async function GET(request: Request) {
  const t_start = performance.now()
  const gate = await visualizeGate(request)
  if (!gate.ok) return gate.response
  const { auth, client } = gate

  const url = new URL(request.url)

  // ─── scope kind + store_uuid ────────────────────────────────────────
  const rawScope = (url.searchParams.get("scope") ?? "building").toLowerCase()
  if (rawScope !== "building" && rawScope !== "store") {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "scope must be 'building' or 'store'." },
      { status: 400 },
    )
  }
  const scopeKind = rawScope as NetworkScopeKind

  const storeUuidParam = url.searchParams.get("store_uuid")
  let storeUuid: string | null = null
  if (scopeKind === "store") {
    if (!isUuid(storeUuidParam)) {
      return NextResponse.json(
        {
          error: "BAD_REQUEST",
          message: "scope='store' requires a valid store_uuid.",
        },
        { status: 400 },
      )
    }
    storeUuid = storeUuidParam
  } else if (storeUuidParam) {
    // Building scope ignores store_uuid; reject obviously bad UUIDs early
    // so the client doesn't think it's being applied.
    if (!isUuid(storeUuidParam)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "store_uuid must be a valid UUID." },
        { status: 400 },
      )
    }
    // Accept-but-ignore for building scope.
  }

  // ─── time_range + custom from/to ────────────────────────────────────
  const rawTime = (url.searchParams.get("time_range") ?? "today").toLowerCase()
  if (!TIME_RANGES.includes(rawTime as NetworkTimeRange)) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: `time_range must be one of: ${TIME_RANGES.join(", ")}.`,
      },
      { status: 400 },
    )
  }
  const timeRange = rawTime as NetworkTimeRange

  const resolved = resolveTimeRange({
    time_range: timeRange,
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  })
  if (!resolved.ok) {
    return NextResponse.json(
      { error: resolved.error, message: resolved.message },
      { status: resolved.error === "RANGE_TOO_WIDE" ? 400 : 400 },
    )
  }

  // ─── include node types ─────────────────────────────────────────────
  const includeRaw = url.searchParams.get("include")
  const includeNodeTypes: NetworkNodeType[] = includeRaw
    ? includeRaw
        .split(",")
        .map((s) => s.trim().toLowerCase() as NetworkNodeType)
        .filter((s) => NODE_TYPES.includes(s))
    : Array.from(NODE_TYPES)
  if (includeNodeTypes.length === 0) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "include resolved to an empty set." },
      { status: 400 },
    )
  }

  // ─── audit_categories ───────────────────────────────────────────────
  const auditCategories: NetworkAuditCategory[] = parseAuditCategories(
    url.searchParams.get("audit_categories"),
    NETWORK_DEFAULT_AUDIT_CATEGORIES,
  )

  // ─── caps ───────────────────────────────────────────────────────────
  const nodeCap = clampInt(
    url.searchParams.get("node_cap"),
    NODE_CAP_DEFAULT,
    1,
    NODE_CAP_MAX,
  )
  const edgeCap = clampInt(
    url.searchParams.get("edge_cap"),
    EDGE_CAP_DEFAULT,
    1,
    EDGE_CAP_MAX,
  )

  // ─── unmask (P2.1a unused; will surface in detail panel later) ──────
  const unmaskRequested = url.searchParams.get("unmask") === "true"

  // ─── resolve business_day_ids in window ─────────────────────────────
  const warnings: NetworkWarning[] = []
  const sourceTables: string[] = ["store_operating_days"]

  let businessDayIds: string[] = []
  try {
    const days = await resolveBusinessDays(client, {
      scope_kind: scopeKind,
      store_uuid: storeUuid,
      from: resolved.from,
      to: resolved.to,
    })
    if (!days.ok) {
      console.warn(
        `[visualize.network] business_days resolve failed: ${days.error} — ${days.message}`,
      )
      warnings.push({
        type: "operating_day_missing",
        note: `business_days resolve failed: ${days.message}`,
      })
    } else {
      businessDayIds = days.ids
      if (days.ids.length === 0) {
        warnings.push({
          type: "scope_empty",
          note: `No store_operating_days rows in [${resolved.from}, ${resolved.to}].`,
        })
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[visualize.network] business_days threw: ${msg}`)
    warnings.push({
      type: "operating_day_missing",
      note: `business_days threw: ${msg}`,
    })
  }

  // ─── P2.1b: static topology (stores + memberships + relationships) ──
  let nodes: NetworkNode[] = []
  let edges: NetworkEdge[] = []
  let truncated = false
  try {
    const graph = await queryNetworkGraph({
      client,
      scope_kind: scopeKind,
      store_uuid: storeUuid,
      include_node_types: includeNodeTypes,
      business_day_ids: businessDayIds,
      node_cap: nodeCap,
      edge_cap: edgeCap,
      unmasked: unmaskRequested,
      audit_categories: auditCategories,
      business_date_from: resolved.from,
      business_date_to: resolved.to,
    })
    if (graph.ok) {
      nodes = graph.nodes
      edges = graph.edges
      truncated = graph.truncated
      sourceTables.push(...graph.source_tables)
      warnings.push(...graph.warnings)
    } else {
      console.warn(
        `[visualize.network] query failed: ${graph.error} — ${graph.message}`,
      )
      warnings.push({
        type: "query_failed",
        note: `${graph.error}: ${graph.message}`,
      })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const stack = e instanceof Error ? e.stack : undefined
    console.error(`[visualize.network] threw: ${msg}\n${stack ?? ""}`)
    warnings.push({
      type: "query_failed",
      note: `network query crashed: ${msg}`,
    })
  }

  // Per-type tally (used for totals.by_type and audit metadata).
  const nodesByType: Partial<Record<NetworkNodeType, number>> = {}
  for (const n of nodes) {
    nodesByType[n.type] = (nodesByType[n.type] ?? 0) + 1
  }
  const edgesByType: Partial<Record<NetworkEdgeType, number>> = {}
  for (const e of edges) {
    edgesByType[e.type] = (edgesByType[e.type] ?? 0) + 1
  }

  const t_end = performance.now()
  const queryMs = Math.round(t_end - t_start)

  const scope: NetworkScope = {
    kind: scopeKind,
    store_uuid: storeUuid,
    time_range: timeRange,
    from: resolved.from,
    to: resolved.to,
    business_day_ids: businessDayIds,
    audit_categories: auditCategories,
    include_node_types: includeNodeTypes,
  }

  const response: NetworkGraphResponse = {
    as_of: new Date().toISOString(),
    scope,
    source_tables: Array.from(new Set(sourceTables)),
    totals: {
      nodes: { total: nodes.length, by_type: nodesByType },
      edges: { total: edges.length, by_type: edgesByType },
      truncated,
      query_ms: queryMs,
    },
    nodes,
    edges,
    warnings,
  }

  // Best-effort audit (read).
  try {
    await writeVisualizeAudit({
      auth,
      client,
      action: "visualize_network_read",
      entity_id: storeUuid ?? auth.store_uuid,
      scope_store_uuid: storeUuid ?? auth.store_uuid,
      metadata: {
        outcome: warnings.some((w) => w.type === "query_failed")
          ? "partial"
          : "success",
        scope: scopeKind,
        time_range: timeRange,
        from: resolved.from,
        to: resolved.to,
        node_cap: nodeCap,
        edge_cap: edgeCap,
        audit_categories: auditCategories,
        include_node_types: includeNodeTypes,
        business_day_count: businessDayIds.length,
        node_count: nodes.length,
        edge_count: edges.length,
        truncated,
        query_ms: queryMs,
        unmask_requested: unmaskRequested,
        phase: "P2.1d-audit",
      },
      unmasked: unmaskRequested,
    })
  } catch {
    // audit failures must not 500 a read path
  }

  return NextResponse.json(response, {
    status: 200,
    headers: {
      "Cache-Control": "private, max-age=20",
      "X-Visualize-Query-Ms": String(queryMs),
    },
  })
}

function clampInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = raw == null ? NaN : Number(raw)
  if (!Number.isFinite(n)) return fallback
  const i = Math.floor(n)
  if (i < min) return min
  if (i > max) return max
  return i
}
