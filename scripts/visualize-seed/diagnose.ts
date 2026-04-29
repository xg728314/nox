/**
 * Visualize seed — diagnostic script.
 *
 * Calls `queryNetworkGraph` directly via the service-role client and
 * prints node/edge counts by type so we can see whether the issue is
 * server-side (no edges generated) or client-side (edges generated but
 * not rendered).
 *
 * Run: npx tsx scripts/visualize-seed/diagnose.ts
 */

import "dotenv/config"
import { createClient } from "@supabase/supabase-js"
import { queryNetworkGraph } from "../../lib/visualize/query/network"
import { getBusinessDateForOps } from "../../lib/time/businessDate"
import { TEST_STORE_UUIDS } from "./constants"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[diag] env missing")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Build a ReadClient-shape object compatible with queryNetworkGraph.
const readClient = {
  from: (table: string) => supabase.from(table) as unknown as ReturnType<typeof supabase.from>,
  rawForAudit: () => supabase,
}

async function main() {
  const today = getBusinessDateForOps()
  console.log(`[diag] today (KST business_date) = ${today}`)
  console.log(`[diag] test stores = ${TEST_STORE_UUIDS.join(", ")}`)

  // Resolve business_day_ids for the test stores on today.
  const { data: days } = await supabase
    .from("store_operating_days")
    .select("id, store_uuid, business_date")
    .in("store_uuid", TEST_STORE_UUIDS as readonly string[] as string[])
    .eq("business_date", today)
    .is("deleted_at", null)
  const businessDayIds = (days ?? []).map((d) => d.id as string)
  console.log(`[diag] business_day_ids resolved: ${businessDayIds.length}`)
  for (const d of days ?? []) {
    console.log(`  - ${d.business_date} ${d.store_uuid} → ${d.id}`)
  }

  const result = await queryNetworkGraph({
    client: readClient as never,
    scope_kind: "building",
    store_uuid: null,
    include_node_types: ["store", "manager", "hostess", "staff", "session", "settlement", "payout", "audit"],
    business_day_ids: businessDayIds,
    node_cap: 1500,
    edge_cap: 5000,
    unmasked: false,
    audit_categories: ["settlement", "payout"],
    business_date_from: today,
    business_date_to: today,
  })

  if (!result.ok) {
    console.error(`[diag] queryNetworkGraph failed: ${result.error} - ${result.message}`)
    process.exit(1)
  }

  console.log(`[diag] nodes total = ${result.nodes.length}`)
  const byNodeType: Record<string, number> = {}
  for (const n of result.nodes) byNodeType[n.type] = (byNodeType[n.type] ?? 0) + 1
  for (const [k, v] of Object.entries(byNodeType)) console.log(`  ${k}: ${v}`)

  console.log(`[diag] edges total = ${result.edges.length}`)
  const byEdgeType: Record<string, number> = {}
  for (const e of result.edges) byEdgeType[e.type] = (byEdgeType[e.type] ?? 0) + 1
  for (const [k, v] of Object.entries(byEdgeType)) console.log(`  ${k}: ${v}`)

  console.log(`[diag] source_tables = ${result.source_tables.join(", ")}`)
  console.log(`[diag] truncated = ${result.truncated}`)
  console.log(`[diag] warnings = ${result.warnings.length}`)
  for (const w of result.warnings) console.log(`  - ${w.type}: ${w.note}`)

  // Print first 5 edges of each type for sanity.
  console.log("\n[diag] sample edges (first 3 of each type):")
  const seen = new Map<string, number>()
  for (const e of result.edges) {
    const c = seen.get(e.type) ?? 0
    if (c >= 3) continue
    seen.set(e.type, c + 1)
    console.log(`  ${e.type}: ${e.source} -> ${e.target}  (id=${e.id})`)
  }

  // Check whether nodes referenced by edges actually exist in nodes set.
  const nodeIdSet = new Set(result.nodes.map((n) => n.id))
  let orphanCount = 0
  for (const e of result.edges) {
    if (!nodeIdSet.has(e.source) || !nodeIdSet.has(e.target)) {
      orphanCount++
      if (orphanCount <= 5) {
        console.warn(`  orphan: ${e.id} src=${e.source} tgt=${e.target} (src in=${nodeIdSet.has(e.source)} tgt in=${nodeIdSet.has(e.target)})`)
      }
    }
  }
  console.log(`[diag] orphan edges (endpoint not in nodes): ${orphanCount}`)
}

main().catch((e) => {
  console.error("[diag] FATAL", e)
  process.exit(1)
})
