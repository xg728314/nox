import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { formatRoomLabel } from "@/lib/rooms/formatRoomLabel"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * GET /api/reports/settlement-tree
 *
 * Hierarchical settlement tree — read-only, no mutations.
 *
 * Level 1 (no params or ?business_date=YYYY-MM-DD):
 *   Store-to-store bidirectional summary.
 *   Returns outbound (we owe them), inbound (they owe us), net per counterpart.
 *
 * Level 2 (?counterpart_store_uuid=xxx):
 *   Manager-level breakdown for a specific counterpart store.
 *   Shows per-manager total from cross_store_settlement_items.
 *
 * Level 3 (?manager_membership_id=xxx&counterpart_store_uuid=xxx):
 *   Hostess-level trace detail for a specific manager.
 *   Returns hostess name, room, category, time, amount from session_participants.
 *
 * Access: owner + manager. Manager sees only own hostesses in Level 3.
 */

function num(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)

    if (auth.role === "hostess") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    const { searchParams } = new URL(request.url)
    const counterpartStoreUuid = searchParams.get("counterpart_store_uuid")
    const managerMembershipId = searchParams.get("manager_membership_id")

    // ═══ LEVEL 3: Hostess trace ══════════════════════════════════════════════
    if (managerMembershipId && counterpartStoreUuid) {
      return handleLevel3(supabase, auth, managerMembershipId, counterpartStoreUuid)
    }

    // ═══ LEVEL 2: Manager breakdown ══════════════════════════════════════════
    if (counterpartStoreUuid) {
      return handleLevel2(supabase, auth, counterpartStoreUuid)
    }

    // ═══ LEVEL 1: Store-to-store ═════════════════════════════════════════════
    return handleLevel1(supabase, auth)

  } catch (error) {
    return handleRouteError(error, "reports/settlement-tree")
  }
}

// ─── Level 1: Bidirectional store-to-store summary ───��──────────────────────

async function handleLevel1(
  supabase: SupabaseClient,
  auth: Awaited<ReturnType<typeof resolveAuthContext>>
) {
  // Outbound: cross_store_settlements WHERE from_store_uuid = us
  const { data: outboundRaw } = await supabase
    .from("cross_store_settlements")
    .select("to_store_uuid, total_amount, prepaid_amount, remaining_amount, status")
    .eq("from_store_uuid", auth.store_uuid)
    .is("deleted_at", null)

  // Inbound: cross_store_settlements WHERE to_store_uuid = us
  const { data: inboundRaw } = await supabase
    .from("cross_store_settlements")
    .select("from_store_uuid, total_amount, prepaid_amount, remaining_amount, status")
    .eq("to_store_uuid", auth.store_uuid)
    .is("deleted_at", null)

  type StoreEntry = {
    counterpart_store_uuid: string
    counterpart_store_name: string
    outbound_total: number
    outbound_paid: number
    outbound_remaining: number
    inbound_total: number
    inbound_paid: number
    inbound_remaining: number
    net_amount: number
  }

  const map = new Map<string, StoreEntry>()

  function getOrCreate(uuid: string): StoreEntry {
    if (!map.has(uuid)) {
      map.set(uuid, {
        counterpart_store_uuid: uuid,
        counterpart_store_name: uuid.slice(0, 8),
        outbound_total: 0,
        outbound_paid: 0,
        outbound_remaining: 0,
        inbound_total: 0,
        inbound_paid: 0,
        inbound_remaining: 0,
        net_amount: 0,
      })
    }
    return map.get(uuid)!
  }

  // Aggregate outbound (we owe them)
  for (const row of (outboundRaw ?? []) as { to_store_uuid: string; total_amount: unknown; prepaid_amount: unknown; remaining_amount: unknown }[]) {
    const e = getOrCreate(row.to_store_uuid)
    e.outbound_total += num(row.total_amount)
    e.outbound_paid += num(row.prepaid_amount)
    e.outbound_remaining += num(row.remaining_amount)
  }

  // Aggregate inbound (they owe us)
  for (const row of (inboundRaw ?? []) as { from_store_uuid: string; total_amount: unknown; prepaid_amount: unknown; remaining_amount: unknown }[]) {
    const e = getOrCreate(row.from_store_uuid)
    e.inbound_total += num(row.total_amount)
    e.inbound_paid += num(row.prepaid_amount)
    e.inbound_remaining += num(row.remaining_amount)
  }

  // Compute net (positive = they owe us more, negative = we owe them more)
  for (const e of map.values()) {
    e.net_amount = e.inbound_total - e.outbound_total
  }

  // Resolve store names
  const storeIds = Array.from(map.keys())
  if (storeIds.length > 0) {
    const { data: storesRaw } = await supabase
      .from("stores")
      .select("id, store_name")
      .in("id", storeIds)
    for (const s of (storesRaw ?? []) as { id: string; store_name: string | null }[]) {
      const e = map.get(s.id)
      if (e && s.store_name) e.counterpart_store_name = s.store_name
    }
  }

  const stores = Array.from(map.values()).sort((a, b) =>
    Math.abs(b.net_amount) - Math.abs(a.net_amount)
  )

  return NextResponse.json({
    level: 1,
    store_uuid: auth.store_uuid,
    stores,
  })
}

