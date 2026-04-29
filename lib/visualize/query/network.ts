/**
 * Visualize Phase 2 — network graph query (P2.1b + P2.1c).
 *
 * P2.1b: stores + manager/hostess/staff nodes (active memberships)
 *        + belongs_to + managed_by edges. (static topology)
 * P2.1c: session/settlement/payout nodes + produced/paid_to/
 *        participated_in/worked_at/owes_to/transferred edges.
 *        Time-window scoped via `business_day_ids`.
 *
 * READ-ONLY. Stored values only. No derived nodes. No recalc.
 * Imports allowed:
 *   - lib/visualize/{readClient, shapes, pii}     (visualize-internal)
 *   - lib/visualize/graph/{aggregator, categories} (visualize-internal)
 *
 * Imports forbidden (operational logic):
 *   - lib/(settlement|session|orders|receipt)/services/**
 *
 * Failure policy: every supabase select is awaited as `{ data, error }`;
 * non-fatal errors append a `query_failed` warning and skip the dependent
 * nodes/edges. The function NEVER throws — the route relies on this.
 */

import type { ReadClient } from "../readClient"
import { maskName } from "../pii"
import { capEdges, capNodes } from "../graph/aggregator"
import { buildAuditNodes } from "./auditNodes"
import type {
  NetworkAuditCategory,
  NetworkEdge,
  NetworkEdgeType,
  NetworkNode,
  NetworkNodeType,
  NetworkScopeKind,
  NetworkStatus,
  NetworkWarning,
} from "../shapes"

const MEMBERSHIP_ROLES_OF_INTEREST: ReadonlyArray<{
  role: string
  nodeType: NetworkNodeType
}> = [
  { role: "manager", nodeType: "manager" },
  { role: "hostess", nodeType: "hostess" },
  { role: "waiter", nodeType: "staff" },
  { role: "staff", nodeType: "staff" },
]

// Risky payout signals — DB constraints (post-038):
//   status        ∈ {pending, completed, cancelled}
//   payout_type   ∈ {full, partial, prepayment, cross_store_prepay, reversal}
// We treat status='cancelled' OR payout_type='reversal' as risk; status
// 'pending' falls through to 'normal' (operationally normal pre-payout).
const PAYOUT_RISK_STATUSES = new Set(["cancelled"])
const PAYOUT_RISK_TYPES = new Set(["reversal"])

// Settlement statuses that are pre-finalize → 'warning'.
const SETTLEMENT_WARNING_STATUSES = new Set(["draft", "open", "partial"])

// cross_store_settlements statuses considered "closed" / non-outstanding.
const CROSS_STORE_CLOSED_STATUSES = new Set(["closed", "settled"])

