/**
 * Visualize layer — shared response shapes.
 *
 * READ-ONLY surface. No writes anywhere. No imports from
 * `lib/(settlement|session|orders|receipt)/services/**`. Stored DB values
 * only — no recalculation. See app/super-admin/visualize/* for consumers.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Node IDs — fixed set for Phase 1 sankey layout stability. Adding a node
// here is a Phase change; the UI keys off these literals.
// ─────────────────────────────────────────────────────────────────────────────

export const MONEY_NODE_IDS = {
  // Source
  SRC_ORDERS: "src_orders",
  SRC_TIME: "src_time",
  // Aggregate
  RECEIPTS_FINALIZED: "receipts_finalized",
  RECEIPTS_DRAFT: "receipts_draft",
  // Allocation
  ALLOC_MANAGER: "alloc_manager",
  ALLOC_HOSTESS: "alloc_hostess",
  ALLOC_STORE: "alloc_store",
  ALLOC_OTHER: "alloc_other", // fallback bucket for unknown role_type
  // Sink
  PAYOUT_APPROVED: "payout_approved",
  PAYOUT_PENDING: "payout_pending", // DERIVED — clamp(0, alloc - approved - reversal - prepay - xstore_out)
  XSTORE_OUT: "xstore_out",
  CREDIT_OUTSTANDING: "credit_outstanding",
  PREPAY_DEDUCTION: "prepay_deduction",
  // Reversal lane
  PAYOUT_REJECTED: "payout_rejected",
  PAYOUT_REVERSED: "payout_reversed",
  PAYOUT_CANCELLED_PARTIAL: "payout_cancelled_partial",
} as const

export type MoneyNodeId = (typeof MONEY_NODE_IDS)[keyof typeof MONEY_NODE_IDS]

export type MoneyNodeGroup =
  | "source"
  | "aggregate"
  | "allocation"
  | "sink"
  | "reversal"

export type MoneyLinkKind =
  | "primary"
  | "deduction"
  | "cross_store"
  | "reversal"
  | "outstanding"

export type MoneyNode = {
  id: MoneyNodeId
  label: string
  group: MoneyNodeGroup
  amount: number
  derived?: boolean // true when the value is computed (not stored)
  meta?: { row_count?: number; table?: string }
}

export type MoneyLink = {
  source: MoneyNodeId
  target: MoneyNodeId
  amount: number
  kind: MoneyLinkKind
  source_table: string
}

export type MoneyWarning = {
  type:
    | "sum_mismatch"
    | "orphan_settlement"
    | "missing_receipt"
    | "partial_payout"
    | "unknown_status"
    | "unknown_role_type"
    | "schema_missing_column"
    | "duplicate_settlement"
  session_id?: string
  settlement_id?: string
  expected?: number
  actual?: number
  note: string
}

export type MoneyFlowScope = {
  store_uuid: string
  business_day_id: string
  business_date: string | null
  operating_day_status: "open" | "closed" | string | null
}

export type MoneyFlowTotals = {
  receipts: {
    count: number
    gross_total: number
    finalized: number
    draft: number
  }
  settlements: {
    count: number
    total: number
    draft: number
    confirmed: number
  }
  payouts: {
    approved: number
    rejected: number
    reversed: number
    cancelled_partial: number
  }
  cross_store: {
    in_pending: number
    in_settled: number
    out_pending: number
    out_settled: number
  }
  credits_outstanding: number
  prepay_deduction: number
}

export type MoneyFlowResponse = {
  as_of: string
  scope: MoneyFlowScope
  source_tables: string[]
  totals: MoneyFlowTotals
  nodes: MoneyNode[]
  links: MoneyLink[]
  warnings: MoneyWarning[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Network graph (Jarvis-style force-directed). Distinct from the
// Sankey shape above; nodes here are individual entities, not aggregate bins.
// ─────────────────────────────────────────────────────────────────────────────

export type NetworkNodeType =
  | "store"
  | "manager"
  | "hostess"
  | "staff"
  | "session"
  | "settlement"
  | "payout"
  | "audit"

export type NetworkEdgeType =
  | "belongs_to"
  | "worked_at"
  | "managed_by"
  | "participated_in"
  | "produced"
  | "paid_to"
  | "owes_to"
  | "transferred"
  | "approved_by"
  | "edited_by"
  | "rejected"
  | "reversed"
  | "cancelled_partial"

export type NetworkStatus = "normal" | "warning" | "risk"

export type NetworkTimeRange =
  | "today"
  | "yesterday"
  | "this_month"
  | "last_7_days"
  | "custom"

export type NetworkScopeKind = "building" | "store"

export type NetworkAuditCategory =
  | "settlement"
  | "payout"
  | "participant"
  | "access"
  | "other"

/** All audit categories EXCEPT 'other', in display order. */
export const NETWORK_AUDIT_CATEGORIES: readonly NetworkAuditCategory[] = [
  "settlement",
  "payout",
  "participant",
  "access",
]

export const NETWORK_DEFAULT_AUDIT_CATEGORIES: readonly NetworkAuditCategory[] = [
  "settlement",
  "payout",
]

export type NetworkNode = {
  /** Stable id, format `<type>:<entity_uuid>` (or `<type>:<group-key>` for aggregates). */
  id: string
  type: NetworkNodeType
  label: string
  /** Owning store, when applicable. Used for cluster centroids. */
  store_uuid?: string
  /** Display weight, normalized 0..1 by aggregator before send. */
  weight: number
  status?: NetworkStatus
  meta?: Record<string, unknown>
}

export type NetworkEdge = {
  id: string
  source: string
  target: string
  type: NetworkEdgeType
  /** Normalized 0..1 (display thickness driver). */
  weight: number
  /** Stored amount, when relevant (e.g., paid_to, owes_to). */
  amount?: number
  status?: NetworkStatus
  /** Earliest event in window for this edge (audit / session start). */
  started_at?: string
  meta?: Record<string, unknown>
}

export type NetworkScope = {
  kind: NetworkScopeKind
  store_uuid: string | null
  time_range: NetworkTimeRange
  /** Resolved KST business_date range. */
  from: string
  /** Inclusive. */
  to: string
  /** Resolved business_day_id list per store within the window. */
  business_day_ids: string[]
  audit_categories: NetworkAuditCategory[]
  include_node_types: NetworkNodeType[]
}

export type NetworkTotals = {
  nodes: { total: number; by_type: Partial<Record<NetworkNodeType, number>> }
  edges: { total: number; by_type: Partial<Record<NetworkEdgeType, number>> }
  /** True when node_cap or edge_cap forced trimming. */
  truncated: boolean
  /** Server-side query duration in ms (also surfaced as response header). */
  query_ms: number
}

export type NetworkWarning = {
  type:
    | "scope_empty"
    | "operating_day_missing"
    | "cap_exceeded"
    | "audit_orphan"
    | "schema_missing_column"
    | "introspection_unavailable"
    | "unknown_action"
    | "query_failed"
    | "orphan_node"
  note: string
  detail?: Record<string, unknown>
}

export type NetworkGraphResponse = {
  as_of: string
  scope: NetworkScope
  source_tables: string[]
  totals: NetworkTotals
  nodes: NetworkNode[]
  edges: NetworkEdge[]
  warnings: NetworkWarning[]
}
