/**
 * /api/super-admin/visualize/graph/node — type-specific fetchers.
 *
 * 2026-05-03: route.ts 분할.
 *   각 NetworkNodeType 별 fetch* 함수가 (client, id, resp) → resp 시그니처로
 *   동일. fetchPerson 만 (client, type, id, resp, unmask) 5-인자.
 *
 *   route.ts 의 GET dispatcher 가 type 에 맞춰 호출.
 *
 * 정책:
 *   - READ-ONLY. PII 마스킹 default.
 *   - 모든 실패는 resp.warnings 에 추가, throw X.
 */

import { maskName } from "@/lib/visualize/pii"
import { isUuid } from "@/lib/visualize/guards"
import type { ReadClient } from "@/lib/visualize/readClient"
import type { NetworkNodeType } from "@/lib/visualize/shapes"
import type { NodeDetailResponse } from "./route.types"

function toNum(v: unknown): number {
  if (v == null) return 0
  if (typeof v === "number") return Number.isFinite(v) ? v : 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// ─── store ────────────────────────────────────────────────────────────

export async function fetchStore(
  client: ReadClient,
  id: string,
  resp: NodeDetailResponse,
): Promise<NodeDetailResponse> {
  const { data, error } = await client
    .from("stores")
    .select("id, store_name, store_code, floor, is_active, created_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle()
  resp.source_tables.push("stores")
  if (error) {
    resp.warnings.push(`stores: ${error.message}`)
    return resp
  }
  if (!data) {
    resp.warnings.push("store not found")
    return resp
  }
  const s = data as {
    id: string
    store_name: string
    store_code: string | null
    floor: number | null
    is_active: boolean
    created_at: string | null
  }
  resp.store_uuid = s.id
  resp.label = s.store_name

  // Counts in parallel (each independently failable).
  const [roomsRes, membershipsRes, todayRes] = await Promise.all([
    client
      .from("rooms")
      .select("id", { count: "exact", head: true })
      .eq("store_uuid", id)
      .is("deleted_at", null),
    client
      .from("store_memberships")
      .select("role")
      .eq("store_uuid", id)
      .eq("status", "approved")
      .eq("is_primary", true)
      .is("deleted_at", null),
    client
      .from("store_operating_days")
      .select("id, business_date, status, opened_at, closed_at")
      .eq("store_uuid", id)
      .is("deleted_at", null)
      .order("business_date", { ascending: false })
      .limit(1),
  ])
  resp.source_tables.push("rooms", "store_memberships", "store_operating_days")

  let roomCount = 0
  if (roomsRes.error) resp.warnings.push(`rooms: ${roomsRes.error.message}`)
  else roomCount = (roomsRes as { count?: number }).count ?? 0

  type MembRow = { role: string }
  const membByRole: Record<string, number> = {}
  if (membershipsRes.error) resp.warnings.push(`store_memberships: ${membershipsRes.error.message}`)
  else {
    for (const m of (membershipsRes.data ?? []) as MembRow[]) {
      membByRole[m.role] = (membByRole[m.role] ?? 0) + 1
    }
  }

  type DayRow = { id: string; business_date: string; status: string; opened_at: string | null; closed_at: string | null }
  let latestDay: DayRow | null = null
  if (todayRes.error) resp.warnings.push(`store_operating_days: ${todayRes.error.message}`)
  else {
    const arr = (todayRes.data ?? []) as DayRow[]
    if (arr.length > 0) latestDay = arr[0]
  }

  resp.primary = {
    store_name: s.store_name,
    store_code: s.store_code,
    floor: s.floor,
    is_active: s.is_active,
    created_at: s.created_at,
  }
  resp.relations = {
    room_count: roomCount,
    membership_count_by_role: membByRole,
    latest_business_day: latestDay,
  }
  return resp
}

// ─── session ──────────────────────────────────────────────────────────

export async function fetchSession(
  client: ReadClient,
  id: string,
  resp: NodeDetailResponse,
): Promise<NodeDetailResponse> {
  const { data, error } = await client
    .from("room_sessions")
    .select(
      "id, store_uuid, room_uuid, business_day_id, status, started_at, ended_at, opened_by, closed_by",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle()
  resp.source_tables.push("room_sessions")
  if (error) {
    resp.warnings.push(`room_sessions: ${error.message}`)
    return resp
  }
  if (!data) {
    resp.warnings.push("session not found")
    return resp
  }
  const s = data as {
    id: string
    store_uuid: string
    room_uuid: string | null
    business_day_id: string
    status: string
    started_at: string | null
    ended_at: string | null
  }
  resp.store_uuid = s.store_uuid

  const [roomRes, participantsRes, settlementRes, receiptRes, dayRes] = await Promise.all([
    s.room_uuid
      ? client.from("rooms").select("room_no").eq("id", s.room_uuid).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    client
      .from("session_participants")
      .select("id, role")
      .eq("session_id", id)
      .is("deleted_at", null),
    client
      .from("settlements")
      .select("id, status, total_amount")
      .eq("session_id", id)
      .is("deleted_at", null)
      .maybeSingle(),
    client
      .from("receipts")
      .select("id, version, status, gross_total")
      .eq("session_id", id)
      .order("version", { ascending: false })
      .limit(1),
    client
      .from("store_operating_days")
      .select("business_date, status")
      .eq("id", s.business_day_id)
      .maybeSingle(),
  ])
  if (s.room_uuid) resp.source_tables.push("rooms")
  resp.source_tables.push("session_participants", "settlements", "receipts", "store_operating_days")

  type RoomR = { room_no: string | null } | null
  const roomNo = (roomRes.data as RoomR)?.room_no ?? null
  if (roomRes.error) resp.warnings.push(`rooms: ${roomRes.error.message}`)

  type PartRow = { id: string; role: string }
  const partByRole: Record<string, number> = {}
  if (participantsRes.error) resp.warnings.push(`session_participants: ${participantsRes.error.message}`)
  else for (const p of (participantsRes.data ?? []) as PartRow[]) {
    partByRole[p.role] = (partByRole[p.role] ?? 0) + 1
  }

  type SettlementR = { id: string; status: string; total_amount: unknown } | null
  const sett = settlementRes.data as SettlementR
  if (settlementRes.error) resp.warnings.push(`settlements: ${settlementRes.error.message}`)

  type ReceiptR = { id: string; version: number; status: string; gross_total: unknown }
  const receiptArr = ((receiptRes.data ?? []) as unknown) as ReceiptR[]
  const latestReceipt = receiptArr[0] ?? null
  if (receiptRes.error) resp.warnings.push(`receipts: ${receiptRes.error.message}`)

  type DayR = { business_date: string; status: string } | null
  const day = dayRes.data as DayR
  if (dayRes.error) resp.warnings.push(`store_operating_days: ${dayRes.error.message}`)

  resp.label = roomNo ? `${roomNo}호` : "(룸)"
  resp.primary = {
    room_no: roomNo,
    business_date: day?.business_date ?? null,
    business_day_status: day?.status ?? null,
    started_at: s.started_at,
    ended_at: s.ended_at,
    status: s.status,
  }
  resp.relations = {
    participant_count: Object.values(partByRole).reduce((a, b) => a + b, 0),
    participant_count_by_role: partByRole,
    settlement: sett ? { id: sett.id, status: sett.status, total_amount: toNum(sett.total_amount) } : null,
    latest_receipt: latestReceipt
      ? { id: latestReceipt.id, version: latestReceipt.version, status: latestReceipt.status, gross_total: toNum(latestReceipt.gross_total) }
      : null,
  }
  return resp
}

// ─── settlement ───────────────────────────────────────────────────────

export async function fetchSettlement(
  client: ReadClient,
  id: string,
  resp: NodeDetailResponse,
): Promise<NodeDetailResponse> {
  const { data, error } = await client
    .from("settlements")
    .select(
      "id, store_uuid, session_id, status, total_amount, manager_amount, hostess_amount, store_amount, confirmed_at, created_at",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle()
  resp.source_tables.push("settlements")
  if (error) {
    resp.warnings.push(`settlements: ${error.message}`)
    return resp
  }
  if (!data) {
    resp.warnings.push("settlement not found")
    return resp
  }
  const s = data as {
    id: string
    store_uuid: string
    session_id: string
    status: string
    total_amount: unknown
    manager_amount: unknown
    hostess_amount: unknown
    store_amount: unknown
    confirmed_at: string | null
    created_at: string | null
  }
  resp.store_uuid = s.store_uuid

  const [itemsRes, payoutsRes] = await Promise.all([
    client
      .from("settlement_items")
      .select("role_type, amount")
      .eq("settlement_id", id)
      .is("deleted_at", null),
    client
      .from("payout_records")
      .select("status, amount")
      .eq("settlement_id", id)
      .is("deleted_at", null),
  ])
  resp.source_tables.push("settlement_items", "payout_records")

  type ItemRow = { role_type: string; amount: unknown }
  const itemsByRole: Record<string, { count: number; sum: number }> = {}
  if (itemsRes.error) resp.warnings.push(`settlement_items: ${itemsRes.error.message}`)
  else for (const it of (itemsRes.data ?? []) as ItemRow[]) {
    const key = it.role_type
    const cur = itemsByRole[key] ?? { count: 0, sum: 0 }
    cur.count += 1
    cur.sum += toNum(it.amount)
    itemsByRole[key] = cur
  }

  type PayoutRow = { status: string; amount: unknown }
  const payoutsByStatus: Record<string, { count: number; sum: number }> = {}
  if (payoutsRes.error) resp.warnings.push(`payout_records: ${payoutsRes.error.message}`)
  else for (const p of (payoutsRes.data ?? []) as PayoutRow[]) {
    const key = p.status
    const cur = payoutsByStatus[key] ?? { count: 0, sum: 0 }
    cur.count += 1
    cur.sum += toNum(p.amount)
    payoutsByStatus[key] = cur
  }

  resp.label = `정산 ${s.status}`
  resp.primary = {
    status: s.status,
    total_amount: toNum(s.total_amount),
    manager_amount: toNum(s.manager_amount),
    hostess_amount: toNum(s.hostess_amount),
    store_amount: toNum(s.store_amount),
    confirmed_at: s.confirmed_at,
    created_at: s.created_at,
  }
  resp.relations = {
    session_id: s.session_id,
    items_by_role: itemsByRole,
    payouts_by_status: payoutsByStatus,
  }
  return resp
}

// ─── manager / hostess / staff (membership-derived) ───────────────────

export async function fetchPerson(
  client: ReadClient,
  type: NetworkNodeType,
  membershipId: string,
  resp: NodeDetailResponse,
  unmask: boolean,
): Promise<NodeDetailResponse> {
  const { data, error } = await client
    .from("store_memberships")
    .select("id, profile_id, store_uuid, role, status, is_primary, created_at")
    .eq("id", membershipId)
    .is("deleted_at", null)
    .maybeSingle()
  resp.source_tables.push("store_memberships")
  if (error) {
    resp.warnings.push(`store_memberships: ${error.message}`)
    return resp
  }
  if (!data) {
    resp.warnings.push("membership not found")
    return resp
  }
  const m = data as {
    id: string
    profile_id: string
    store_uuid: string
    role: string
    status: string
    is_primary: boolean
    created_at: string | null
  }
  resp.store_uuid = m.store_uuid

  // Verify role matches the requested node type — refuse cross-type drill.
  const expectedRole = type === "manager" ? "manager" : type === "hostess" ? "hostess" : null
  if (expectedRole && m.role !== expectedRole) {
    resp.warnings.push(`membership role '${m.role}' does not match node type '${type}'`)
    return resp
  }
  if (type === "staff" && m.role !== "waiter" && m.role !== "staff") {
    resp.warnings.push(`membership role '${m.role}' does not match node type 'staff'`)
    return resp
  }

  // Auxiliary fetches in parallel.
  const [profileRes, hostessRes, managerRes, storeRes, managedHostessesRes] =
    await Promise.all([
      client
        .from("profiles")
        .select("id, full_name, nickname, created_at")
        .eq("id", m.profile_id)
        .is("deleted_at", null)
        .maybeSingle(),
      type === "hostess"
        ? client
            .from("hostesses")
            .select(
              "id, stage_name, name, category, manager_membership_id, is_active, created_at",
            )
            .eq("membership_id", m.id)
            .is("deleted_at", null)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      type === "manager"
        ? client
            .from("managers")
            .select("id, nickname, name, is_active, created_at")
            .eq("membership_id", m.id)
            .is("deleted_at", null)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      client
        .from("stores")
        .select("id, store_name, floor")
        .eq("id", m.store_uuid)
        .is("deleted_at", null)
        .maybeSingle(),
      type === "manager"
        ? client
            .from("hostesses")
            .select("id", { count: "exact", head: true })
            .eq("manager_membership_id", m.id)
            .is("deleted_at", null)
            .eq("is_active", true)
        : Promise.resolve({ count: 0, error: null }),
    ])

  resp.source_tables.push("profiles")
  if (type === "hostess") resp.source_tables.push("hostesses")
  if (type === "manager") resp.source_tables.push("managers", "hostesses")
  resp.source_tables.push("stores")

  type ProfileR = { id: string; full_name: string | null; nickname: string | null; created_at: string | null } | null
  type HostessR = { id: string; stage_name: string | null; name: string | null; category: string | null; manager_membership_id: string | null; is_active: boolean; created_at: string | null } | null
  type ManagerR = { id: string; nickname: string | null; name: string | null; is_active: boolean; created_at: string | null } | null
  type StoreR = { id: string; store_name: string; floor: number | null } | null

  const profile = profileRes.data as ProfileR
  if (profileRes.error) resp.warnings.push(`profiles: ${profileRes.error.message}`)

  const hostess = hostessRes.data as HostessR
  if (hostessRes.error) resp.warnings.push(`hostesses: ${hostessRes.error.message}`)

  const manager = managerRes.data as ManagerR
  if (managerRes.error) resp.warnings.push(`managers: ${managerRes.error.message}`)

  const store = storeRes.data as StoreR
  if (storeRes.error) resp.warnings.push(`stores: ${storeRes.error.message}`)

  let managedCount = 0
  if (managedHostessesRes.error) {
    resp.warnings.push(`hostesses (managed): ${managedHostessesRes.error.message}`)
  } else {
    managedCount = (managedHostessesRes as { count?: number }).count ?? 0
  }

  // Label resolution mirrors network.ts. unmask=true bypasses maskName
  // and surfaces the real `name` / `full_name`. PII access is recorded
  // in audit_events via `unmasked: true` (set by the route below).
  let label = ""
  if (type === "hostess") {
    if (unmask) {
      label = hostess?.stage_name?.trim() || hostess?.name || profile?.full_name || "(아가씨)"
    } else {
      label = hostess?.stage_name?.trim() || maskName(hostess?.name ?? profile?.full_name ?? "") || "(아가씨)"
    }
  } else if (type === "manager") {
    if (unmask) {
      label = manager?.nickname?.trim() || profile?.nickname?.trim() || manager?.name || profile?.full_name || "(실장)"
    } else {
      label = manager?.nickname?.trim() || profile?.nickname?.trim() || maskName(manager?.name ?? profile?.full_name ?? "") || "(실장)"
    }
  } else {
    if (unmask) {
      label = profile?.nickname?.trim() || profile?.full_name || "(스태프)"
    } else {
      label = profile?.nickname?.trim() || maskName(profile?.full_name ?? "") || "(스태프)"
    }
  }
  resp.label = label

  resp.primary = {
    role: m.role,
    membership_status: m.status,
    is_primary: m.is_primary,
    membership_created_at: m.created_at,
    profile_created_at: profile?.created_at ?? null,
    // Auxiliary directory fields (stage_name / nickname / category) —
    // safe to surface, they are not PII.
    stage_name: hostess?.stage_name ?? null,
    category: hostess?.category ?? null,
    manager_nickname: manager?.nickname ?? null,
    // Real names — only when unmask=true (super_admin gated, audit recorded).
    name: unmask ? hostess?.name ?? manager?.name ?? profile?.full_name ?? null : undefined,
    full_name: unmask ? profile?.full_name ?? null : undefined,
  }
  resp.relations = {
    store: store ? { id: store.id, store_name: store.store_name, floor: store.floor } : null,
    manager_membership_id: hostess?.manager_membership_id ?? null,
    managed_hostess_count: type === "manager" ? managedCount : null,
  }
  return resp
}

// ─── payout aggregate (P2.1h) ─────────────────────────────────────────
//
// Composite key shapes (mirrors `lib/visualize/query/network.ts:692`):
//   "<settlement_item_uuid>|<status>"
//   "_no_item_<settlement_uuid>|<status>"
// We parse, validate the UUID slice(s), and aggregate the matching
// payout_records rows. The `id` parameter arrives URL-decoded by Next.js.

export async function fetchPayoutAggregate(
  client: ReadClient,
  id: string,
  resp: NodeDetailResponse,
): Promise<NodeDetailResponse> {
  const pipeIdx = id.lastIndexOf("|")
  if (pipeIdx < 0) {
    resp.warnings.push("payout id missing '|' separator")
    return resp
  }
  const left = id.slice(0, pipeIdx)
  const status = id.slice(pipeIdx + 1)
  if (!status) {
    resp.warnings.push("payout id missing status component")
    return resp
  }

  let settlementItemId: string | null = null
  let settlementId: string | null = null
  if (left.startsWith("_no_item_")) {
    settlementId = left.slice("_no_item_".length)
    if (!isUuid(settlementId)) {
      resp.warnings.push("payout settlement_id slice is not a UUID")
      return resp
    }
  } else {
    if (!isUuid(left)) {
      resp.warnings.push("payout settlement_item_id slice is not a UUID")
      return resp
    }
    settlementItemId = left
  }

  // Fetch the matching payout_records (status + scope by id slice).
  let q = client
    .from("payout_records")
    .select("id, settlement_id, settlement_item_id, status, amount, paid_at, target_store_uuid")
    .eq("status", status)
    .is("deleted_at", null)
  if (settlementItemId) q = q.eq("settlement_item_id", settlementItemId)
  if (settlementId) {
    q = q.eq("settlement_id", settlementId).is("settlement_item_id", null)
  }
  const { data: payRows, error: payErr } = await q
  resp.source_tables.push("payout_records")
  if (payErr) {
    resp.warnings.push(`payout_records: ${payErr.message}`)
    return resp
  }

  type PR = {
    id: string
    settlement_id: string | null
    settlement_item_id: string | null
    status: string
    amount: unknown
    paid_at: string | null
    target_store_uuid: string | null
  }
  const rows = ((payRows ?? []) as unknown) as PR[]
  let total = 0
  let latestAt: string | null = null
  const targets = new Set<string>()
  for (const r of rows) {
    total += toNum(r.amount)
    if (r.paid_at && (!latestAt || r.paid_at > latestAt)) latestAt = r.paid_at
    if (r.target_store_uuid) targets.add(r.target_store_uuid)
  }

  // Resolve parent settlement (and item, if any) for relations context.
  const parentSettlementId = settlementId ?? rows[0]?.settlement_id ?? null
  const [settlementRes, itemRes] = await Promise.all([
    parentSettlementId
      ? client
          .from("settlements")
          .select("id, store_uuid, session_id, status, total_amount")
          .eq("id", parentSettlementId)
          .is("deleted_at", null)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    settlementItemId
      ? client
          .from("settlement_items")
          .select("id, settlement_id, role_type, amount, membership_id, participant_id")
          .eq("id", settlementItemId)
          .is("deleted_at", null)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (parentSettlementId) resp.source_tables.push("settlements")
  if (settlementItemId) resp.source_tables.push("settlement_items")

  type SettR = { id: string; store_uuid: string; session_id: string; status: string; total_amount: unknown } | null
  type ItemR = { id: string; settlement_id: string; role_type: string; amount: unknown; membership_id: string | null; participant_id: string | null } | null
  const settlement = settlementRes.data as SettR
  if (settlementRes.error) resp.warnings.push(`settlements: ${settlementRes.error.message}`)
  const item = itemRes.data as ItemR
  if (itemRes.error) resp.warnings.push(`settlement_items: ${itemRes.error.message}`)

  resp.store_uuid = settlement?.store_uuid ?? null
  resp.label = `${status} ${rows.length}건`
  resp.primary = {
    status,
    record_count: rows.length,
    total_amount: total,
    latest_paid_at: latestAt,
    settlement_id: parentSettlementId,
    settlement_item_id: settlementItemId,
    target_store_count: targets.size,
  }
  resp.relations = {
    settlement: settlement
      ? {
          id: settlement.id,
          status: settlement.status,
          total_amount: toNum(settlement.total_amount),
          session_id: settlement.session_id,
        }
      : null,
    settlement_item: item
      ? {
          id: item.id,
          role_type: item.role_type,
          amount: toNum(item.amount),
          membership_id: item.membership_id,
          participant_id: item.participant_id,
        }
      : null,
    target_store_uuids: Array.from(targets).slice(0, 5),
  }
  return resp
}

// ─── audit aggregate (P2.1h) ──────────────────────────────────────────
//
// Composite key shape (mirrors `lib/visualize/query/auditNodes.ts:225`):
//   "<entity_table>:<entity_id>"
// `entity_id` is a UUID; entity_table is a known DB table name. We fetch
// the matching audit_events rows (within the 90-day hot retention) and
// aggregate by action verb. Actor names are NOT exposed (PII default).

const KNOWN_AUDIT_ENTITY_TABLES: ReadonlySet<string> = new Set([
  "settlements",
  "settlement_items",
  "payout_records",
  "cross_store_settlements",
  "cross_store_settlement_items",
  "store_memberships",
  "profiles",
  "store_operating_days",
  "credits",
  "manager_financial_permissions",
  "paper_ledger_snapshots",
  "paper_ledger_access_grants",
  "paper_ledger_edits",
  "room_sessions",
  "session_participants",
  "stores",
  "rooms",
  "managers",
  "hostesses",
  "manager_prepayments",
])

export async function fetchAuditAggregate(
  client: ReadClient,
  id: string,
  resp: NodeDetailResponse,
): Promise<NodeDetailResponse> {
  const colon = id.indexOf(":")
  if (colon < 0) {
    resp.warnings.push("audit id missing ':' separator")
    return resp
  }
  const entityTable = id.slice(0, colon)
  const entityId = id.slice(colon + 1)
  if (!isUuid(entityId)) {
    resp.warnings.push("audit entity_id slice is not a UUID")
    return resp
  }
  if (!KNOWN_AUDIT_ENTITY_TABLES.has(entityTable)) {
    // Unknown entity_table — query anyway (DB column is plain TEXT) but
    // surface a warning so we notice drift.
    resp.warnings.push(`unknown entity_table '${entityTable}' (no schema hint)`)
  }

  // 90-day hot ceiling, mirrors auditNodes.ts.
  const ninetyDaysAgoUtc = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await client
    .from("audit_events")
    .select(
      "id, store_uuid, entity_table, entity_id, action, actor_role, created_at",
    )
    .eq("entity_table", entityTable)
    .eq("entity_id", entityId)
    .gte("created_at", ninetyDaysAgoUtc)
    .order("created_at", { ascending: false })
    .limit(500)
  resp.source_tables.push("audit_events")
  if (error) {
    resp.warnings.push(`audit_events: ${error.message}`)
    return resp
  }

  type AE = {
    id: string
    store_uuid: string
    entity_table: string
    entity_id: string
    action: string
    actor_role: string | null
    created_at: string
  }
  const rows = ((data ?? []) as unknown) as AE[]
  if (rows.length === 0) {
    resp.label = `audit ${entityTable}`
    resp.primary = { entity_table: entityTable, entity_id: entityId, count: 0 }
    return resp
  }

  resp.store_uuid = rows[0].store_uuid

  const actionCounts = new Map<string, number>()
  const actorRoles = new Map<string, number>()
  for (const r of rows) {
    actionCounts.set(r.action, (actionCounts.get(r.action) ?? 0) + 1)
    if (r.actor_role) {
      actorRoles.set(r.actor_role, (actorRoles.get(r.actor_role) ?? 0) + 1)
    }
  }
  const topActions = Array.from(actionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  // Recent 5 events as a compact event-log preview (no PII fields exposed).
  const recent = rows.slice(0, 5).map((r) => ({
    action: r.action,
    actor_role: r.actor_role,
    created_at: r.created_at,
  }))

  resp.label = `audit ${entityTable} (${rows.length})`
  resp.primary = {
    entity_table: entityTable,
    entity_id: entityId,
    count: rows.length,
    latest_at: rows[0].created_at,
    earliest_at: rows[rows.length - 1].created_at,
    distinct_actions: actionCounts.size,
  }
  resp.relations = {
    actions_top10: topActions,
    actor_roles: Object.fromEntries(actorRoles),
    recent_events: recent,
    truncated: rows.length === 500,
  }
  return resp
}