// ─── Level 2: Manager breakdown for a counterpart store ─────────────────────

async function handleLevel2(
  supabase: SupabaseClient,
  auth: Awaited<ReturnType<typeof resolveAuthContext>>,
  counterpartStoreUuid: string
) {
  // Outbound items: headers where from=us, to=counterpart
  const { data: outboundHeaders } = await supabase
    .from("cross_store_settlements")
    .select("id")
    .eq("from_store_uuid", auth.store_uuid)
    .eq("to_store_uuid", counterpartStoreUuid)
    .is("deleted_at", null)

  const outboundHeaderIds = (outboundHeaders ?? []).map((h: { id: string }) => h.id)

  // Inbound items: headers where from=counterpart, to=us
  const { data: inboundHeaders } = await supabase
    .from("cross_store_settlements")
    .select("id")
    .eq("from_store_uuid", counterpartStoreUuid)
    .eq("to_store_uuid", auth.store_uuid)
    .is("deleted_at", null)

  const inboundHeaderIds = (inboundHeaders ?? []).map((h: { id: string }) => h.id)

  type ManagerEntry = {
    manager_membership_id: string
    manager_name: string
    outbound_amount: number
    outbound_paid: number
    inbound_amount: number
    inbound_paid: number
    net_amount: number
  }

  const mgrMap = new Map<string, ManagerEntry>()

  function getOrCreateMgr(mid: string): ManagerEntry {
    if (!mgrMap.has(mid)) {
      mgrMap.set(mid, {
        manager_membership_id: mid,
        manager_name: mid.slice(0, 8),
        outbound_amount: 0,
        outbound_paid: 0,
        inbound_amount: 0,
        inbound_paid: 0,
        net_amount: 0,
      })
    }
    return mgrMap.get(mid)!
  }

  // Load outbound items
  if (outboundHeaderIds.length > 0) {
    const { data: outItems } = await supabase
      .from("cross_store_settlement_items")
      .select("manager_membership_id, amount, paid_amount")
      .in("cross_store_settlement_id", outboundHeaderIds)
      .is("deleted_at", null)

    for (const it of (outItems ?? []) as { manager_membership_id: string; amount: unknown; paid_amount: unknown }[]) {
      if (!it.manager_membership_id) continue
      const e = getOrCreateMgr(it.manager_membership_id)
      e.outbound_amount += num(it.amount)
      e.outbound_paid += num(it.paid_amount)
    }
  }

  // Load inbound items
  if (inboundHeaderIds.length > 0) {
    const { data: inItems } = await supabase
      .from("cross_store_settlement_items")
      .select("manager_membership_id, amount, paid_amount")
      .in("cross_store_settlement_id", inboundHeaderIds)
      .is("deleted_at", null)

    for (const it of (inItems ?? []) as { manager_membership_id: string; amount: unknown; paid_amount: unknown }[]) {
      if (!it.manager_membership_id) continue
      const e = getOrCreateMgr(it.manager_membership_id)
      e.inbound_amount += num(it.amount)
      e.inbound_paid += num(it.paid_amount)
    }
  }

  // Net per manager
  for (const e of mgrMap.values()) {
    e.net_amount = e.inbound_amount - e.outbound_amount
  }

  // Resolve manager names via store_memberships → profiles
  const mids = Array.from(mgrMap.keys())
  if (mids.length > 0) {
    const { data: memRaw } = await supabase
      .from("store_memberships")
      .select("id, profile_id")
      .in("id", mids)
    const mems = (memRaw ?? []) as { id: string; profile_id: string }[]
    const pids = mems.map(m => m.profile_id).filter(Boolean)

    if (pids.length > 0) {
      const { data: profRaw } = await supabase
        .from("profiles")
        .select("id, full_name, nickname")
        .in("id", pids)
      const profById: Record<string, { full_name: string | null; nickname: string | null }> = {}
      for (const p of (profRaw ?? []) as { id: string; full_name: string | null; nickname: string | null }[]) {
        profById[p.id] = p
      }
      for (const m of mems) {
        const e = mgrMap.get(m.id)
        if (!e) continue
        const p = profById[m.profile_id]
        if (p) e.manager_name = p.nickname || p.full_name || m.id.slice(0, 8)
      }
    }

    // Also try managers table (may have a cleaner name)
    const { data: mgrNames } = await supabase
      .from("managers")
      .select("membership_id, name")
      .in("membership_id", mids)
    for (const m of (mgrNames ?? []) as { membership_id: string; name: string }[]) {
      const e = mgrMap.get(m.membership_id)
      if (e && m.name) e.manager_name = m.name
    }
  }

  // Resolve counterpart store name
  const { data: storeRow } = await supabase
    .from("stores")
    .select("store_name")
    .eq("id", counterpartStoreUuid)
    .maybeSingle()

  const managers = Array.from(mgrMap.values()).sort((a, b) =>
    Math.abs(b.net_amount) - Math.abs(a.net_amount)
  )

  return NextResponse.json({
    level: 2,
    store_uuid: auth.store_uuid,
    counterpart_store_uuid: counterpartStoreUuid,
    counterpart_store_name: (storeRow as { store_name?: string } | null)?.store_name ?? counterpartStoreUuid.slice(0, 8),
    managers,
  })
}

