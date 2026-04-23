import { NextResponse } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { parseScope, resolveMonitorScope } from "@/lib/monitor/scopeResolver"
import {
  mergeSnapshots,
  type StoreRow,
  type RoomRow,
  type SessionRow,
  type ParticipantRow,
  type MembershipRow,
  type BlePresenceRow,
  type CorrectionRow,
  type MovementRow,
  type CswrRow,
} from "@/lib/monitor/mergeSnapshots"

/**
 * GET /api/monitor/scope
 *
 * Multi-store scope-aware monitor read. Fixed ROUND-TRIP COUNT regardless
 * of how many stores are in scope — never fans out to
 * /api/counter/monitor.
 *
 * Query plan (§11 of design):
 *   Phase A (parallel): Q1 stores, Q2 rooms, Q3 active sessions,
 *                       Q6 ble_tag_presence, Q7 active corrections,
 *                       Q8 audit_events, Q9 cswr (mine-like only)
 *   Phase B: Q4 session_participants IN Q3.session_ids
 *   Phase C: Q5 store_memberships IN (Q1.store_ids ∪ Q4.membership_ids)
 *
 * Total roundtrips: 3 (constant), independent of storeUuids[] length.
 *
 * Response shape: ScopedMonitorResponse (lib/monitor/mergeSnapshots.ts).
 * Extended per-participant fields (operator_status, recommendations,
 * apply_status) are returned with safe defaults. MonitorPanel / Ops
 * continues to use /api/counter/monitor for the rich view — no regression.
 */

