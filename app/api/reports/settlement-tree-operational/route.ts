import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { formatRoomLabel } from "@/lib/rooms/formatRoomLabel"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * GET /api/reports/settlement-tree-operational
 *
 * Operational cross-store settlement tree — derived from session_participants
 * where origin_store_uuid IS NOT NULL (cross-store work).
 *
 * Works even when cross_store_settlements headers have not been manually created.
 *
 * Level 1 (no params):
 *   Store-to-store amounts from actual participant work.
 *   Outbound = external hostesses who worked at OUR store (we owe their origin store).
 *   Inbound  = OUR hostesses who worked at OTHER stores (they owe us).
 *
 * Level 2 (?counterpart_store_uuid=xxx):
 *   Manager-level breakdown for a specific counterpart store.
 *
 * Level 3 (?counterpart_store_uuid=xxx&manager_membership_id=yyy):
 *   Hostess-level trace detail.
 *
 * ── Visibility split by role (CLAUDE.md L140-142) ─────────────────
 *   owner 는 "실장 개별 수익 / 스태프 개별 수익" 을 볼 수 없다. 따라서:
 *     - Level 1/2 의 owner 응답은 `price_amount` (청구액 축) 기반 집계를 쓴다.
 *       payout 기반으로 집계하면 (price - manager_payout) 이 노출되어 실장
 *       개별 공제액 역산이 가능. price 기반은 구간별 "누구에게 얼마 청구"
 *       라는 store-to-store 채무액 축이라 공제액 역산 불가.
 *     - Level 3 의 owner 응답은 `hostess_payout` / `manager_payout` 필드를
 *       row-level 에서 제거. price_amount / time_minutes 만 노출.
 *   manager / super_admin 은 operational 용도로 기존 payout 축 유지.
 *   hostess 는 기존처럼 403.
 */

function num(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

type ParticipantRow = {
  id: string
  session_id: string
  membership_id: string | null
  category: string | null
  time_minutes: number
  price_amount: number
  hostess_payout_amount: number
  manager_membership_id: string | null
  origin_store_uuid: string | null
  store_uuid: string
  status: string
  entered_at: string
  left_at: string | null
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

    // Phase 10 (2026-04-24): cross-store 리포트 → self counterpart 지정 금지.
    //   intra-store 선지급 / 거래는 본 리포트 축 (세션 참여자 origin_store_uuid)
    //   의미와 어긋남. 명시 거부.
    if (counterpartStoreUuid && counterpartStoreUuid === auth.store_uuid) {
      return NextResponse.json(
        {
          error: "INVALID_COUNTERPART",
          message: "counterpart_store_uuid 는 본 매장(auth.store_uuid) 과 달라야 합니다. cross-store 리포트에서는 self 지정이 허용되지 않습니다.",
        },
        { status: 400 },
      )
    }

    if (managerMembershipId && counterpartStoreUuid) {
      return handleLevel3(supabase, auth, managerMembershipId, counterpartStoreUuid)
    }
    if (counterpartStoreUuid) {
      return handleLevel2(supabase, auth, counterpartStoreUuid)
    }
    return handleLevel1(supabase, auth)

  } catch (error) {
    return handleRouteError(error, "reports/settlement-tree-operational")
  }
}

// Owner 응답은 price_amount 축, manager/super_admin 은 기존 hostess_payout_amount 축.
// CLAUDE.md L140-142: 사장은 스태프/실장 개별 수익 비노출.
function amountColumn(role: string): "price_amount" | "hostess_payout_amount" {
  return role === "owner" ? "price_amount" : "hostess_payout_amount"
}

// ─── Level 1: Store-to-store from session_participants ──────────────────────