function toNum(v: unknown): number {
  if (v == null) return 0
  if (typeof v === "number") return Number.isFinite(v) ? v : 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function clamp01(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0
  if (v >= 1) return 1
  return v
}

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

type StoreRow = {
  id: string
  store_name: string
  store_code: string | null
  floor: number | null
}

type MembershipRow = {
  id: string
  profile_id: string
  store_uuid: string
  role: string
}

type HostessRow = {
  id: string
  membership_id: string
  store_uuid: string
  stage_name: string | null
  name: string | null
  manager_membership_id: string | null
}

type ManagerRow = {
  id: string
  membership_id: string
  store_uuid: string
  nickname: string | null
  name: string | null
}

type ProfileRow = {
  id: string
  full_name: string | null
  nickname: string | null
}

// ─── P2.1c row types ────────────────────────────────────────────────────

type SessionRow = {
  id: string
  store_uuid: string
  room_uuid: string | null
  business_day_id: string
  status: string
  started_at: string | null
  ended_at: string | null
}

type RoomRow = {
  id: string
  room_no: string | null
}

type SettlementRow = {
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

type SettlementItemRow = {
  id: string
  settlement_id: string
  store_uuid: string
  role_type: string
  amount: unknown
  participant_id: string | null
  membership_id: string | null
}

type PayoutRow = {
  id: string
  settlement_id: string | null
  settlement_item_id: string | null
  status: string
  amount: unknown
  target_store_uuid: string | null
  payout_type: string | null
}

type ParticipantRow = {
  id: string
  session_id: string
  store_uuid: string
  membership_id: string
  role: string
  price_amount: unknown
  origin_store_uuid: string | null
}

type CrossStoreRow = {
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

type TransferRow = {
  id: string
  hostess_membership_id: string
  from_store_uuid: string
  to_store_uuid: string
  business_day_id: string | null
  status: string
  created_at: string | null
}

export async function queryNetworkGraph(
  input: NetworkQueryInput,
): Promise<NetworkQueryOk | NetworkQueryErr> {
  const {
    client,
    scope_kind,
    store_uuid,
    include_node_types,
    node_cap,
    edge_cap,
    unmasked,
    audit_categories,
    business_date_from,
    business_date_to,
  } = input

  const warnings: NetworkWarning[] = []
  const sourceTables: string[] = []

  const wantStore = include_node_types.includes("store")
  const wantManager = include_node_types.includes("manager")
  const wantHostess = include_node_types.includes("hostess")
  const wantStaff = include_node_types.includes("staff")
  const wantAnyPerson = wantManager || wantHostess || wantStaff

  // ── 1. stores ───────────────────────────────────────────────────────
  let storesRows: StoreRow[] = []
  {
    let q = client
      .from("stores")
      .select("id, store_name, store_code, floor")
      .is("deleted_at", null)
      .eq("is_active", true)
    if (scope_kind === "store" && store_uuid) {
      q = q.eq("id", store_uuid)
    }
    const { data, error } = await q
    sourceTables.push("stores")
    if (error) {
      return {
        ok: false,
        status: 500,
        error: "QUERY_FAILED",
        message: `stores: ${error.message}`,
      }
    }
    storesRows = ((data ?? []) as unknown) as StoreRow[]
  }

  if (storesRows.length === 0) {
    warnings.push({
      type: "scope_empty",
      note:
        scope_kind === "store"
          ? "Selected store does not exist or is inactive."
          : "No active stores in building.",
    })
    return {
      ok: true,
      nodes: [],
      edges: [],
      source_tables: sourceTables,
      warnings,
      truncated: false,
    }
  }

  const storeIds = storesRows.map((s) => s.id)
  const storeIdSet = new Set(storeIds)

  // ── 2. store_memberships ────────────────────────────────────────────
  let memberships: MembershipRow[] = []
  if (wantAnyPerson) {
    const rolesWanted: string[] = []
    if (wantManager) rolesWanted.push("manager")
    if (wantHostess) rolesWanted.push("hostess")
    if (wantStaff) rolesWanted.push("waiter", "staff")

    const { data, error } = await client
      .from("store_memberships")
      .select("id, profile_id, store_uuid, role")
      .in("store_uuid", storeIds)
      .in("role", rolesWanted)
      .eq("status", "approved")
      .eq("is_primary", true)
      .is("deleted_at", null)
    sourceTables.push("store_memberships")
    if (error) {
      warnings.push({
        type: "query_failed",
        note: `store_memberships: ${error.message}`,
      })
    } else {
      memberships = ((data ?? []) as unknown) as MembershipRow[]
    }
  }

  // Aux directories — fetch in parallel; failures degrade label quality but never 500.
  const membershipIds = memberships.map((m) => m.id)
  const profileIds = Array.from(new Set(memberships.map((m) => m.profile_id)))

  const [hostessesRes, managersRes, profilesRes] = await Promise.all([
    wantHostess && membershipIds.length > 0
      ? client
          .from("hostesses")
          .select("id, membership_id, store_uuid, stage_name, name, manager_membership_id")
          .in("membership_id", membershipIds)
          .is("deleted_at", null)
          .eq("is_active", true)
      : Promise.resolve({ data: [], error: null }),
    wantManager && membershipIds.length > 0
      ? client
          .from("managers")
          .select("id, membership_id, store_uuid, nickname, name")
          .in("membership_id", membershipIds)
          .is("deleted_at", null)
          .eq("is_active", true)
      : Promise.resolve({ data: [], error: null }),
    profileIds.length > 0
      ? client
          .from("profiles")
          .select("id, full_name, nickname")
          .in("id", profileIds)
          .is("deleted_at", null)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (hostessesRes.error) {
    warnings.push({
      type: "query_failed",
      note: `hostesses: ${hostessesRes.error.message}`,
    })
  }
  if (managersRes.error) {
    warnings.push({
      type: "query_failed",
      note: `managers: ${managersRes.error.message}`,
    })
  }
  if (profilesRes.error) {
    warnings.push({
      type: "query_failed",
      note: `profiles: ${profilesRes.error.message}`,
    })
  }
  if (wantHostess) sourceTables.push("hostesses")
  if (wantManager) sourceTables.push("managers")
  if (profileIds.length > 0) sourceTables.push("profiles")

  const hostessRows = ((hostessesRes.data ?? []) as unknown) as HostessRow[]
  const managerRows = ((managersRes.data ?? []) as unknown) as ManagerRow[]
  const profileRows = ((profilesRes.data ?? []) as unknown) as ProfileRow[]

  const hostessByMembership = new Map<string, HostessRow>()
  for (const h of hostessRows) hostessByMembership.set(h.membership_id, h)
  const managerByMembership = new Map<string, ManagerRow>()
  for (const m of managerRows) managerByMembership.set(m.membership_id, m)
  const profileById = new Map<string, ProfileRow>()
  for (const p of profileRows) profileById.set(p.id, p)

  // ── 3. build nodes ──────────────────────────────────────────────────
  const nodes: NetworkNode[] = []
  const nodeIds = new Set<string>()

  function pushNode(n: NetworkNode) {
    if (nodeIds.has(n.id)) return
    nodeIds.add(n.id)
    nodes.push(n)
  }

  if (wantStore) {
    for (const s of storesRows) {
      pushNode({
        id: storeNodeId(s.id),
        type: "store",
        label: s.store_name,
        store_uuid: s.id,
        weight: 1,
        status: "normal",
        meta: {
          store_code: s.store_code,
          floor: s.floor,
        },
      })
    }
  }

  // Person nodes — derived from memberships
  for (const m of memberships) {
    const targetType = mapRoleToNodeType(m.role)
    if (!targetType) continue
    if (!include_node_types.includes(targetType)) continue
    if (!storeIdSet.has(m.store_uuid)) continue

    const profile = profileById.get(m.profile_id) ?? null
    let label: string
    if (targetType === "hostess") {
      const h = hostessByMembership.get(m.id) ?? null
      label = resolveHostessLabel(h, profile, unmasked)
    } else if (targetType === "manager") {
      const mg = managerByMembership.get(m.id) ?? null
      label = resolveManagerLabel(mg, profile, unmasked)
    } else {
      label = resolveStaffLabel(profile, unmasked)
    }

    pushNode({
      id: personNodeId(targetType, m.id),
      type: targetType,
      label,
      store_uuid: m.store_uuid,
      weight: 0.3, // static default; P2.1c will reweight by activity
      status: "normal",
      meta: {
        membership_id: m.id,
        role: m.role,
      },
    })
  }

  // ── 4. build edges ──────────────────────────────────────────────────
  const edges: NetworkEdge[] = []
  const edgeIds = new Set<string>()

  function pushEdge(e: NetworkEdge) {
    if (edgeIds.has(e.id)) return
    edgeIds.add(e.id)
    edges.push(e)
  }

  // belongs_to: membership → store
  if (wantStore && wantAnyPerson) {
    for (const m of memberships) {
      const targetType = mapRoleToNodeType(m.role)
      if (!targetType) continue
      if (!include_node_types.includes(targetType)) continue
      const personId = personNodeId(targetType, m.id)
      const storeId = storeNodeId(m.store_uuid)
      if (!nodeIds.has(personId) || !nodeIds.has(storeId)) continue
      pushEdge({
        id: edgeId("belongs_to", m.id),
        source: personId,
        target: storeId,
        type: "belongs_to",
        weight: 0.5,
        status: "normal",
      })
    }
  }

  // managed_by: hostess → manager
  if (wantHostess && wantManager) {
    let orphanCount = 0
    for (const h of hostessRows) {
      if (!h.manager_membership_id) continue
      const hostessNode = personNodeId("hostess", h.membership_id)
      const managerNode = personNodeId("manager", h.manager_membership_id)
      if (!nodeIds.has(hostessNode)) continue
      if (!nodeIds.has(managerNode)) {
        // The supervisor membership exists but isn't in the visible
        // scope (e.g., manager's primary store differs). Surface as an
        // orphan rather than silently dropping the relationship.
        orphanCount++
        continue
      }
      pushEdge({
        id: edgeId("managed_by", h.membership_id),
        source: hostessNode,
        target: managerNode,
        type: "managed_by",
        weight: 0.5,
        status: "normal",
      })
    }
    if (orphanCount > 0) {
      warnings.push({
        type: "orphan_node",
        note: `${orphanCount} hostess(es) reference a manager outside the visible scope.`,
        detail: { count: orphanCount },
      })
    }
  }

  // ── 5. P2.1c: time-scoped data ──────────────────────────────────────
  //
  // Skipped entirely if the operating-day window resolved to empty —
  // P2.1b topology stands alone in that case.

  const wantSession = include_node_types.includes("session")
  const wantSettlement = include_node_types.includes("settlement")
  const wantPayout = include_node_types.includes("payout")
  const wantTimeScopedEdges = wantAnyPerson || wantStore // edges that need participants/cross-store data
  const wantP2c =
    wantSession || wantSettlement || wantPayout || wantTimeScopedEdges

  let sessionRows: SessionRow[] = []
  let sessionIds: string[] = []
  let roomById = new Map<string, RoomRow>()
  let settlementRows: SettlementRow[] = []
  let settlementIds: string[] = []
  let itemRows: SettlementItemRow[] = []
  let payoutRows: PayoutRow[] = []
  let participantRows: ParticipantRow[] = []
  let crossStoreRows: CrossStoreRow[] = []
  let transferRows: TransferRow[] = []

  if (wantP2c && input.business_day_ids.length > 0) {
    // ─── Q-c1: room_sessions in window ────────────────────────────────
    {
      const { data, error } = await client
        .from("room_sessions")
        .select(
          "id, store_uuid, room_uuid, business_day_id, status, started_at, ended_at",
        )
        .in("business_day_id", input.business_day_ids)
        .is("deleted_at", null)
      sourceTables.push("room_sessions")
      if (error) {
        warnings.push({
          type: "query_failed",
          note: `room_sessions: ${error.message}`,
        })
      } else {
        sessionRows = ((data ?? []) as unknown) as SessionRow[]
        sessionIds = sessionRows.map((r) => r.id)
      }
    }

    const sessionRoomIds = Array.from(
      new Set(
        sessionRows
          .map((s) => s.room_uuid)
          .filter((id): id is string => !!id),
      ),
    )

    // ─── Phase 3: rooms / settlements / participants / cross-store / transfers
    const [
      roomsRes,
      settlementsRes,
      participantsRes,
      crossStoreOutRes,
      crossStoreInRes,
      transfersRes,
    ] = await Promise.all([
      // rooms — for session label only
      sessionRoomIds.length > 0
        ? client
            .from("rooms")
            .select("id, room_no")
            .in("id", sessionRoomIds)
            .is("deleted_at", null)
        : Promise.resolve({ data: [], error: null }),
      // settlements
      sessionIds.length > 0
        ? client
            .from("settlements")
            .select(
              "id, store_uuid, session_id, status, total_amount, manager_amount, hostess_amount, store_amount, confirmed_at",
            )
            .in("session_id", sessionIds)
            .is("deleted_at", null)
        : Promise.resolve({ data: [], error: null }),
      // session_participants — needed for participated_in + worked_at + node weight
      sessionIds.length > 0
        ? client
            .from("session_participants")
            .select(
              "id, session_id, store_uuid, membership_id, role, price_amount, origin_store_uuid",
            )
            .in("session_id", sessionIds)
            .is("deleted_at", null)
        : Promise.resolve({ data: [], error: null }),
      // cross_store_settlements (we owe — from_store_uuid IN scope).
      // Schema migration 038 dropped the legacy `store_uuid` /
      // `target_store_uuid` columns from this table; current scope
      // columns are `from_store_uuid` (debtor) / `to_store_uuid`
      // (creditor). Two queries instead of `.or()` (Phase 1 lesson).
      storeIds.length > 0
        ? client
            .from("cross_store_settlements")
            .select(
              "id, from_store_uuid, to_store_uuid, total_amount, prepaid_amount, remaining_amount, status, created_at",
            )
            .in("from_store_uuid", storeIds)
            .is("deleted_at", null)
        : Promise.resolve({ data: [], error: null }),
      // cross_store_settlements (others owe us — to_store_uuid IN scope)
      storeIds.length > 0
        ? client
            .from("cross_store_settlements")
            .select(
              "id, from_store_uuid, to_store_uuid, total_amount, prepaid_amount, remaining_amount, status, created_at",
            )
            .in("to_store_uuid", storeIds)
            .is("deleted_at", null)
        : Promise.resolve({ data: [], error: null }),
      // transfer_requests — schema does NOT have deleted_at (002 schema).
      input.business_day_ids.length > 0
        ? client
            .from("transfer_requests")
            .select(
              "id, hostess_membership_id, from_store_uuid, to_store_uuid, business_day_id, status, created_at",
            )
            .in("business_day_id", input.business_day_ids)
            .eq("status", "approved")
        : Promise.resolve({ data: [], error: null }),
    ])

    if (sessionRoomIds.length > 0) sourceTables.push("rooms")
    if (sessionIds.length > 0) {
      sourceTables.push("settlements", "session_participants")
    }
    if (storeIds.length > 0) sourceTables.push("cross_store_settlements")
    if (input.business_day_ids.length > 0) sourceTables.push("transfer_requests")

    if (roomsRes.error) {
      warnings.push({
        type: "query_failed",
        note: `rooms: ${roomsRes.error.message}`,
      })
    } else {
      for (const r of (roomsRes.data ?? []) as RoomRow[]) {
        roomById.set(r.id, r)
      }
    }
    if (settlementsRes.error) {
      warnings.push({
        type: "query_failed",
        note: `settlements: ${settlementsRes.error.message}`,
      })
    } else {
      settlementRows = ((settlementsRes.data ?? []) as unknown) as SettlementRow[]
      settlementIds = settlementRows.map((s) => s.id)
    }
    if (participantsRes.error) {
      warnings.push({
        type: "query_failed",
        note: `session_participants: ${participantsRes.error.message}`,
      })
    } else {
      participantRows = ((participantsRes.data ?? []) as unknown) as ParticipantRow[]
    }
    if (crossStoreOutRes.error) {
      warnings.push({
        type: "query_failed",
        note: `cross_store_settlements (out): ${crossStoreOutRes.error.message}`,
      })
    }
    if (crossStoreInRes.error) {
      warnings.push({
        type: "query_failed",
        note: `cross_store_settlements (in): ${crossStoreInRes.error.message}`,
      })
    }
    if (transfersRes.error) {
      warnings.push({
        type: "query_failed",
        note: `transfer_requests: ${transfersRes.error.message}`,
      })
    } else {
      transferRows = ((transfersRes.data ?? []) as unknown) as TransferRow[]
    }

    // Merge cross-store rows (dedupe by id since a single row could match
    // both `store_uuid IN` and `target_store_uuid IN` if both endpoints
    // are in scope, e.g., building view).
    const xMap = new Map<string, CrossStoreRow>()
    for (const r of (crossStoreOutRes.data ?? []) as CrossStoreRow[]) {
      xMap.set(r.id, r)
    }
    for (const r of (crossStoreInRes.data ?? []) as CrossStoreRow[]) {
      xMap.set(r.id, r)
    }
    crossStoreRows = Array.from(xMap.values())

    // ─── Phase 4: settlement_items + payout_records (need settlementIds)
    if (settlementIds.length > 0 && (wantSettlement || wantPayout)) {
      const [itemsRes2, payoutsRes2] = await Promise.all([
        client
          .from("settlement_items")
          .select(
            "id, settlement_id, store_uuid, role_type, amount, participant_id, membership_id",
          )
          .in("settlement_id", settlementIds)
          .is("deleted_at", null),
        wantPayout
          ? client
              .from("payout_records")
              .select(
                "id, settlement_id, settlement_item_id, status, amount, target_store_uuid, payout_type",
              )
              .in("settlement_id", settlementIds)
              .is("deleted_at", null)
          : Promise.resolve({ data: [], error: null }),
      ])
      sourceTables.push("settlement_items")
      if (wantPayout) sourceTables.push("payout_records")

      if (itemsRes2.error) {
        warnings.push({
          type: "query_failed",
          note: `settlement_items: ${itemsRes2.error.message}`,
        })
      } else {
        itemRows = ((itemsRes2.data ?? []) as unknown) as SettlementItemRow[]
      }
      if (payoutsRes2.error) {
        warnings.push({
          type: "query_failed",
          note: `payout_records: ${payoutsRes2.error.message}`,
        })
      } else {
        payoutRows = ((payoutsRes2.data ?? []) as unknown) as PayoutRow[]
      }
    }
  }

  // ── 6. P2.1c: build session / settlement / payout nodes ─────────────

  // Pre-compute participant count per session for session weight + person reweight.
  const participantsBySession = new Map<string, ParticipantRow[]>()
  for (const p of participantRows) {
    const arr = participantsBySession.get(p.session_id) ?? []
    arr.push(p)
    participantsBySession.set(p.session_id, arr)
  }

  if (wantSession) {
    for (const s of sessionRows) {
      const room = s.room_uuid ? roomById.get(s.room_uuid) ?? null : null
      const participantCount = participantsBySession.get(s.id)?.length ?? 0
      const label = room?.room_no ? `${room.room_no}호` : "(룸)"
      pushNode({
        id: sessionNodeId(s.id),
        type: "session",
        label,
        store_uuid: s.store_uuid,
        weight: clamp01(0.2 + participantCount / 10),
        status: "normal",
        meta: {
          session_id: s.id,
          started_at: s.started_at,
          ended_at: s.ended_at,
          status: s.status,
          participant_count: participantCount,
        },
      })
    }
  }

  // Settlement nodes — derived sum_mismatch is intentionally NOT added
  // (we only reflect stored status here).
  if (wantSettlement) {
    for (const st of settlementRows) {
      const total = toNum(st.total_amount)
      const status: NetworkStatus = SETTLEMENT_WARNING_STATUSES.has(st.status)
        ? "warning"
        : "normal"
      pushNode({
        id: settlementNodeId(st.id),
        type: "settlement",
        label: `정산 ${formatWonShort(total)}`,
        store_uuid: st.store_uuid,
        weight: clamp01(0.2 + total / 1_000_000),
        status,
        meta: {
          settlement_id: st.id,
          session_id: st.session_id,
          status: st.status,
          total_amount: total,
          manager_amount: toNum(st.manager_amount),
          hostess_amount: toNum(st.hostess_amount),
          store_amount: toNum(st.store_amount),
          confirmed_at: st.confirmed_at,
        },
      })
    }
  }

  // Payout nodes — aggregate by (settlement_item_id ?? settlement_id, status).
  // Phase 1 design: collapse to per-bucket so we don't explode the graph
  // when a single settlement_item has many partial payouts.
  if (wantPayout) {
    type PayoutAgg = {
      settlement_id: string | null
      settlement_item_id: string | null
      target_store_uuid: string | null
      status: string
      payout_type: string | null
      amount: number
      record_count: number
    }
    const agg = new Map<string, PayoutAgg>()
    for (const p of payoutRows) {
      const itemKey =
        p.settlement_item_id ??
        (p.settlement_id ? `_no_item_${p.settlement_id}` : "_no_link")
      // Aggregate by (item, status, payout_type) so reversals stay
      // distinct from normal payouts even when they share the item.
      const key = `${itemKey}|${p.status}|${p.payout_type ?? ""}`
      const cur = agg.get(key)
      if (cur) {
        cur.amount += toNum(p.amount)
        cur.record_count += 1
      } else {
        agg.set(key, {
          settlement_id: p.settlement_id,
          settlement_item_id: p.settlement_item_id,
          target_store_uuid: p.target_store_uuid,
          status: p.status,
          payout_type: p.payout_type,
          amount: toNum(p.amount),
          record_count: 1,
        })
      }
    }
    const settlementById = new Map(settlementRows.map((s) => [s.id, s]))
    for (const [key, a] of agg) {
      const isRisk =
        PAYOUT_RISK_STATUSES.has(a.status) ||
        (a.payout_type != null && PAYOUT_RISK_TYPES.has(a.payout_type))
      const status: NetworkStatus = isRisk ? "risk" : "normal"
      const settlement = a.settlement_id
        ? settlementById.get(a.settlement_id) ?? null
        : null
      const labelTail = a.payout_type === "reversal" ? "reversal" : a.status
      pushNode({
        id: `payout:${key}`,
        type: "payout",
        label: `${labelTail} ${formatWonShort(a.amount)}`,
        store_uuid: settlement?.store_uuid,
        weight: clamp01(0.1 + a.amount / 1_000_000),
        status,
        meta: {
          settlement_id: a.settlement_id,
          settlement_item_id: a.settlement_item_id,
          target_store_uuid: a.target_store_uuid,
          status: a.status,
          payout_type: a.payout_type,
          amount: a.amount,
          record_count: a.record_count,
        },
      })
    }
  }

  // ── 7. P2.1c: build edges ────────────────────────────────────────────

  // produced: session → settlement
  if (wantSession && wantSettlement) {
    for (const st of settlementRows) {
      const sessionN = sessionNodeId(st.session_id)
      const settlementN = settlementNodeId(st.id)
      if (!nodeIds.has(sessionN) || !nodeIds.has(settlementN)) continue
      const total = toNum(st.total_amount)
      pushEdge({
        id: `produced:${st.id}`,
        source: sessionN,
        target: settlementN,
        type: "produced",
        weight: clamp01(0.3 + total / 1_000_000),
        amount: total,
        status: "normal",
      })
    }
  }

  // participated_in: hostess/staff → session  (manager rows skipped — they
  // appear via paid_to/managed_by; participated_in is for the working ones)
  if (wantSession) {
    for (const p of participantRows) {
      let personType: NetworkNodeType
      if (p.role === "hostess") personType = "hostess"
      else if (p.role === "manager") continue
      else if (p.role === "waiter" || p.role === "staff") personType = "staff"
      else continue
      const personN = personNodeId(personType, p.membership_id)
      const sessionN = sessionNodeId(p.session_id)
      if (!nodeIds.has(personN) || !nodeIds.has(sessionN)) continue
      pushEdge({
        id: `participated_in:${p.id}`,
        source: personN,
        target: sessionN,
        type: "participated_in",
        weight: clamp01(0.1 + toNum(p.price_amount) / 200_000),
        amount: toNum(p.price_amount),
        status: "normal",
      })
    }
  }

  // worked_at: hostess → working_store (cross-store work).
  // Edge means "this hostess worked at THIS store, not their origin store."
  // origin_store_uuid (002 + 009) MAY be null if the row is legacy/local —
  // skip in that case rather than guessing.
  if (wantHostess && wantStore) {
    type WorkedAgg = {
      membership_id: string
      working_store_uuid: string
      session_count: number
      session_ids: string[]
    }
    const aggMap = new Map<string, WorkedAgg>()
    for (const p of participantRows) {
      if (p.role !== "hostess") continue
      const origin = p.origin_store_uuid
      const working = p.store_uuid
      if (!origin || !working) continue
      if (origin === working) continue
      const key = `${p.membership_id}|${working}`
      const cur = aggMap.get(key)
      if (cur) {
        cur.session_count += 1
        if (!cur.session_ids.includes(p.session_id)) cur.session_ids.push(p.session_id)
      } else {
        aggMap.set(key, {
          membership_id: p.membership_id,
          working_store_uuid: working,
          session_count: 1,
          session_ids: [p.session_id],
        })
      }
    }
    for (const [key, a] of aggMap) {
      const hostessN = personNodeId("hostess", a.membership_id)
      const storeN = storeNodeId(a.working_store_uuid)
      if (!nodeIds.has(hostessN) || !nodeIds.has(storeN)) continue
      pushEdge({
        id: `worked_at:${key}`,
        source: hostessN,
        target: storeN,
        type: "worked_at",
        weight: clamp01(0.2 + a.session_count / 5),
        status: "normal",
        meta: {
          session_count: a.session_count,
          session_ids: a.session_ids,
        },
      })
    }
  }

  // paid_to: settlement → person/store (one edge per settlement_item).
  // role_type='store' → store node; role_type='manager'/'hostess' → membership.
  // membership_id direct preferred; fallback to participant_id → participant.membership_id.
  if (wantSettlement) {
    const participantById = new Map(participantRows.map((p) => [p.id, p]))
    const settlementById = new Map(settlementRows.map((s) => [s.id, s]))
    for (const it of itemRows) {
      const settlementN = settlementNodeId(it.settlement_id)
      if (!nodeIds.has(settlementN)) continue

      let targetN: string | null = null
      if (it.role_type === "store") {
        const settlement = settlementById.get(it.settlement_id)
        if (settlement) targetN = storeNodeId(settlement.store_uuid)
      } else {
        let membershipId: string | null = it.membership_id
        if (!membershipId && it.participant_id) {
          const par = participantById.get(it.participant_id) ?? null
          membershipId = par?.membership_id ?? null
        }
        if (membershipId) {
          if (it.role_type === "manager") targetN = personNodeId("manager", membershipId)
          else if (it.role_type === "hostess") targetN = personNodeId("hostess", membershipId)
          else targetN = personNodeId("staff", membershipId)
        }
      }

      if (!targetN || !nodeIds.has(targetN)) continue
      const amt = toNum(it.amount)
      pushEdge({
        id: `paid_to:${it.id}`,
        source: settlementN,
        target: targetN,
        type: "paid_to",
        weight: clamp01(0.1 + amt / 500_000),
        amount: amt,
        status: "normal",
      })
    }
  }

  // owes_to: store(debtor) → store(creditor). Schema migration 038
  // dropped the legacy `store_uuid`/`target_store_uuid` from the header
  // and renamed them to `from_store_uuid`/`to_store_uuid`. Direction
  // unchanged: `from` is the debtor (the store sending money) and `to`
  // is the creditor.
  if (wantStore) {
    for (const r of crossStoreRows) {
      const sourceN = storeNodeId(r.from_store_uuid)
      const targetN = storeNodeId(r.to_store_uuid)
      if (!nodeIds.has(sourceN) || !nodeIds.has(targetN)) continue
      const remaining = toNum(r.remaining_amount)
      const closed = CROSS_STORE_CLOSED_STATUSES.has(r.status)
      const status: NetworkStatus =
        !closed && remaining > 0 ? "warning" : "normal"
      pushEdge({
        id: `owes_to:${r.id}`,
        source: sourceN,
        target: targetN,
        type: "owes_to",
        weight: clamp01(0.2 + remaining / 1_000_000),
        amount: remaining,
        status,
        meta: {
          total_amount: toNum(r.total_amount),
          prepaid_amount: toNum(r.prepaid_amount),
          remaining_amount: remaining,
          status: r.status,
        },
      })
    }
  }

  // transferred: hostess → to_store. Direction matches transfer_requests
  // semantics (the hostess was transferred TO this store).
  if (wantHostess && wantStore) {
    for (const t of transferRows) {
      const hostessN = personNodeId("hostess", t.hostess_membership_id)
      const toN = storeNodeId(t.to_store_uuid)
      if (!nodeIds.has(hostessN) || !nodeIds.has(toN)) continue
      pushEdge({
        id: `transferred:${t.id}`,
        source: hostessN,
        target: toN,
        type: "transferred",
        weight: 0.5,
        status: "normal",
        started_at: t.created_at ?? undefined,
        meta: {
          from_store_uuid: t.from_store_uuid,
          to_store_uuid: t.to_store_uuid,
          business_day_id: t.business_day_id,
        },
      })
    }
  }

  // Reweight person nodes by activity (session participation count).
  // Static default (0.3) → activity-weighted, capped at 1.0. Stores and
  // session/settlement/payout nodes keep their previously assigned weights.
  {
    const sessionsByMembership = new Map<string, Set<string>>()
    for (const p of participantRows) {
      const set = sessionsByMembership.get(p.membership_id) ?? new Set<string>()
      set.add(p.session_id)
      sessionsByMembership.set(p.membership_id, set)
    }
    for (const n of nodes) {
      if (n.type !== "manager" && n.type !== "hostess" && n.type !== "staff") {
        continue
      }
      const membershipId = n.meta?.membership_id
      if (typeof membershipId !== "string") continue
      const count = sessionsByMembership.get(membershipId)?.size ?? 0
      if (count === 0) continue // keep static default for inactive
      n.weight = clamp01(0.3 + count / 5)
    }
  }

  // ── 7b. P2.1d: audit nodes ──────────────────────────────────────────
  //
  // Audit pulls a 90-day-hot window scoped by (a) store_uuid IN scope and
  // (b) created_at within the resolved business-date window (converted to
  // UTC). We group by (entity_table, entity_id) and emit one audit node
  // per group plus an attach edge to the nearest known graph node. When
  // the entity isn't in the visible graph, the audit node floats
  // (still emitted) and a single warning is added with the count.
  if (
    include_node_types.includes("audit") &&
    audit_categories.length > 0 &&
    storeIds.length > 0
  ) {
    // Build entity-resolution maps from data already fetched. These are
    // read-only context for buildAuditNodes — no extra DB calls.
    const settlementItemToSettlementId = new Map<string, string>()
    for (const it of itemRows) {
      settlementItemToSettlementId.set(it.id, it.settlement_id)
    }
    const participantToSessionId = new Map<string, string>()
    for (const p of participantRows) {
      participantToSessionId.set(p.id, p.session_id)
    }
    const membershipById = new Map<string, MembershipRow>()
    for (const m of memberships) {
      membershipById.set(m.id, m)
    }
    const crossStoreIdToStoreUuid = new Map<string, string>()
    for (const r of crossStoreRows) {
      // After 038 migration the debtor column is `from_store_uuid`.
      crossStoreIdToStoreUuid.set(r.id, r.from_store_uuid) // debtor side
    }
    const profileToMembership = new Map<string, string>()
    // First match wins — primary membership only is fine here since we
    // pre-filtered store_memberships on is_primary=true.
    for (const m of memberships) {
      if (!profileToMembership.has(m.profile_id)) {
        profileToMembership.set(m.profile_id, m.id)
      }
    }

    const auditResult = await buildAuditNodes({
      client,
      store_ids: storeIds,
      audit_categories,
      business_date_from,
      business_date_to,
      node_ids: nodeIds,
      settlement_item_to_settlement_id: settlementItemToSettlementId,
      participant_to_session_id: participantToSessionId,
      membership_by_id: membershipById,
      cross_store_id_to_store_uuid: crossStoreIdToStoreUuid,
      profile_to_membership: profileToMembership,
    })
    sourceTables.push(...auditResult.source_tables)
    warnings.push(...auditResult.warnings)
    for (const n of auditResult.nodes) pushNode(n)
    for (const e of auditResult.edges) pushEdge(e)
  }

  // ── 8. cap enforcement (centralized aggregator) ─────────────────────
  let truncated = false

  const nodeCapResult = capNodes(nodes, node_cap)
  if (nodeCapResult.dropped > 0) {
    truncated = true
    warnings.push({
      type: "cap_exceeded",
      note: `Node cap (${node_cap}) exceeded; dropped ${nodeCapResult.dropped} node(s).`,
      detail: {
        dropped: nodeCapResult.dropped,
        kept: nodeCapResult.kept.length,
        dropped_by_type: nodeCapResult.dropped_by_type,
      },
    })
  }
  const keptNodeIds = new Set(nodeCapResult.kept.map((n) => n.id))
  const edgeCapResult = capEdges(edges, keptNodeIds, edge_cap)
  if (edgeCapResult.dropped > 0) {
    truncated = true
    warnings.push({
      type: "cap_exceeded",
      note: `Edge cap (${edge_cap}) reached or orphan edges dropped (${edgeCapResult.dropped} total).`,
      detail: {
        dropped: edgeCapResult.dropped,
        kept: edgeCapResult.kept.length,
        dropped_by_type: edgeCapResult.dropped_by_type,
      },
    })
  }

  return {
    ok: true,
    nodes: nodeCapResult.kept,
    edges: edgeCapResult.kept,
    source_tables: Array.from(new Set(sourceTables)),
    warnings,
    truncated,
  }
}

// ─── id helpers ──────────────────────────────────────────────────────────

function storeNodeId(uuid: string): string {
  return `store:${uuid}`
}

function personNodeId(type: NetworkNodeType, membershipId: string): string {
  return `${type}:${membershipId}`
}

function sessionNodeId(uuid: string): string {
  return `session:${uuid}`
}

function settlementNodeId(uuid: string): string {
  return `settlement:${uuid}`
}

function edgeId(type: NetworkEdgeType, key: string): string {
  return `${type}:${key}`
}

function mapRoleToNodeType(role: string): NetworkNodeType | null {
  const hit = MEMBERSHIP_ROLES_OF_INTEREST.find((r) => r.role === role)
  return hit?.nodeType ?? null
}

// Compact KRW formatter for node labels (graph context — short string).
function formatWonShort(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0"
  const abs = Math.abs(n)
  const sign = n < 0 ? "-" : ""
  if (abs >= 100_000_000) return `${sign}${(abs / 100_000_000).toFixed(1)}억`
  if (abs >= 10_000_000) return `${sign}${(abs / 10_000_000).toFixed(1)}천만`
  if (abs >= 10_000) return `${sign}${Math.floor(abs / 10_000).toLocaleString()}만`
  return `${sign}${Math.round(abs).toLocaleString()}`
}

// ─── label helpers (PII default = mask; super_admin unmask = real) ───

function resolveHostessLabel(
  h: HostessRow | null,
  profile: ProfileRow | null,
  unmasked: boolean,
): string {
  // stage_name (예명) is non-PII performer alias — surface even when masked.
  const stage = h?.stage_name?.trim() || null
  if (unmasked) {
    return stage ?? h?.name ?? profile?.full_name ?? "(아가씨)"
  }
  if (stage) return stage
  return maskName(h?.name ?? profile?.nickname ?? profile?.full_name ?? "")
    || "(아가씨)"
}

function resolveManagerLabel(
  m: ManagerRow | null,
  profile: ProfileRow | null,
  unmasked: boolean,
): string {
  const nick = m?.nickname?.trim() || profile?.nickname?.trim() || null
  if (unmasked) {
    return nick ?? m?.name ?? profile?.full_name ?? "(실장)"
  }
  // nickname is operator-chosen handle; treat as non-PII label.
  if (nick) return nick
  return maskName(m?.name ?? profile?.full_name ?? "") || "(실장)"
}

function resolveStaffLabel(
  profile: ProfileRow | null,
  unmasked: boolean,
): string {
  const nick = profile?.nickname?.trim() || null
  if (unmasked) {
    return nick ?? profile?.full_name ?? "(스태프)"
  }
  if (nick) return nick
  return maskName(profile?.full_name ?? "") || "(스태프)"
}

// (Cap enforcement now lives in `lib/visualize/graph/aggregator.ts`.)
