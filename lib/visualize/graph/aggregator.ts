/**
 * Visualize Phase 2 — node/edge cap aggregator.
 *
 * Centralizes drop-priority logic so that `network.ts` (P2.1b/c) and the
 * future audit layer (P2.1d) share the same truncation behavior.
 *
 * Drop philosophy (re-confirmed by user):
 *   - Topological anchors first (store > manager > hostess > staff).
 *   - Within a type bucket, higher-weight nodes survive.
 *   - For edges, structural relationships (belongs_to, managed_by, owes_to)
 *     beat dense per-event ones (participated_in, audit lines).
 *   - Truncation is informational, not silent — callers should surface
 *     a `cap_exceeded` warning whenever `dropped > 0`.
 */

import type {
  NetworkEdge,
  NetworkEdgeType,
  NetworkNode,
  NetworkNodeType,
} from "../shapes"

/** Drop-priority for nodes (kept first → dropped last). */
export const NODE_TYPE_KEEP_PRIORITY: ReadonlyArray<NetworkNodeType> = [
  "store",
  "manager",
  "hostess",
  "staff",
  "session",
  "settlement",
  "payout",
  "audit",
]

/**
 * Drop-priority for edges (kept first → dropped last).
 * Tightly coupled to the node priority above: structural anchors retained,
 * high-density per-event edges truncated first.
 */
export const EDGE_TYPE_KEEP_PRIORITY: ReadonlyArray<NetworkEdgeType> = [
  "belongs_to",
  "managed_by",
  "owes_to",
  "produced",
  "paid_to",
  "worked_at",
  "transferred",
  "approved_by",
  "edited_by",
  "rejected",
  "reversed",
  "cancelled_partial",
  "participated_in",
]

export type CapResult<T> = {
  kept: T[]
  dropped: number
  /** Per-type drop counts (rolled up across the input). */
  dropped_by_type: Record<string, number>
}

/**
 * Cap nodes by type-priority. Nodes within the same type are sorted by
 * weight DESC so the heaviest survive when truncating that bucket.
 */
export function capNodes(
  nodes: NetworkNode[],
  cap: number,
): CapResult<NetworkNode> {
  if (nodes.length <= cap) {
    return { kept: nodes, dropped: 0, dropped_by_type: {} }
  }
  const byType = new Map<NetworkNodeType, NetworkNode[]>()
  for (const n of nodes) {
    const arr = byType.get(n.type) ?? []
    arr.push(n)
    byType.set(n.type, arr)
  }
  for (const arr of byType.values()) {
    arr.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
  }
  const kept: NetworkNode[] = []
  const droppedByType: Record<string, number> = {}
  for (const t of NODE_TYPE_KEEP_PRIORITY) {
    const arr = byType.get(t)
    if (!arr) continue
    const remaining = cap - kept.length
    if (remaining <= 0) {
      droppedByType[t] = (droppedByType[t] ?? 0) + arr.length
      continue
    }
    if (arr.length <= remaining) {
      kept.push(...arr)
    } else {
      kept.push(...arr.slice(0, remaining))
      droppedByType[t] = (droppedByType[t] ?? 0) + (arr.length - remaining)
    }
  }
  // Any types not in priority list (e.g., new types added in future) get
  // dropped wholesale — surface as `unknown_type` bucket.
  for (const [t, arr] of byType) {
    if (!NODE_TYPE_KEEP_PRIORITY.includes(t)) {
      droppedByType[`unknown:${t}`] = (droppedByType[`unknown:${t}`] ?? 0) + arr.length
    }
  }
  return { kept, dropped: nodes.length - kept.length, dropped_by_type: droppedByType }
}

/**
 * Cap edges by type-priority. Drops orphan edges (source/target not in
 * the kept-node set) first, then truncates by type-priority + weight.
 */
export function capEdges(
  edges: NetworkEdge[],
  keptNodeIds: ReadonlySet<string>,
  cap: number,
): CapResult<NetworkEdge> {
  // Step 1: drop orphans (whose endpoints didn't survive the node cap).
  const live: NetworkEdge[] = []
  let orphanDropped = 0
  for (const e of edges) {
    if (keptNodeIds.has(e.source) && keptNodeIds.has(e.target)) {
      live.push(e)
    } else {
      orphanDropped++
    }
  }

  if (live.length <= cap) {
    const droppedByType: Record<string, number> = {}
    if (orphanDropped > 0) droppedByType["__orphan__"] = orphanDropped
    return { kept: live, dropped: orphanDropped, dropped_by_type: droppedByType }
  }

  // Step 2: priority + weight truncation.
  const byType = new Map<NetworkEdgeType, NetworkEdge[]>()
  for (const e of live) {
    const arr = byType.get(e.type) ?? []
    arr.push(e)
    byType.set(e.type, arr)
  }
  for (const arr of byType.values()) {
    arr.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
  }

  const kept: NetworkEdge[] = []
  const droppedByType: Record<string, number> = {}
  if (orphanDropped > 0) droppedByType["__orphan__"] = orphanDropped

  for (const t of EDGE_TYPE_KEEP_PRIORITY) {
    const arr = byType.get(t)
    if (!arr) continue
    const remaining = cap - kept.length
    if (remaining <= 0) {
      droppedByType[t] = (droppedByType[t] ?? 0) + arr.length
      continue
    }
    if (arr.length <= remaining) {
      kept.push(...arr)
    } else {
      kept.push(...arr.slice(0, remaining))
      droppedByType[t] = (droppedByType[t] ?? 0) + (arr.length - remaining)
    }
  }
  for (const [t, arr] of byType) {
    if (!EDGE_TYPE_KEEP_PRIORITY.includes(t)) {
      droppedByType[`unknown:${t}`] = (droppedByType[`unknown:${t}`] ?? 0) + arr.length
    }
  }

  return {
    kept,
    dropped: edges.length - kept.length,
    dropped_by_type: droppedByType,
  }
}