// ─── Level 3: Hostess trace for a manager ───────────────────────────────────

async function handleLevel3(
  supabase: SupabaseClient,
  auth: Awaited<ReturnType<typeof resolveAuthContext>>,
  managerMembershipId: string,
  counterpartStoreUuid: string
) {
  // Manager role: can only see own hostesses
  if (auth.role === "manager" && managerMembershipId !== auth.membership_id) {
    return NextResponse.json({ error: "FORBIDDEN", message: "실장은 자신의 아가씨만 조회 가능합니다." }, { status: 403 })
  }

  // Find cross-store session_participants tied to this manager + counterpart store.
  // Two directions:
  //   A) Our hostesses worked at counterpart store:
  //      session_participants WHERE origin_store_uuid = auth.store_uuid
  //                            AND store_uuid = counterpartStoreUuid (working store)
  //                            AND manager_membership_id = managerMembershipId
  //
  //   B) Counterpart hostesses worked at our store:
  //      session_participants WHERE origin_store_uuid = counterpartStoreUuid
  //                            AND store_uuid = auth.store_uuid (working store)
  //                            AND manager_membership_id = managerMembershipId

  // Direction A: our hostesses → their store
  const { data: outboundParticipants } = await supabase
    .from("session_participants")
    .select("id, session_id, membership_id, category, time_minutes, price_amount, hostess_payout_amount, status, entered_at, left_at")
    .eq("origin_store_uuid", auth.store_uuid)
    .eq("store_uuid", counterpartStoreUuid)
    .eq("manager_membership_id", managerMembershipId)
    .eq("role", "hostess")
    .is("deleted_at", null)
    .order("left_at", { ascending: false, nullsFirst: false })

  // Direction B: their hostesses → our store
  const { data: inboundParticipants } = await supabase
    .from("session_participants")
    .select("id, session_id, membership_id, category, time_minutes, price_amount, hostess_payout_amount, status, entered_at, left_at")
    .eq("origin_store_uuid", counterpartStoreUuid)
    .eq("store_uuid", auth.store_uuid)
    .eq("manager_membership_id", managerMembershipId)
    .eq("role", "hostess")
    .is("deleted_at", null)
    .order("left_at", { ascending: false, nullsFirst: false })

  const allParticipants = [
    ...((outboundParticipants ?? []) as ParticipantRow[]).map(p => ({ ...p, direction: "outbound" as const })),
    ...((inboundParticipants ?? []) as ParticipantRow[]).map(p => ({ ...p, direction: "inbound" as const })),
  ]

  // Resolve hostess names
  const hostessIds = [...new Set(allParticipants.map(p => p.membership_id).filter(Boolean))]
  const hostessNameMap = new Map<string, string>()
  if (hostessIds.length > 0) {
    const { data: hstNames } = await supabase
      .from("hostesses")
      .select("membership_id, name")
      .in("membership_id", hostessIds)
    for (const h of (hstNames ?? []) as { membership_id: string; name: string }[]) {
      hostessNameMap.set(h.membership_id, h.name)
    }
  }

  // Resolve room names via session_id → room_sessions → rooms
  const sessionIds = [...new Set(allParticipants.map(p => p.session_id))]
  const roomNameMap = new Map<string, string>()
  if (sessionIds.length > 0) {
    const { data: sessionsRaw } = await supabase
      .from("room_sessions")
      .select("id, room_uuid")
      .in("id", sessionIds)
    const roomUuids = [...new Set((sessionsRaw ?? []).map((s: { room_uuid: string }) => s.room_uuid).filter(Boolean))]
    const sessionRoomMap = new Map<string, string>()
    for (const s of (sessionsRaw ?? []) as { id: string; room_uuid: string }[]) {
      sessionRoomMap.set(s.id, s.room_uuid)
    }

    if (roomUuids.length > 0) {
      const { data: roomsRaw } = await supabase
        .from("rooms")
        .select("id, room_name, room_no")
        .in("id", roomUuids)
      const roomById = new Map<string, string>()
      for (const r of (roomsRaw ?? []) as { id: string; room_name: string | null; room_no: string | null }[]) {
        roomById.set(r.id, formatRoomLabel(r))
      }
      for (const [sid, ruid] of sessionRoomMap) {
        const name = roomById.get(ruid)
        if (name) roomNameMap.set(sid, name)
      }
    }
  }

  // Resolve counterpart store name + manager name
  const { data: storeRow } = await supabase
    .from("stores")
    .select("store_name")
    .eq("id", counterpartStoreUuid)
    .maybeSingle()

  let managerName = managerMembershipId.slice(0, 8)
  {
    const { data: mgrRow } = await supabase
      .from("managers")
      .select("name")
      .eq("membership_id", managerMembershipId)
      .maybeSingle()
    if (mgrRow?.name) managerName = mgrRow.name
  }

  const hostesses = allParticipants.map(p => ({
    participant_id: p.id,
    session_id: p.session_id,
    direction: p.direction,
    membership_id: p.membership_id,
    hostess_name: hostessNameMap.get(p.membership_id) || null,
    room_name: roomNameMap.get(p.session_id) || null,
    category: p.category,
    time_minutes: p.time_minutes,
    price_amount: p.price_amount,
    hostess_payout: p.hostess_payout_amount,
    status: p.status,
    entered_at: p.entered_at,
    left_at: p.left_at,
  }))

  return NextResponse.json({
    level: 3,
    store_uuid: auth.store_uuid,
    counterpart_store_uuid: counterpartStoreUuid,
    counterpart_store_name: (storeRow as { store_name?: string } | null)?.store_name ?? counterpartStoreUuid.slice(0, 8),
    manager_membership_id: managerMembershipId,
    manager_name: managerName,
    hostesses,
  })
}

// ─── Types ──────────────────────────────────────────────────────────────────

type ParticipantRow = {
  id: string
  session_id: string
  membership_id: string
  category: string | null
  time_minutes: number
  price_amount: number
  hostess_payout_amount: number
  status: string
  entered_at: string
  left_at: string | null
}
