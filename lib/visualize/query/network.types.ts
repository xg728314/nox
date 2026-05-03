/**
 * Visualize Phase 2 — network graph query types.
 *
 * 2026-05-03: lib/visualize/query/network.ts 분할.
 *   네트워크 그래프 쿼리 단계마다 fetch 하는 row shape + I/O 타입.
 *   순수 type 정의만 — 런타임 코드 X.
 */

import type { ReadClient } from "../readClient"
import type {
  NetworkAuditCategory,
  NetworkEdge,
  NetworkNode,
  NetworkNodeType,
  NetworkScopeKind,
  NetworkWarning,
} from "../shapes"

export type NetworkQueryInput = {
  client: ReadClient
  scope_kind: NetworkScopeKind
  store_uuid: string | null
  include_node_types: NetworkNodeType[]
  business_day_ids: string[]
  node_cap: number
  edge_cap: number
  unmasked: boolean
  /** P2.1d: which audit_events.action categories to surface as nodes. */
  audit_categories: NetworkAuditCategory[]
  /** Resolved KST yyyy-mm-dd, inclusive (used to derive audit_events
   *  created_at UTC window). */
  business_date_from: string
  business_date_to: string
}

export type NetworkQueryOk = {
  ok: true
  nodes: NetworkNode[]
  edges: NetworkEdge[]
  source_tables: string[]
  warnings: NetworkWarning[]
  truncated: boolean
}

export type NetworkQueryErr = {
  ok: false
  status: number
  error: string
  message: string
}

// ─── DB row shapes (P2.1b) ─────────────────────────────────────────────

export type StoreRow = {
  id: string
  store_name: string
  store_code: string | null
  floor: number | null
}

export type MembershipRow = {
  id: string
  profile_id: string
  store_uuid: string
  role: string
}

export type HostessRow = {
  id: string
  membership_id: string
  store_uuid: string
  stage_name: string | null
  name: string | null
  manager_membership_id: string | null
}

export type ManagerRow = {
  id: string
  membership_id: string
  store_uuid: string
  nickname: string | null
  name: string | null
}

export type ProfileRow = {
  id: string
  full_name: string | null
  nickname: string | null
}

// ─── DB row shapes (P2.1c — time-scoped) ───────────────────────────────

export type SessionRow = {
  id: string
  store_uuid: string
  room_uuid: string | null
  business_day_id: string
  status: string
  started_at: string | null
  ended_at: string | null
}

export type RoomRow = {
  id: string
  room_no: string | null
}

export type SettlementRow = {
  id: string
  store_uuid: string
  session_id: string
  status: string
  total_amount: unknown
  manager_amount: unknown
  hostess_amount: unknown
  store_amount: unknown
  confirmed_at: string | null
}

export type SettlementItemRow = {
  id: string
  settlement_id: string
  store_uuid: string
  role_type: string
  amount: unknown
  participant_id: string | null
  membership_id: string | null
}

export type PayoutRow = {
  id: string
  settlement_id: string | null
  settlement_item_id: string | null
  status: string
  amount: unknown
  target_store_uuid: string | null
  payout_type: string | null
}

export type ParticipantRow = {
  id: string
  session_id: string
  store_uuid: string
  membership_id: string
  role: string
  price_amount: unknown
  origin_store_uuid: string | null
}

export type CrossStoreRow = {
  id: string
  // Schema migrated in 038 (cross_store_legacy_drop): legacy columns
  // `store_uuid` / `target_store_uuid` were dropped from the header.
  // The current source-of-truth columns are `from_store_uuid` (debtor)
  // and `to_store_uuid` (creditor). The semantic direction is identical
  // to the original `owes_to` edge: from → to means "from owes to".
  from_store_uuid: string
  to_store_uuid: string
  total_amount: unknown
  prepaid_amount: unknown
  remaining_amount: unknown
  status: string
  created_at: string | null
}

export type TransferRow = {
  id: string
  hostess_membership_id: string
  from_store_uuid: string
  to_store_uuid: string
  business_day_id: string | null
  status: string
  created_at: string | null
}
