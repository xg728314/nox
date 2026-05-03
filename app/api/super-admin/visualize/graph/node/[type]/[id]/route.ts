/**
 * GET /api/super-admin/visualize/graph/node/{type}/{id}
 *
 * Phase 2.1g — per-entity drill-down for the visualize Network page.
 * READ-ONLY. PII masked by default. Service-role client used for cross-store
 * access; super_admin gate enforced; audit row written per request.
 *
 * Supported types: store / manager / hostess / staff / session / settlement.
 * Aggregate node types (payout, audit) are NOT supported here — their
 * `id` in the graph response is a composite key, not a UUID. Callers
 * should use the parent entity instead.
 *
 * Failures are encoded as 200 + warnings (matching the rest of the
 * visualize layer). Hard 4xx is reserved for malformed inputs.
 */

import { NextResponse } from "next/server"
import { visualizeGate, writeVisualizeAudit, isUuid } from "@/lib/visualize/guards"
import type { NetworkNodeType } from "@/lib/visualize/shapes"
// 2026-05-03: type 별 fetcher + NodeDetailResponse 분리.
import type { NodeDetailResponse } from "./route.types"
import {
  fetchStore,
  fetchSession,
  fetchSettlement,
  fetchPerson,
  fetchPayoutAggregate,
  fetchAuditAggregate,
} from "./nodeFetchers"

const SUPPORTED: ReadonlySet<NetworkNodeType> = new Set([
  "store",
  "manager",
  "hostess",
  "staff",
  "session",
  "settlement",
  // P2.1h: aggregate types — id is a composite key, NOT a UUID.
  "payout",
  "audit",
])

const UUID_TYPES: ReadonlySet<NetworkNodeType> = new Set([
  "store",
  "manager",
  "hostess",
  "staff",
  "session",
  "settlement",
])

export async function GET(
  request: Request,
  ctx: { params: Promise<{ type: string; id: string }> },
) {
  const t_start = performance.now()
  const gate = await visualizeGate(request)
  if (!gate.ok) return gate.response
  const { auth, client } = gate

  const { type: rawType, id } = await ctx.params
  const type = rawType.toLowerCase() as NetworkNodeType

  if (!SUPPORTED.has(type)) {
    return NextResponse.json(
      {
        error: "BAD_REQUEST",
        message: `node type '${rawType}' is not supported for drill-down. Supported: ${Array.from(SUPPORTED).join(", ")}.`,
      },
      { status: 400 },
    )
  }
  // UUID-based types reject non-UUIDs early. Aggregate types (payout/audit)
  // accept composite keys; their fetchers validate the shape.
  if (UUID_TYPES.has(type) && !isUuid(id)) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "id must be a valid UUID for this type." },
      { status: 400 },
    )
  }
  if (!UUID_TYPES.has(type) && (id.length < 3 || id.length > 200)) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "id must be a non-empty composite key." },
      { status: 400 },
    )
  }

  // P2.1i: unmask opt-in. The visualizeGate has already verified
  // is_super_admin (route only reachable to super_admin), so we trust
  // the boolean here. Audit metadata records the resolved value below.
  const url = new URL(request.url)
  const unmask = url.searchParams.get("unmask") === "true"

  const warnings: string[] = []
  const sourceTables: string[] = []
  let response: NodeDetailResponse = {
    as_of: new Date().toISOString(),
    type,
    id,
    store_uuid: null,
    label: "",
    primary: {},
    relations: {},
    source_tables: sourceTables,
    warnings,
  }

  try {
    if (type === "store") {
      response = await fetchStore(client, id, response)
    } else if (type === "session") {
      response = await fetchSession(client, id, response)
    } else if (type === "settlement") {
      response = await fetchSettlement(client, id, response)
    } else if (type === "payout") {
      response = await fetchPayoutAggregate(client, id, response)
    } else if (type === "audit") {
      response = await fetchAuditAggregate(client, id, response)
    } else {
      // manager / hostess / staff — all derive from store_memberships + auxiliary directories.
      response = await fetchPerson(client, type, id, response, unmask)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[visualize.node-detail] ${type}/${id} threw: ${msg}`)
    warnings.push(`detail query crashed: ${msg}`)
  }

  const queryMs = Math.round(performance.now() - t_start)

  // Best-effort audit (read). When unmask=true and the type is a person,
  // the response surfaces real names — recorded as `unmasked: true`.
  const personType = type === "manager" || type === "hostess" || type === "staff"
  const auditUnmasked = unmask && personType
  try {
    await writeVisualizeAudit({
      auth,
      client,
      action: "visualize_node_detail_read",
      entity_id: id,
      scope_store_uuid: response.store_uuid ?? auth.store_uuid,
      metadata: {
        outcome: warnings.length === 0 ? "success" : "partial",
        type,
        query_ms: queryMs,
        relations: Object.keys(response.relations).length,
        unmask_requested: unmask,
        unmasked: auditUnmasked,
      },
      unmasked: auditUnmasked,
    })
  } catch {
    // never break a read
  }

  return NextResponse.json(response, {
    status: 200,
    headers: {
      "Cache-Control": "private, max-age=10",
      "X-Visualize-Query-Ms": String(queryMs),
    },
  })
}

