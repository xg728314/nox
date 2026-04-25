import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export type ParticipantRow = {
  id: string
  session_id: string
  external_name: string | null
  category: string | null
  time_minutes: number | null
  entered_at: string
  origin_store_uuid: string | null
  store_uuid: string
  match_status: "matched" | "unmatched"
  name_edited: boolean
  room_name: string | null
  working_store_name: string | null
}

export type ManagerParticipantsResponse = {
  participants: ParticipantRow[]
}

/**
 * audit_events SCAN REMOVED (audit_events-scan round):
 *
 *   Before:
 *     4 sequential Supabase RTTs, one of which scanned audit_events
 *     with NO `store_uuid` filter and NO time window —
 *       WHERE entity_table='session_participants'
 *         AND action='update_external_name'
 *         AND entity_id IN (<participant ids>)
 *     The scan grew with total audit history forever and violated
 *     CLAUDE.md skill-01 (store_uuid scope required).
 *
 *   After:
 *     3 Supabase RTTs total, and the name-edited flag is now derived
 *     from `session_participants.name_edited_at` (migration 058) —
 *     no audit_events read at all.
 *
 *   Layout:
 *     Phase 1 (parallel) — independent of each other:
 *       a. participants  (manager_membership_id filter + store_uuid)
 *       b. storeMemberships (store hostess ids for name match set)
 *     Phase 2 (parallel) — consume Phase 1 ids:
 *       c. hsts      (name/stage_name by membership_ids)
 *       d. sessions  (rooms join by session_ids)  [only if rows exist]
 *     Phase 3 — consume Phase 2 ids:
 *       e. stores    (store_name by store_uuids from sessions)
 *
 *   All response fields (id/session_id/external_name/category/
 *   time_minutes/entered_at/origin_store_uuid/store_uuid/match_status/
 *   name_edited/room_name/working_store_name) preserved bit-identical.
 *
 *   Perf markers:
 *     perf.manager.participants.phase.fetch
 *     perf.manager.participants.phase.derive
 *     perf.manager.participants.total
 */

type ParticipantSelectRow = {
  id: string
  session_id: string
  store_uuid: string
  membership_id: string
  external_name: string | null
  category: string | null
  time_minutes: number | null
  origin_store_uuid: string | null
  entered_at: string
  status: string
  manager_membership_id: string
  role: string
  name_edited_at: string | null
}

export async function getManagerParticipants(auth: AuthContext): Promise<ManagerParticipantsResponse> {
  const supabase = getServiceClient()
  const tStart = Date.now()

  // ── Phase 1: 2 parallel reads ────────────────────────────────
  // (a) and (b) are mutually independent — both gated only on
  // auth.membership_id / auth.store_uuid. Firing in parallel cuts
  // wall-time to max of the two. `.eq("store_uuid", auth.store_uuid)`
  // added to the participants query as defense-in-depth (skill-01).
  const tFetch = Date.now()
  const participantsP = supabase
    .from("session_participants")
    .select("id, session_id, store_uuid, membership_id, external_name, category, time_minutes, origin_store_uuid, entered_at, status, manager_membership_id, role, name_edited_at")
    .eq("store_uuid", auth.store_uuid)
    .eq("manager_membership_id", auth.membership_id)
    .eq("status", "active")
    .eq("role", "hostess")
    .is("deleted_at", null)
    .order("entered_at", { ascending: false })

  const storeMembershipsP = supabase
    .from("store_memberships")
    .select("id")
    .eq("store_uuid", auth.store_uuid)
    .eq("role", "hostess")
    .is("deleted_at", null)

  const [participantsRes, storeMembershipsRes] = await Promise.all([
    participantsP,
    storeMembershipsP,
  ])

  if (participantsRes.error) throw new Error(participantsRes.error.message)
  const rows = (participantsRes.data ?? []) as ParticipantSelectRow[]

  const mIds = ((storeMembershipsRes.data ?? []) as { id: string }[]).map((m) => m.id)

  // ── Phase 2: 2 parallel reads — consume Phase 1 ids ─────────
  // (c) hsts depends on mIds
  // (d) sessions depends on participant session_ids
  // Both independent of each other.
  const sessionIds = [...new Set(rows.map((r) => r.session_id))]

  const hstsP = mIds.length > 0
    ? supabase
        .from("hostesses")
        .select("name, stage_name")
        .in("membership_id", mIds)
        .eq("store_uuid", auth.store_uuid)
        .is("deleted_at", null)
    : Promise.resolve({ data: [] as { name: string | null; stage_name: string | null }[] })

  const sessionsP = sessionIds.length > 0
    ? supabase
        .from("room_sessions")
        .select("id, store_uuid, rooms!inner(room_name)")
        .in("id", sessionIds)
    : Promise.resolve({ data: [] as { id: string; store_uuid: string; rooms: unknown }[] })

  const [hstsRes, sessionsRes] = await Promise.all([hstsP, sessionsP])

  const hostessNames = new Set<string>()
  for (const h of (hstsRes.data ?? []) as { name: string | null; stage_name: string | null }[]) {
    if (h.name) hostessNames.add(h.name)
    if (h.stage_name) hostessNames.add(h.stage_name)
  }

  const sessionsData = (sessionsRes.data ?? []) as { id: string; store_uuid: string; rooms: unknown }[]

  // ── Phase 3: stores lookup — depends on sessions.store_uuid ──
  const storeUuids = [...new Set(sessionsData.map((s) => s.store_uuid))]
  const storeNameMap = new Map<string, string>()
  if (storeUuids.length > 0) {
    const { data: stores } = await supabase
      .from("stores")
      .select("id, store_name")
      .in("id", storeUuids)
    for (const s of (stores ?? []) as { id: string; store_name: string }[]) {
      storeNameMap.set(s.id, s.store_name)
    }
  }

  const sessionRoomMap = new Map<string, { room_name: string; store_name: string }>()
  for (const s of sessionsData) {
    const roomName = Array.isArray(s.rooms)
      ? (s.rooms as { room_name: string }[])[0]?.room_name
      : (s.rooms as { room_name: string })?.room_name
    sessionRoomMap.set(s.id, {
      room_name: roomName ?? "?",
      store_name: storeNameMap.get(s.store_uuid) ?? "?",
    })
  }
  console.log(JSON.stringify({
    tag: "perf.manager.participants.phase.fetch",
    ms: Date.now() - tFetch,
    rows: rows.length,
  }))

  const tDerive = Date.now()
  const result: ParticipantRow[] = rows.map((p) => {
    const extName = p.external_name?.trim()
    let matchStatus: "matched" | "unmatched" = "unmatched"
    if (extName && hostessNames.has(extName)) {
      matchStatus = "matched"
    }

    const sessionInfo = sessionRoomMap.get(p.session_id)
    return {
      id: p.id,
      session_id: p.session_id,
      external_name: p.external_name,
      category: p.category,
      time_minutes: p.time_minutes,
      entered_at: p.entered_at,
      origin_store_uuid: p.origin_store_uuid,
      store_uuid: p.store_uuid,
      match_status: matchStatus,
      // migration 058: derive name_edited directly from row column.
      // No audit_events round-trip.
      name_edited: p.name_edited_at !== null,
      room_name: sessionInfo?.room_name ?? null,
      working_store_name: sessionInfo?.store_name ?? null,
    }
  })
  console.log(JSON.stringify({
    tag: "perf.manager.participants.phase.derive",
    ms: Date.now() - tDerive,
  }))

  console.log(JSON.stringify({
    tag: "perf.manager.participants.total",
    ms: Date.now() - tStart,
    rows: rows.length,
  }))

  return { participants: result }
}