async function handleLevel1(
  supabase: SupabaseClient,
  auth: Awaited<ReturnType<typeof resolveAuthContext>>
) {
  const amtCol = amountColumn(auth.role)
  // Outbound: external hostesses who worked at OUR store.
  // session_participants WHERE store_uuid = us AND origin_store_uuid IS NOT NULL
  // → grouped by origin_store_uuid (their home store = who we owe)
  const { data: outboundRaw } = await supabase
    .from("session_participants")
    .select(`origin_store_uuid, ${amtCol}`)
    .eq("store_uuid", auth.store_uuid)
    .eq("role", "hostess")
    .not("origin_store_uuid", "is", null)
    .is("deleted_at", null)

  // Inbound: OUR hostesses who worked at OTHER stores.
  // session_participants WHERE origin_store_uuid = us AND store_uuid != us
  // → grouped by store_uuid (the working store = who owes us)
  const { data: inboundRaw } = await supabase
    .from("session_participants")
    .select(`store_uuid, ${amtCol}`)
    .eq("origin_store_uuid", auth.store_uuid)
    .neq("store_uuid", auth.store_uuid)
    .eq("role", "hostess")
    .is("deleted_at", null)

  type StoreEntry = {
    counterpart_store_uuid: string
    counterpart_store_name: string
    outbound_total: number
    outbound_count: number
    inbound_total: number
    inbound_count: number
    net_amount: number
    /** Σ manager_prepayments.amount (status=active) us → counterpart */
    outbound_prepaid: number
    outbound_remaining: number
  }

  const map = new Map<string, StoreEntry>()

  function getOrCreate(uuid: string): StoreEntry {
    if (!map.has(uuid)) {
      map.set(uuid, {
        counterpart_store_uuid: uuid,
        counterpart_store_name: uuid.slice(0, 8),
        outbound_total: 0, outbound_count: 0,
        inbound_total: 0, inbound_count: 0,
        net_amount: 0,
        outbound_prepaid: 0, outbound_remaining: 0,
      })
    }
    return map.get(uuid)!
  }

  // Outbound: we owe their origin store
  for (const row of (outboundRaw ?? []) as Record<string, unknown>[]) {
    const originUuid = typeof row.origin_store_uuid === "string" ? row.origin_store_uuid : null
    if (!originUuid) continue
    const e = getOrCreate(originUuid)
    e.outbound_total += num(row[amtCol])
    e.outbound_count += 1
  }

  // Inbound: working store owes us
  for (const row of (inboundRaw ?? []) as Record<string, unknown>[]) {
    const storeUuid = typeof row.store_uuid === "string" ? row.store_uuid : null
    if (!storeUuid) continue
    const e = getOrCreate(storeUuid)
    e.inbound_total += num(row[amtCol])
    e.inbound_count += 1
  }

  // Prepayments we've already paid out to managers in each counterpart.
  // Source: manager_prepayments (STEP-043 ledger). Scoped to caller's
  // store as actor. Settlement-tree "outbound" obligation is the one we
  // can prepay against; inbound prepayments (counterpart → us) are
  // tracked by the counterpart store themselves and not summed here.
  //
  // Phase 10 (2026-04-24) 081 이후: manager_prepayments 는 intra-store
  // (target_store_uuid = store_uuid) row 도 허용. 본 리포트는 cross-store
  // 채무 축이므로 intra row 는 **완전 차단** 필요. target_store_uuid <>
  // store_uuid 필터를 반드시 유지.
  const { data: prepaidRows } = await supabase
    .from("manager_prepayments")
    .select("target_store_uuid, amount")
    .eq("store_uuid", auth.store_uuid)
    .neq("target_store_uuid", auth.store_uuid)
    .eq("status", "active")
    .is("deleted_at", null)

  for (const r of (prepaidRows ?? []) as { target_store_uuid: string; amount: number }[]) {
    const e = map.get(r.target_store_uuid)
    if (!e) continue // prepayment without any operational tree balance
    e.outbound_prepaid += num(r.amount)
  }

  for (const e of map.values()) {
    e.net_amount = e.inbound_total - e.outbound_total
    e.outbound_remaining = Math.max(0, e.outbound_total - e.outbound_prepaid)
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

  return NextResponse.json({ level: 1, store_uuid: auth.store_uuid, stores })
}

// ─── Level 2: Manager breakdown for counterpart ─────────────────────────────

async function handleLevel2(
  supabase: SupabaseClient,
  auth: Awaited<ReturnType<typeof resolveAuthContext>>,
  counterpartStoreUuid: string
) {
  const amtCol = amountColumn(auth.role)
  // Outbound: external hostesses (origin=counterpart) who worked here (store=us)
  const { data: outboundRaw } = await supabase
    .from("session_participants")
    .select(`manager_membership_id, ${amtCol}`)
    .eq("store_uuid", auth.store_uuid)
    .eq("origin_store_uuid", counterpartStoreUuid)
    .eq("role", "hostess")
    .is("deleted_at", null)

  // Inbound: our hostesses (origin=us) who worked there (store=counterpart)
  const { data: inboundRaw } = await supabase
    .from("session_participants")
    .select(`manager_membership_id, ${amtCol}`)
    .eq("store_uuid", counterpartStoreUuid)
    .eq("origin_store_uuid", auth.store_uuid)
    .eq("role", "hostess")
    .is("deleted_at", null)

  type MgrEntry = {
    manager_membership_id: string
    manager_name: string
    outbound_amount: number
    outbound_count: number
    inbound_amount: number
    inbound_count: number
    net_amount: number
    /** Σ manager_prepayments.amount for (us → counterpart, this manager). */
    outbound_prepaid: number
    outbound_remaining: number
  }

  const mgrMap = new Map<string, MgrEntry>()

  function getOrCreateMgr(mid: string): MgrEntry {
    if (!mgrMap.has(mid)) {
      mgrMap.set(mid, {
        manager_membership_id: mid,
        manager_name: mid.slice(0, 8),
        outbound_amount: 0, outbound_count: 0,
        inbound_amount: 0, inbound_count: 0,
        net_amount: 0,
        outbound_prepaid: 0, outbound_remaining: 0,
      })
    }
    return mgrMap.get(mid)!
  }

  const UNASSIGNED = "__unassigned__"

  for (const row of (outboundRaw ?? []) as Record<string, unknown>[]) {
    const midRaw = row.manager_membership_id
    const mid = typeof midRaw === "string" && midRaw ? midRaw : UNASSIGNED
    const e = getOrCreateMgr(mid)
    e.outbound_amount += num(row[amtCol])
    e.outbound_count += 1
  }

  for (const row of (inboundRaw ?? []) as Record<string, unknown>[]) {
    const midRaw = row.manager_membership_id
    const mid = typeof midRaw === "string" && midRaw ? midRaw : UNASSIGNED
    const e = getOrCreateMgr(mid)
    e.inbound_amount += num(row[amtCol])
    e.inbound_count += 1
  }

  // Prepayments we've already paid to managers at this counterpart.
  const { data: prepaidRowsMgr } = await supabase
    .from("manager_prepayments")
    .select("target_manager_membership_id, amount")
    .eq("store_uuid", auth.store_uuid)
    .eq("target_store_uuid", counterpartStoreUuid)
    .eq("status", "active")
    .is("deleted_at", null)

  for (const r of (prepaidRowsMgr ?? []) as { target_manager_membership_id: string; amount: number }[]) {
    const e = mgrMap.get(r.target_manager_membership_id)
    if (!e) continue // prepayment to a manager with no operational rows in this counterpart
    e.outbound_prepaid += num(r.amount)
  }

  for (const e of mgrMap.values()) {
    e.net_amount = e.inbound_amount - e.outbound_amount
    e.outbound_remaining = Math.max(0, e.outbound_amount - e.outbound_prepaid)
  }

  // Resolve manager names
  const mids = Array.from(mgrMap.keys()).filter(k => k !== UNASSIGNED)
  if (mids.length > 0) {
    const { data: mgrNames } = await supabase
      .from("managers")
      .select("membership_id, name")
      .in("membership_id", mids)
    for (const m of (mgrNames ?? []) as { membership_id: string; name: string }[]) {
      const e = mgrMap.get(m.membership_id)
      if (e && m.name) e.manager_name = m.name
    }
  }
  // Label unassigned
  const unassigned = mgrMap.get(UNASSIGNED)
  if (unassigned) unassigned.manager_name = "미배정"

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

// ─── Level 3: Hostess trace ─────────────────────────────────────────────────

async function handleLevel3(
  supabase: SupabaseClient,
  auth: Awaited<ReturnType<typeof resolveAuthContext>>,
  managerMembershipId: string,
  counterpartStoreUuid: string
) {
  // Manager role: can only see own hostesses
  if (auth.role === "manager" && managerMembershipId !== auth.membership_id && managerMembershipId !== "__unassigned__") {
    return NextResponse.json({ error: "FORBIDDEN", message: "실장은 자신의 스태프만 조회 가능합니다." }, { status: 403 })
  }

  const mgrFilter = managerMembershipId === "__unassigned__" ? null : managerMembershipId

  // Outbound: external hostesses (origin=counterpart) at our store
  // Phase 10 (2026-04-24): 스태프 이름 표시를 위해 external_name 도 포함.
  //   session_participants 는 hostess 이름 소스가 두 곳:
  //   (1) membership_id → hostesses.stage_name | name
  //   (2) external_name (외부 등록, membership 없는 케이스)
  const SELECT_COLS = "id, session_id, membership_id, category, time_minutes, price_amount, hostess_payout_amount, status, entered_at, left_at, external_name"
  let outQ = supabase
    .from("session_participants")
    .select(SELECT_COLS)
    .eq("store_uuid", auth.store_uuid)
    .eq("origin_store_uuid", counterpartStoreUuid)
    .eq("role", "hostess")
    .is("deleted_at", null)
    .order("left_at", { ascending: false, nullsFirst: false })
  if (mgrFilter) outQ = outQ.eq("manager_membership_id", mgrFilter)
  else outQ = outQ.is("manager_membership_id", null)
  const { data: outboundP } = await outQ

  // Inbound: our hostesses (origin=us) at counterpart store
  let inQ = supabase
    .from("session_participants")
    .select(SELECT_COLS)
    .eq("store_uuid", counterpartStoreUuid)
    .eq("origin_store_uuid", auth.store_uuid)
    .eq("role", "hostess")
    .is("deleted_at", null)
    .order("left_at", { ascending: false, nullsFirst: false })
  if (mgrFilter) inQ = inQ.eq("manager_membership_id", mgrFilter)
  else inQ = inQ.is("manager_membership_id", null)
  const { data: inboundP } = await inQ

  type PRow = {
    id: string
    session_id: string
    membership_id: string | null
    category: string | null
    time_minutes: number
    price_amount: number
    hostess_payout_amount: number
    status: string
    entered_at: string
    left_at: string | null
    external_name: string | null
  }
  const allP = [
    ...((outboundP ?? []) as PRow[]).map(p => ({ ...p, direction: "outbound" as const })),
    ...((inboundP ?? []) as PRow[]).map(p => ({ ...p, direction: "inbound" as const })),
  ]

  // Hostess names — stage_name 우선, 없으면 name.
  const hIds = [...new Set(allP.map(p => p.membership_id).filter(Boolean) as string[])]
  const hNameMap = new Map<string, string>()
  if (hIds.length > 0) {
    const { data: hsts } = await supabase
      .from("hostesses")
      .select("membership_id, name, stage_name")
      .in("membership_id", hIds)
    for (const h of (hsts ?? []) as {
      membership_id: string
      name: string | null
      stage_name: string | null
    }[]) {
      const resolved = h.stage_name || h.name || ""
      if (resolved) hNameMap.set(h.membership_id, resolved)
    }
  }

  // Room names
  const sIds = [...new Set(allP.map(p => p.session_id))]
  const roomNameMap = new Map<string, string>()
  if (sIds.length > 0) {
    const { data: sessRaw } = await supabase.from("room_sessions").select("id, room_uuid").in("id", sIds)
    const rUuids = [...new Set((sessRaw ?? []).map((s: { room_uuid: string }) => s.room_uuid).filter(Boolean))]
    const sRoomMap = new Map<string, string>()
    for (const s of (sessRaw ?? []) as { id: string; room_uuid: string }[]) sRoomMap.set(s.id, s.room_uuid)
    if (rUuids.length > 0) {
      const { data: roomsRaw } = await supabase.from("rooms").select("id, room_name, room_no").in("id", rUuids)
      const rById = new Map<string, string>()
      for (const r of (roomsRaw ?? []) as { id: string; room_name: string | null; room_no: string | null }[]) {
        rById.set(r.id, formatRoomLabel(r))
      }
      for (const [sid, ruid] of sRoomMap) { const n = rById.get(ruid); if (n) roomNameMap.set(sid, n) }
    }
  }

  // Manager name + store name
  const { data: storeRow } = await supabase.from("stores").select("store_name").eq("id", counterpartStoreUuid).maybeSingle()
  let managerName = managerMembershipId === "__unassigned__" ? "미배정" : managerMembershipId.slice(0, 8)
  if (mgrFilter) {
    const { data: mgrRow } = await supabase.from("managers").select("name").eq("membership_id", mgrFilter).maybeSingle()
    if (mgrRow?.name) managerName = mgrRow.name
  }

  // Owner 는 개별 스태프 payout 비노출 (CLAUDE.md L140-142). price_amount
  // 과 time_minutes 만으로 "누구에게 얼마 청구" 축의 trace 만 전달.
  const isOwner = auth.role === "owner"
  const hostesses = allP.map(p => ({
    participant_id: p.id,
    session_id: p.session_id,
    direction: p.direction,
    membership_id: p.membership_id,
    hostess_name:
      (p.membership_id ? hNameMap.get(p.membership_id) : null) ||
      p.external_name ||
      null,
    room_name: roomNameMap.get(p.session_id) || null,
    category: p.category,
    time_minutes: p.time_minutes,
    price_amount: p.price_amount,
    ...(isOwner ? {} : { hostess_payout: p.hostess_payout_amount }),
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
