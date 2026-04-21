/**
 * mergeSnapshots — pure in-memory assembly of multi-store monitor data.
 *
 * NO HTTP CALLS ALLOWED.
 *     This module must never import or call any network client
 *     (global HTTP APIs, client wrappers, 3rd-party libs). The CI grep
 *     defined in the design doc reads this file and must return zero
 *     matching lines for the forbidden identifiers.
 *
 * Input: raw rows from the 9 queries Q1-Q9 executed by
 *   /api/monitor/scope/route.ts.
 *
 * Output: ScopedMonitorResponse shape — a multi-store rollup with:
 *   - stores[]: per-store rooms + summary + simplified BLE presence
 *   - home_workers[]: only populated when caller's store is in scope
 *     (mine or current_floor or matching floor); merged with Q9 for
 *     cross-store "away" status.
 *   - foreign_workers_at_mine[]: foreign participants actively in the
 *     caller's store (only meaningful when mine-like).
 *   - movement[]: audit events across the scoped stores.
 *
 * Extended participant fields (operator_status, latest_apply_*,
 * recommendations) are filled with safe defaults ("normal", null, [])
 * for Phase 3 MVP — MonitorPanel / Ops continues to use the existing
 * /api/counter/monitor for the rich view. This module's consumer
 * (CounterBleMinimapWidget and future mobile widget) only reads the
 * basic fields (status/zone/counts).
 */

import type {
  MonitorRoom,
  MonitorRoomParticipant,
  MonitorSummary,
  MonitorBlePresence,
  MonitorHomeWorker,
  MonitorForeignWorker,
  MonitorMovementEvent,
  MonitorMode,
  MonitorBleZone,
  HomeWorkerZone,
  ParticipantZone,
} from "@/app/counter/monitor/types"

// ────────────────────────────────────────────────────────────────
// Raw row types (must match select columns in route.ts)
// ────────────────────────────────────────────────────────────────

export type StoreRow = {
  id: string
  store_name: string
  floor: number | null
}

export type RoomRow = {
  id: string
  store_uuid: string
  room_no: string
  room_name: string | null
  floor_no: number | null
  sort_order: number
}

export type SessionRow = {
  id: string
  store_uuid: string
  room_uuid: string
  started_at: string
}

export type ParticipantRow = {
  id: string
  session_id: string
  membership_id: string | null
  status: string
  role: string
  category: string | null
  entered_at: string
  time_minutes: number | null
  // Denorm fields from JOIN
  _room_uuid: string
  _store_uuid: string
}

export type MembershipRow = {
  id: string
  profile_id: string | null
  store_uuid: string
  nickname: string | null
  full_name: string | null
  origin_store_name: string | null
}

export type BlePresenceRow = {
  store_uuid: string
  minor: number
  membership_id: string | null
  room_uuid: string | null
  last_event_type: string | null
  last_seen_at: string
}

export type CorrectionRow = {
  store_uuid: string
  membership_id: string
  corrected_zone: string
  corrected_room_uuid: string | null
  corrected_at: string
  corrected_by_membership_id: string | null
}

export type MovementRow = {
  at: string
  kind: string
  actor_role: string | null
  entity_table: string | null
  entity_id: string | null
  room_uuid: string | null
  session_id: string | null
  store_uuid: string
}

export type CswrRow = {
  hostess_membership_id: string
  working_store_uuid: string
  working_store_name: string
  working_floor: number | null
  session_id: string
  session_room_uuid: string | null
  session_room_name: string | null
  session_room_floor: number | null
  entered_at: string | null
  category: string | null
  time_minutes: number | null
}

export type MergeInput = {
  scope: string
  mode: MonitorMode
  callerStoreUuid: string
  callerStoreName: string
  Q1_stores: StoreRow[]
  Q2_rooms: RoomRow[]
  Q3_sessions: SessionRow[]
  Q4_participants: ParticipantRow[]
  Q5_memberships: MembershipRow[]
  Q6_ble_presence: BlePresenceRow[]
  Q7_corrections: CorrectionRow[]
  Q8_movement: MovementRow[]
  /** Only populated when scope includes the caller's store (mine-like). */
  Q9_cswr: CswrRow[]
}