function supa(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function GET(request: Request) {
  // ── 1. Auth ──────────────────────────────────────────────────────
  let auth
  try {
    auth = await resolveAuthContext(request)
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json(
        { error: e.type, message: e.message },
        { status: e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403 },
      )
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }

  // ── 2. Parse scope ───────────────────────────────────────────────
  const url = new URL(request.url)
  const scopeRaw = url.searchParams.get("scope")
  const scope = parseScope(scopeRaw)
  if (!scope) {
    return NextResponse.json(
      { error: "BAD_REQUEST", message: "scope must be one of: mine | current_floor | floor-5..8 | store-<uuid>" },
      { status: 400 },
    )
  }

  // ── 3. Supabase client ───────────────────────────────────────────
  let supabase: SupabaseClient
  try { supabase = supa() } catch {
    return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
  }

  // ── 4. Scope resolution (super_admin gate, storeUuids[]) ─────────
  const resolution = await resolveMonitorScope({ scope, auth, supabase })
  if (!resolution.ok) return resolution.forbidden

  const { storeUuids, floor, isSuper, isCrossStore } = resolution

  // Empty scope (no matching stores) → return an empty shape rather than
  // malformed IN () query.
  if (storeUuids.length === 0) {
    return NextResponse.json({
      scope,
      generated_at: new Date().toISOString(),
      mode: "manual",
      stores: [],
      home_workers: [],
      foreign_workers_at_mine: [],
      movement: [],
      isCrossStore,
      floor,
      isSuper,
    })
  }

  // Run Q9 only when the caller's own store is in scope (mine-like).
  const runCswr = storeUuids.includes(auth.store_uuid)

  const nowMs = Date.now()
  const blePresenceCutoff = new Date(nowMs - 10 * 60 * 1000).toISOString()
  const movementCutoff = new Date(nowMs - 30 * 60 * 1000).toISOString()

  // ── 5. Phase A — parallel queries ────────────────────────────────
  const [
    storesRes,
    roomsRes,
    sessionsRes,
    bleRes,
    correctionsRes,
    movementRes,
    cswrRes,
  ] = await Promise.all([
    // Q1 stores
    supabase
      .from("stores")
      .select("id, store_name, floor")
      .in("id", storeUuids)
      .is("deleted_at", null),
    // Q2 rooms
    supabase
      .from("rooms")
      .select("id, store_uuid, room_no, room_name, floor_no, sort_order")
      .in("store_uuid", storeUuids)
      .is("deleted_at", null),
    // Q3 active room_sessions
    supabase
      .from("room_sessions")
      .select("id, store_uuid, room_uuid, started_at")
      .in("store_uuid", storeUuids)
      .eq("status", "active")
      .is("deleted_at", null),
    // Q6 ble_tag_presence (10-minute window)
    supabase
      .from("ble_tag_presence")
      .select("store_uuid, minor, membership_id, room_uuid, last_event_type, last_seen_at")
      .in("store_uuid", storeUuids)
      .gt("last_seen_at", blePresenceCutoff),
    // Q7 active overlays (ORDER BY corrected_at DESC → first-wins in merge)
    supabase
      .from("ble_presence_corrections")
      .select("store_uuid, membership_id, corrected_zone, corrected_room_uuid, corrected_at, corrected_by_membership_id")
      .in("store_uuid", storeUuids)
      .eq("is_active", true)
      .order("corrected_at", { ascending: false }),
    // Q8 audit_events — movement feed (30-minute window)
    supabase
      .from("audit_events")
      .select("created_at, event_type, actor_role, entity_table, entity_id, meta, store_uuid")
      .in("store_uuid", storeUuids)
      .in("event_type", ["participant_checkin", "participant_mid_out", "participant_return", "participant_ended"])
      .gt("created_at", movementCutoff)
      .order("created_at", { ascending: false })
      .limit(200),
    // Q9 cswr — only when caller's store is in scope
    runCswr
      ? supabase
          .from("cross_store_work_records")
          .select("hostess_membership_id, working_store_uuid, session_id, category, time_minutes, entered_at")
          .eq("origin_store_uuid", auth.store_uuid)
          .in("status", ["pending", "approved"])
          .is("deleted_at", null)
      : Promise.resolve({ data: [], error: null }),
  ])

  for (const r of [storesRes, roomsRes, sessionsRes, bleRes, correctionsRes, movementRes, cswrRes]) {
    if (r.error) {
      return NextResponse.json(
        { error: "QUERY_FAILED", message: r.error.message },
        { status: 500 },
      )
    }
  }

  const Q1_stores = (storesRes.data ?? []) as StoreRow[]
  const Q2_rooms = (roomsRes.data ?? []) as RoomRow[]
  const Q3_sessions = (sessionsRes.data ?? []) as SessionRow[]
  const Q6_ble_presence = (bleRes.data ?? []) as BlePresenceRow[]
  const Q7_corrections = (correctionsRes.data ?? []) as CorrectionRow[]

  // ── 6. Phase B — Q4 participants (depends on Q3 session ids) ────
  const sessionIds = Q3_sessions.map(s => s.id)
  const Q4_participants: ParticipantRow[] = []
  if (sessionIds.length > 0) {
    const { data: partRows, error: partErr } = await supabase
      .from("session_participants")
      .select("id, session_id, membership_id, status, role, category, entered_at, time_minutes")
      .in("session_id", sessionIds)
      .in("store_uuid", storeUuids)
      .in("status", ["active", "mid_out"])
      .is("deleted_at", null)
    if (partErr) {
      return NextResponse.json({ error: "QUERY_FAILED", message: partErr.message }, { status: 500 })
    }
    // Denorm room_uuid/store_uuid from Q3.
    const sessById = new Map(Q3_sessions.map(s => [s.id, s]))
    for (const p of (partRows ?? []) as Array<{
      id: string; session_id: string; membership_id: string | null;
      status: string; role: string; category: string | null;
      entered_at: string; time_minutes: number | null;
    }>) {
      const sess = sessById.get(p.session_id)
      if (!sess) continue
      Q4_participants.push({
        id: p.id,
        session_id: p.session_id,
        membership_id: p.membership_id,
        status: p.status,
        role: p.role,
        category: p.category,
        entered_at: p.entered_at,
        time_minutes: p.time_minutes,
        _room_uuid: sess.room_uuid,
        _store_uuid: sess.store_uuid,
      })
    }
  }

  // ── 7. Phase C — Q5 memberships + profile/store_name join ───────
  const memIdSet = new Set<string>()
  for (const p of Q4_participants) if (p.membership_id) memIdSet.add(p.membership_id)

  // Build membership query: store_uuid IN scope OR id IN participant memberships.
  // supabase-js cannot express OR across .in() calls; use .or() clause.
  const storeUuidOrClause = `store_uuid.in.(${storeUuids.join(",")})`
  const idOrClause =
    memIdSet.size > 0 ? `id.in.(${Array.from(memIdSet).join(",")})` : null
  const orClause = idOrClause ? `${storeUuidOrClause},${idOrClause}` : storeUuidOrClause

  const { data: memRowsRaw, error: memErr } = await supabase
    .from("store_memberships")
    .select("id, profile_id, store_uuid, status, deleted_at")
    .or(orClause)
    .eq("status", "approved")
    .is("deleted_at", null)

  if (memErr) {
    return NextResponse.json({ error: "QUERY_FAILED", message: memErr.message }, { status: 500 })
  }

  const memBase = (memRowsRaw ?? []) as Array<{
    id: string; profile_id: string | null; store_uuid: string;
  }>

  // Resolve profile nicknames in one query.
  const profileIds = Array.from(new Set(
    memBase.map(m => m.profile_id).filter((x): x is string => !!x),
  ))
  const profileById = new Map<string, { nickname: string | null; full_name: string | null }>()
  if (profileIds.length > 0) {
    const { data: profRows } = await supabase
      .from("profiles")
      .select("id, nickname, full_name")
      .in("id", profileIds)
    for (const p of (profRows ?? []) as Array<{ id: string; nickname: string | null; full_name: string | null }>) {
      profileById.set(p.id, { nickname: p.nickname, full_name: p.full_name })
    }
  }

  // Resolve origin store names for all membership store_uuids.
  const memStoreUuids = Array.from(new Set(memBase.map(m => m.store_uuid)))
  const storeNameById = new Map<string, string>()
  if (memStoreUuids.length > 0) {
    const { data: stRows } = await supabase
      .from("stores")
      .select("id, store_name")
      .in("id", memStoreUuids)
    for (const s of (stRows ?? []) as Array<{ id: string; store_name: string }>) {
      storeNameById.set(s.id, s.store_name)
    }
  }

  const Q5_memberships: MembershipRow[] = memBase.map(m => {
    const prof = m.profile_id ? profileById.get(m.profile_id) : null
    return {
      id: m.id,
      profile_id: m.profile_id,
      store_uuid: m.store_uuid,
      nickname: prof?.nickname ?? null,
      full_name: prof?.full_name ?? null,
      origin_store_name: storeNameById.get(m.store_uuid) ?? null,
    }
  })

  // ── 8. Q9 post-processing — enrich cswr rows with session/room ──
  const Q9_cswr: CswrRow[] = []
  if (runCswr) {
    const cswrRaw = (cswrRes.data ?? []) as Array<{
      hostess_membership_id: string
      working_store_uuid: string
      session_id: string
      category: string | null
      time_minutes: number | null
      entered_at: string | null
    }>
    if (cswrRaw.length > 0) {
      const awaySessionIds = Array.from(new Set(cswrRaw.map(a => a.session_id)))
      const awayStoreUuids = Array.from(new Set(cswrRaw.map(a => a.working_store_uuid)))

      // Filter to currently active sessions only (ended sessions drop).
      const { data: awaySessRows } = await supabase
        .from("room_sessions")
        .select("id, room_uuid")
        .in("id", awaySessionIds)
        .eq("status", "active")
        .is("deleted_at", null)
      const activeAwaySessions = new Map<string, string | null>()
      for (const s of (awaySessRows ?? []) as Array<{ id: string; room_uuid: string | null }>) {
        activeAwaySessions.set(s.id, s.room_uuid)
      }

      const awayRoomUuids = Array.from(new Set(
        [...activeAwaySessions.values()].filter((r): r is string => !!r),
      ))
      const awayRoomById = new Map<string, { room_name: string | null; floor_no: number | null }>()
      if (awayRoomUuids.length > 0) {
        const { data: awayRoomRows } = await supabase
          .from("rooms")
          .select("id, room_name, floor_no")
          .in("id", awayRoomUuids)
        for (const r of (awayRoomRows ?? []) as Array<{ id: string; room_name: string | null; floor_no: number | null }>) {
          awayRoomById.set(r.id, { room_name: r.room_name, floor_no: r.floor_no })
        }
      }

      const awayStoreById = new Map<string, { store_name: string; floor: number | null }>()
      if (awayStoreUuids.length > 0) {
        const { data: awayStoreRows } = await supabase
          .from("stores")
          .select("id, store_name, floor")
          .in("id", awayStoreUuids)
        for (const s of (awayStoreRows ?? []) as Array<{ id: string; store_name: string; floor: number | null }>) {
          awayStoreById.set(s.id, { store_name: s.store_name, floor: s.floor })
        }
      }

      for (const a of cswrRaw) {
        // Drop rows whose referenced session is no longer active (즉시 탈락 규칙).
        if (!activeAwaySessions.has(a.session_id)) continue
        const roomUuid = activeAwaySessions.get(a.session_id) ?? null
        const room = roomUuid ? awayRoomById.get(roomUuid) ?? null : null
        const store = awayStoreById.get(a.working_store_uuid) ?? null
        Q9_cswr.push({
          hostess_membership_id: a.hostess_membership_id,
          working_store_uuid: a.working_store_uuid,
          working_store_name: store?.store_name ?? "",
          working_floor: store?.floor ?? null,
          session_id: a.session_id,
          session_room_uuid: roomUuid,
          session_room_name: room?.room_name ?? null,
          session_room_floor: room?.floor_no ?? null,
          entered_at: a.entered_at,
          category: a.category,
          time_minutes: a.time_minutes,
        })
      }
    }
  }

  // ── 9. Movement row shape ───────────────────────────────────────
  const Q8_movement: MovementRow[] = ((movementRes.data ?? []) as Array<{
    created_at: string
    event_type: string
    actor_role: string | null
    entity_table: string | null
    entity_id: string | null
    meta: Record<string, unknown> | null
    store_uuid: string
  }>).map(m => ({
    at: m.created_at,
    kind: m.event_type,
    actor_role: m.actor_role,
    entity_table: m.entity_table,
    entity_id: m.entity_id,
    room_uuid: (m.meta?.room_uuid as string | undefined) ?? null,
    session_id: (m.meta?.session_id as string | undefined) ?? null,
    store_uuid: m.store_uuid,
  }))

  // ── 10. Caller store name (for home_workers.current_store_name) ─
  const callerStoreRow = Q1_stores.find(s => s.id === auth.store_uuid)
  const callerStoreName = callerStoreRow?.store_name ?? ""

  // ── 11. Merge + respond ─────────────────────────────────────────
  const response = mergeSnapshots({
    scope,
    mode: "manual",
    callerStoreUuid: auth.store_uuid,
    callerStoreName,
    Q1_stores,
    Q2_rooms,
    Q3_sessions,
    Q4_participants,
    Q5_memberships,
    Q6_ble_presence,
    Q7_corrections,
    Q8_movement,
    Q9_cswr,
  })

  return NextResponse.json({
    ...response,
    meta: { isCrossStore, floor, isSuper },
  })
}