export type ScopedStore = {
  store_uuid: string
  store_name: string
  floor_no: number | null
  summary: MonitorSummary
  rooms: MonitorRoom[]
  ble: {
    confidence: "manual" | "ble" | "hybrid"
    presence: MonitorBlePresence[]
  }
}

export type ScopedMonitorResponse = {
  scope: string
  generated_at: string
  mode: MonitorMode
  stores: ScopedStore[]
  home_workers: MonitorHomeWorker[]
  foreign_workers_at_mine: MonitorForeignWorker[]
  movement: MonitorMovementEvent[]
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function participantZone(status: string, rawRoomUuid: string | null): ParticipantZone {
  if (status === "mid_out") return "mid_out"
  if (status === "active" && rawRoomUuid) return "room"
  return "unknown"
}

function mapBleZone(roomUuid: string | null): MonitorBleZone {
  // Phase 3 MVP: simplified zone derivation. Full gateway_type-based
  // mapping stays in /api/counter/monitor for the Ops view.
  return roomUuid ? "room" : "unknown"
}

function pickLatestOverlayPerMembership(
  corrections: CorrectionRow[],
): Map<string, CorrectionRow> {
  const out = new Map<string, CorrectionRow>()
  // corrections arrive ORDER BY corrected_at DESC — first wins.
  for (const c of corrections) {
    if (!out.has(c.membership_id)) out.set(c.membership_id, c)
  }
  return out
}

function defaultParticipant(
  p: ParticipantRow,
  displayName: string,
  isForeign: boolean,
  originStoreName: string | null,
  originStoreUuid: string | null,
): MonitorRoomParticipant {
  return {
    id: p.id,
    role: p.role,
    category: p.category,
    status: p.status,
    zone: participantZone(p.status, p._room_uuid),
    membership_id: p.membership_id,
    display_name: displayName,
    is_foreign: isForeign,
    origin_store_uuid: originStoreUuid,
    origin_store_name: originStoreName,
    time_minutes: p.time_minutes ?? 0,
    entered_at: p.entered_at,
    // Safe defaults for extended fields — see module header.
    operator_status: "normal",
    extension_count: 0,
    latest_action_id: null,
    last_applied_action_id: null,
    latest_apply_status: null,
    latest_apply_attempt_count: null,
    latest_apply_last_attempted_at: null,
    latest_apply_failure_code: null,
    latest_apply_failure_message: null,
    recommendations: [],
  }
}

// ────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────

export function mergeSnapshots(input: MergeInput): ScopedMonitorResponse {
  const {
    scope, mode,
    callerStoreUuid, callerStoreName,
    Q1_stores, Q2_rooms, Q3_sessions, Q4_participants, Q5_memberships,
    Q6_ble_presence, Q7_corrections, Q8_movement, Q9_cswr,
  } = input

  const storeById = new Map<string, StoreRow>()
  for (const s of Q1_stores) storeById.set(s.id, s)

  const membershipById = new Map<string, MembershipRow>()
  for (const m of Q5_memberships) membershipById.set(m.id, m)

  // ── Rooms grouped by store ─────────────────────────────────────
  const roomsByStore = new Map<string, RoomRow[]>()
  for (const r of Q2_rooms) {
    const arr = roomsByStore.get(r.store_uuid) ?? []
    arr.push(r)
    roomsByStore.set(r.store_uuid, arr)
  }
  // Sort within each store by sort_order.
  for (const arr of roomsByStore.values()) {
    arr.sort((a, b) => a.sort_order - b.sort_order)
  }

  // ── Active session indexing ────────────────────────────────────
  const sessionById = new Map<string, SessionRow>()
  for (const s of Q3_sessions) sessionById.set(s.id, s)

  // ── Participants grouped by room (active+mid_out only) ─────────
  const participantsByRoom = new Map<string, ParticipantRow[]>()
  for (const p of Q4_participants) {
    const arr = participantsByRoom.get(p._room_uuid) ?? []
    arr.push(p)
    participantsByRoom.set(p._room_uuid, arr)
  }

  // ── BLE presence indexing ──────────────────────────────────────
  const blePresenceByStore = new Map<string, BlePresenceRow[]>()
  for (const b of Q6_ble_presence) {
    const arr = blePresenceByStore.get(b.store_uuid) ?? []
    arr.push(b)
    blePresenceByStore.set(b.store_uuid, arr)
  }

  // ── Correction overlay — latest per membership ─────────────────
  const overlayByMembership = pickLatestOverlayPerMembership(Q7_corrections)

  // ── Build per-store stores[] output ───────────────────────────
  const stores: ScopedStore[] = []
  for (const [storeUuid, storeRow] of storeById) {
    const storeRooms = roomsByStore.get(storeUuid) ?? []
    const rooms: MonitorRoom[] = []
    let presentCount = 0
    let midOutCount = 0

    for (const r of storeRooms) {
      const roomParts = participantsByRoom.get(r.id) ?? []
      const session = (() => {
        const active = Q3_sessions.find(s => s.room_uuid === r.id && s.store_uuid === storeUuid)
        return active ?? null
      })()

      const participants: MonitorRoomParticipant[] = roomParts.map(p => {
        const mem = p.membership_id ? membershipById.get(p.membership_id) : null
        const isForeign = !!mem && mem.store_uuid !== storeUuid
        const displayName =
          (mem?.nickname?.trim() || mem?.full_name?.trim() || "알 수 없음")
        return defaultParticipant(
          p,
          displayName,
          isForeign,
          isForeign ? (mem?.origin_store_name ?? null) : null,
          isForeign ? (mem?.store_uuid ?? null) : null,
        )
      })

      for (const p of participants) {
        if (p.status === "active" && p.zone === "room") presentCount++
        if (p.status === "mid_out" || p.zone === "mid_out") midOutCount++
      }

      rooms.push({
        room_uuid: r.id,
        room_no: r.room_no,
        room_name: r.room_name ?? r.room_no,
        floor_no: r.floor_no,
        sort_order: r.sort_order,
        status: session ? "active" : "empty",
        session: session
          ? {
              id: session.id,
              started_at: session.started_at,
              manager_name: null,
              customer_name_snapshot: null,
              customer_party_size: null,
            }
          : null,
        participants,
      })
    }

    // BLE presence for this store, with correction overlay applied.
    const blePresence: MonitorBlePresence[] = []
    for (const b of blePresenceByStore.get(storeUuid) ?? []) {
      if (!b.membership_id) continue
      const mem = membershipById.get(b.membership_id)
      const displayName =
        (mem?.nickname?.trim() || mem?.full_name?.trim() || "알 수 없음")
      if (!mem) continue

      const overlay = overlayByMembership.get(b.membership_id)
      const zone: MonitorBleZone = overlay
        ? ((["room", "counter", "restroom", "elevator", "external_floor", "lounge", "unknown"] as MonitorBleZone[])
            .includes(overlay.corrected_zone as MonitorBleZone)
            ? (overlay.corrected_zone as MonitorBleZone)
            : "unknown")
        : mapBleZone(b.room_uuid)

      blePresence.push({
        membership_id: b.membership_id,
        display_name: displayName,
        zone,
        room_uuid: overlay ? overlay.corrected_room_uuid : b.room_uuid,
        last_seen_at: b.last_seen_at,
        last_event_type: b.last_event_type,
        source: overlay ? "corrected" : "ble",
        corrected_by_membership_id: overlay?.corrected_by_membership_id ?? null,
        corrected_at: overlay?.corrected_at ?? null,
        // Phase 3 MVP: static defaults. Full confidence moves in Phase 5.
        confidence_level: "medium",
        confidence_score: 0.5,
        confidence_reasons: [],
      })
    }

    const summary: MonitorSummary = {
      present: presentCount,
      mid_out: midOutCount,
      restroom: blePresence.filter(p => p.zone === "restroom").length,
      external_floor: blePresence.filter(p => p.zone === "external_floor").length,
      waiting: 0, // Fully computed only for caller's store below.
    }

    stores.push({
      store_uuid: storeUuid,
      store_name: storeRow.store_name,
      floor_no: storeRow.floor,
      summary,
      rooms,
      ble: {
        confidence: "manual",
        presence: blePresence,
      },
    })
  }

  // ── home_workers (caller's store only) ─────────────────────────
  // Built from Q5 memberships whose store_uuid === callerStoreUuid
  // AND role='hostess'. Merged with Q9 to inject "away" state.
  const cswrByMembership = new Map<string, CswrRow>()
  for (const c of Q9_cswr) cswrByMembership.set(c.hostess_membership_id, c)

  const homeCallerParticipants = Q4_participants.filter(p => {
    if (!p.membership_id) return false
    const m = membershipById.get(p.membership_id)
    return m?.store_uuid === callerStoreUuid
  })
  const workingCallerMembers = new Set<string>()
  for (const p of homeCallerParticipants) {
    if (p.membership_id) workingCallerMembers.add(p.membership_id)
  }

  const home_workers: MonitorHomeWorker[] = []
  for (const m of Q5_memberships) {
    if (m.store_uuid !== callerStoreUuid) continue
    // We don't filter by role here — the Q5 SELECT already restricts
    // to approved memberships visible in scope. Display-side filtering
    // is fine for Phase 3.
    const working = workingCallerMembers.has(m.id)
    const cswr = cswrByMembership.get(m.id) ?? null
    let zone: HomeWorkerZone = "waiting"
    let current_room_uuid: string | null = null
    let current_room_name: string | null = null
    let current_floor: number | null = null
    let current_store_name: string | null = null
    let working_store_uuid: string | null = null
    let category: string | null = null
    let time_minutes = 0
    let entered_at: string | null = null

    if (working) {
      zone = "room"
      const part = homeCallerParticipants.find(p => p.membership_id === m.id)
      const sess = part ? sessionById.get(part.session_id) : null
      current_room_uuid = sess?.room_uuid ?? null
      const r = current_room_uuid
        ? (roomsByStore.get(callerStoreUuid) ?? []).find(x => x.id === current_room_uuid)
        : null
      current_room_name = r?.room_name ?? null
      current_floor = r?.floor_no ?? null
      current_store_name = callerStoreName
      category = part?.category ?? null
      time_minutes = part?.time_minutes ?? 0
      entered_at = part?.entered_at ?? null
    } else if (cswr) {
      zone = "away"
      working_store_uuid = cswr.working_store_uuid
      current_room_uuid = cswr.session_room_uuid
      current_room_name = cswr.session_room_name
      current_floor = cswr.session_room_floor ?? cswr.working_floor
      current_store_name = cswr.working_store_name
      category = cswr.category
      time_minutes = cswr.time_minutes ?? 0
      entered_at = cswr.entered_at
    }

    home_workers.push({
      membership_id: m.id,
      display_name: (m.nickname?.trim() || m.full_name?.trim() || "알 수 없음"),
      current_zone: zone,
      current_room_uuid,
      current_room_name,
      current_floor,
      current_store_name,
      working_store_uuid,
      category,
      current_time_minutes: time_minutes,
      entered_at,
      extension_count: 0,
    })
  }

  // Fill caller's store summary.waiting now that we know who is waiting.
  {
    const callerStore = stores.find(s => s.store_uuid === callerStoreUuid)
    if (callerStore) {
      callerStore.summary.waiting = home_workers.filter(h => h.current_zone === "waiting").length
    }
  }

  // ── foreign_workers_at_mine ───────────────────────────────────
  const foreign_workers_at_mine: MonitorForeignWorker[] = []
  for (const p of Q4_participants) {
    if (p._store_uuid !== callerStoreUuid) continue
    const mem = p.membership_id ? membershipById.get(p.membership_id) : null
    if (!mem) continue
    if (mem.store_uuid === callerStoreUuid) continue // not foreign
    foreign_workers_at_mine.push({
      membership_id: p.membership_id,
      display_name: (mem.nickname?.trim() || mem.full_name?.trim() || "알 수 없음"),
      origin_store_uuid: mem.store_uuid,
      origin_store_name: mem.origin_store_name,
      session_id: p.session_id,
      current_room_uuid: p._room_uuid,
      entered_at: p.entered_at,
    })
  }

  // ── movement ──────────────────────────────────────────────────
  const movement: MonitorMovementEvent[] = Q8_movement.map(m => ({
    at: m.at,
    kind: m.kind,
    actor_role: m.actor_role,
    entity_table: m.entity_table,
    entity_id: m.entity_id,
    room_uuid: m.room_uuid,
    session_id: m.session_id,
  }))

  return {
    scope,
    generated_at: new Date().toISOString(),
    mode,
    stores,
    home_workers,
    foreign_workers_at_mine,
    movement,
  }
}
