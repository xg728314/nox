/**
 * Visualize seed — populate test data for /super-admin/visualize/network
 * verification. READ-WRITE script (DB inserts), but ONLY against rows
 * keyed by deterministic test UUIDs / `@nox-seed.test` emails.
 *
 * Operational data is NOT touched: every INSERT either uses a pre-
 * declared test UUID or scopes by `store_uuid IN test_stores`.
 *
 * Idempotency:
 *   - Core (auth/profiles/stores/settings/service_types/rooms/
 *     memberships/managers/hostesses/operating_days): idempotent — looks
 *     up existing rows by deterministic key first.
 *   - Transactional (sessions/participants/orders/receipts/settlements/
 *     items/payouts/cross-store/audits): all-or-nothing. If ANY existing
 *     room_sessions exist for test stores, the script aborts with
 *     "already seeded — run cleanup first" so we never produce
 *     half-finished states.
 *
 * Run:   npx tsx scripts/visualize-seed/seed.ts
 * Env:   NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { getBusinessDateForOps } from "../../lib/time/businessDate"
import {
  TEST_ACCOUNTS,
  TEST_EMAIL_DOMAIN,
  TEST_NOTE_PREFIX,
  TEST_PASSWORD,
  TEST_ROOMS,
  TEST_SERVICE_TYPES,
  TEST_STORE_A_UUID,
  TEST_STORE_B_UUID,
  TEST_STORE_UUIDS,
  TEST_STORES,
  type TestAccount,
} from "./constants"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "[seed] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in your shell or .env.local before running.",
  )
  process.exit(1)
}

type AccountResolved = TestAccount & {
  user_id: string
  membership_id: string
}

function log(msg: string) {
  // eslint-disable-next-line no-console
  console.log(`[seed] ${msg}`)
}

function warn(msg: string) {
  // eslint-disable-next-line no-console
  console.warn(`[seed] WARN ${msg}`)
}

function abort(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(`[seed] ABORT ${msg}`)
  process.exit(1)
}

// ─── 1. auth users + profiles ───────────────────────────────────────

async function getOrCreateAuthUser(
  supabase: SupabaseClient,
  email: string,
  fullName: string,
): Promise<string> {
  // Pagination: listUsers default page size is 50; we only have 6.
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers()
  if (listErr) throw new Error(`listUsers failed: ${listErr.message}`)
  const existing = list.users.find((u) => u.email === email)
  if (existing) {
    log(`auth user reuse: ${email} (${existing.id})`)
    return existing.id
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName, seed: "visualize-test" },
  })
  if (error || !data.user) {
    throw new Error(`createUser(${email}) failed: ${error?.message}`)
  }
  log(`auth user created: ${email} (${data.user.id})`)
  return data.user.id
}

async function upsertProfile(
  supabase: SupabaseClient,
  id: string,
  fullName: string,
  nickname: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .upsert(
      { id, full_name: fullName, nickname, is_active: true },
      { onConflict: "id" },
    )
  if (error) throw new Error(`upsertProfile(${id}) failed: ${error.message}`)
}

// ─── 2. stores ───────────────────────────────────────────────────────

async function ensureStores(supabase: SupabaseClient): Promise<void> {
  for (const s of TEST_STORES) {
    const { data: existing } = await supabase
      .from("stores")
      .select("id")
      .eq("id", s.id)
      .maybeSingle()
    if (existing) {
      log(`store reuse: ${s.store_code} ${s.id}`)
      continue
    }
    const { error } = await supabase.from("stores").insert({
      id: s.id,
      store_name: s.store_name,
      store_code: s.store_code,
      floor: s.floor,
      is_active: true,
    })
    if (error) throw new Error(`insert store ${s.store_code} failed: ${error.message}`)
    log(`store created: ${s.store_code} ${s.id}`)
  }
}

async function ensureStoreSettings(supabase: SupabaseClient): Promise<void> {
  for (const s of TEST_STORES) {
    const { data: existing } = await supabase
      .from("store_settings")
      .select("id")
      .eq("store_uuid", s.id)
      .is("deleted_at", null)
      .maybeSingle()
    if (existing) continue
    const { error } = await supabase.from("store_settings").insert({
      store_uuid: s.id,
      // schema defaults are sane; explicit values for clarity:
      tc_rate: 0.2,
      manager_payout_rate: 0.7,
      hostess_payout_rate: 0.1,
      payout_basis: "netOfTC",
      rounding_unit: 1000,
    })
    if (error) throw new Error(`insert store_settings(${s.store_code}) failed: ${error.message}`)
    log(`store_settings created: ${s.store_code}`)
  }
}

async function ensureServiceTypes(supabase: SupabaseClient): Promise<void> {
  for (const s of TEST_STORES) {
    for (const st of TEST_SERVICE_TYPES) {
      const { data: existing } = await supabase
        .from("store_service_types")
        .select("id")
        .eq("store_uuid", s.id)
        .eq("service_type", st.service_type)
        .eq("time_type", st.time_type)
        .maybeSingle()
      if (existing) continue
      const { error } = await supabase.from("store_service_types").insert({
        store_uuid: s.id,
        service_type: st.service_type,
        time_type: st.time_type,
        time_minutes: st.time_minutes,
        price: st.price,
        manager_deduction: st.manager_deduction,
        has_greeting_check: false,
        sort_order: 0,
        is_active: true,
      })
      if (error) throw new Error(`insert service_type(${s.store_code}) failed: ${error.message}`)
      log(`store_service_types created: ${s.store_code} / ${st.service_type}`)
    }
  }
}

// ─── 3. rooms ────────────────────────────────────────────────────────

async function ensureRooms(
  supabase: SupabaseClient,
): Promise<Map<string, string>> {
  // key: `${store_uuid}:${room_no}` → room_uuid
  const map = new Map<string, string>()
  for (const r of TEST_ROOMS) {
    const key = `${r.store_uuid}:${r.room_no}`
    const { data: existing } = await supabase
      .from("rooms")
      .select("id")
      .eq("store_uuid", r.store_uuid)
      .eq("room_no", r.room_no)
      .is("deleted_at", null)
      .maybeSingle()
    if (existing) {
      map.set(key, existing.id as string)
      continue
    }
    const { data, error } = await supabase
      .from("rooms")
      .insert({
        store_uuid: r.store_uuid,
        room_no: r.room_no,
        room_name: r.room_name,
        floor_no: r.floor_no,
        sort_order: r.sort_order,
        is_active: true,
      })
      .select("id")
      .single()
    if (error || !data) {
      throw new Error(`insert room(${r.store_uuid}/${r.room_no}) failed: ${error?.message}`)
    }
    map.set(key, data.id as string)
    log(`room created: ${r.room_name}`)
  }
  return map
}

// ─── 4. memberships + display rows ──────────────────────────────────

async function ensureAccount(
  supabase: SupabaseClient,
  acc: TestAccount,
): Promise<AccountResolved> {
  const userId = await getOrCreateAuthUser(supabase, acc.email, acc.full_name)
  await upsertProfile(supabase, userId, acc.full_name, acc.nickname)

  // store_memberships — match by (profile_id, store_uuid, role).
  const { data: existingMem } = await supabase
    .from("store_memberships")
    .select("id")
    .eq("profile_id", userId)
    .eq("store_uuid", acc.store_uuid)
    .eq("role", acc.role)
    .is("deleted_at", null)
    .maybeSingle()

  let membershipId: string
  if (existingMem) {
    membershipId = existingMem.id as string
  } else {
    const { data, error } = await supabase
      .from("store_memberships")
      .insert({
        profile_id: userId,
        store_uuid: acc.store_uuid,
        role: acc.role,
        status: "approved",
        is_primary: true,
      })
      .select("id")
      .single()
    if (error || !data) {
      throw new Error(`insert membership(${acc.email}) failed: ${error?.message}`)
    }
    membershipId = data.id as string
    log(`membership created: ${acc.email} → ${acc.role}@${acc.store_uuid}`)
  }
  return { ...acc, user_id: userId, membership_id: membershipId }
}

async function ensureManagerRow(
  supabase: SupabaseClient,
  acc: AccountResolved,
): Promise<void> {
  const { data: existing } = await supabase
    .from("managers")
    .select("id")
    .eq("membership_id", acc.membership_id)
    .is("deleted_at", null)
    .maybeSingle()
  if (existing) return
  const { error } = await supabase.from("managers").insert({
    store_uuid: acc.store_uuid,
    membership_id: acc.membership_id,
    name: acc.full_name,
    nickname: acc.nickname,
    is_active: true,
  })
  if (error) throw new Error(`insert managers(${acc.email}) failed: ${error.message}`)
  log(`managers row created: ${acc.email}`)
}

async function ensureHostessRow(
  supabase: SupabaseClient,
  acc: AccountResolved,
  managerMembershipId: string | null,
): Promise<void> {
  const { data: existing } = await supabase
    .from("hostesses")
    .select("id")
    .eq("membership_id", acc.membership_id)
    .is("deleted_at", null)
    .maybeSingle()
  if (existing) return
  const { error } = await supabase.from("hostesses").insert({
    store_uuid: acc.store_uuid,
    membership_id: acc.membership_id,
    manager_membership_id: managerMembershipId,
    name: acc.full_name,
    stage_name: acc.stage_name,
    is_active: true,
  })
  if (error) throw new Error(`insert hostesses(${acc.email}) failed: ${error.message}`)
  log(`hostesses row created: ${acc.email}`)
}

// ─── 5. operating days ──────────────────────────────────────────────

async function ensureOperatingDays(
  supabase: SupabaseClient,
  openedBy: string,
): Promise<Map<string, string>> {
  const today = getBusinessDateForOps()
  const map = new Map<string, string>()
  for (const s of TEST_STORES) {
    const { data: existing } = await supabase
      .from("store_operating_days")
      .select("id")
      .eq("store_uuid", s.id)
      .eq("business_date", today)
      .is("deleted_at", null)
      .maybeSingle()
    if (existing) {
      map.set(s.id, existing.id as string)
      continue
    }
    const { data, error } = await supabase
      .from("store_operating_days")
      .insert({
        store_uuid: s.id,
        business_date: today,
        status: "open",
        opened_by: openedBy,
      })
      .select("id")
      .single()
    if (error || !data) {
      throw new Error(`insert operating_day(${s.store_code}) failed: ${error?.message}`)
    }
    map.set(s.id, data.id as string)
    log(`operating_day created: ${s.store_code} / ${today}`)
  }
  return map
}

// ─── 6. transactional layer ─────────────────────────────────────────

async function alreadyHasSessions(supabase: SupabaseClient): Promise<boolean> {
  const { count, error } = await supabase
    .from("room_sessions")
    .select("id", { count: "exact", head: true })
    .in("store_uuid", TEST_STORE_UUIDS)
  if (error) {
    warn(`session pre-check failed: ${error.message}`)
    return false
  }
  return (count ?? 0) > 0
}

type SessionRef = {
  id: string
  store_uuid: string
  room_uuid: string
  business_day_id: string
  participantIds: string[]
}

async function createSessions(
  supabase: SupabaseClient,
  rooms: Map<string, string>,
  operatingDays: Map<string, string>,
  managerA: string,
  managerB: string,
  openedBy: string,
): Promise<{ s1: SessionRef; s2: SessionRef; s3: SessionRef }> {
  const now = new Date()
  const t = (offsetMin: number) =>
    new Date(now.getTime() + offsetMin * 60_000).toISOString()
  function unwrap(key: string, label: string): string {
    const v = key.startsWith("op:") ? operatingDays.get(key.slice(3)) : rooms.get(key)
    if (!v) throw new Error(`missing ${label} for key ${key}`)
    return v
  }

  // Sessions are inserted with status='active' (no ended_at, no closed_by)
  // because production has a DB trigger
  // (`SESSION_NOT_ACTIVE_PARTICIPANT_WRITE`) that rejects participant
  // inserts on closed sessions. After participants/orders are seeded,
  // `closeSessions` flips them to 'closed' with realistic timestamps.
  const s1Insert = {
    store_uuid: TEST_STORE_A_UUID,
    room_uuid: unwrap(`${TEST_STORE_A_UUID}:1`, "rooms"),
    business_day_id: unwrap(`op:${TEST_STORE_A_UUID}`, "operating_day"),
    status: "active",
    started_at: t(-180),
    opened_by: openedBy,
    notes: `${TEST_NOTE_PREFIX} session 1 — store A`,
  }
  const s2Insert = {
    store_uuid: TEST_STORE_A_UUID,
    room_uuid: unwrap(`${TEST_STORE_A_UUID}:2`, "rooms"),
    business_day_id: unwrap(`op:${TEST_STORE_A_UUID}`, "operating_day"),
    status: "active",
    started_at: t(-120),
    opened_by: openedBy,
    notes: `${TEST_NOTE_PREFIX} session 2 — store A`,
  }
  const s3Insert = {
    store_uuid: TEST_STORE_B_UUID,
    room_uuid: unwrap(`${TEST_STORE_B_UUID}:1`, "rooms"),
    business_day_id: unwrap(`op:${TEST_STORE_B_UUID}`, "operating_day"),
    status: "active",
    started_at: t(-90),
    opened_by: openedBy,
    notes: `${TEST_NOTE_PREFIX} session 3 — store B (cross-store)`,
  }
  const { data, error } = await supabase
    .from("room_sessions")
    .insert([s1Insert, s2Insert, s3Insert])
    .select("id, store_uuid, room_uuid, business_day_id")
  if (error || !data) throw new Error(`insert room_sessions failed: ${error?.message}`)
  log(`room_sessions created: ${data.length} rows`)

  const ref = (i: number): SessionRef => ({
    id: data[i].id as string,
    store_uuid: data[i].store_uuid as string,
    room_uuid: data[i].room_uuid as string,
    business_day_id: data[i].business_day_id as string,
    participantIds: [],
  })
  // Suppress unused-var warning for managers (referenced for clarity).
  void managerA
  void managerB
  return { s1: ref(0), s2: ref(1), s3: ref(2) }
}

/**
 * Flip the seeded sessions to status='closed' once participants/orders
 * are in. The trigger blocks participant inserts on closed sessions, so
 * we have to insert while active and close afterwards.
 */
async function closeSessions(
  supabase: SupabaseClient,
  sessions: { s1: SessionRef; s2: SessionRef; s3: SessionRef },
  closedBy: string,
): Promise<void> {
  const ids = [sessions.s1.id, sessions.s2.id, sessions.s3.id]
  const { error } = await supabase
    .from("room_sessions")
    .update({
      status: "closed",
      ended_at: new Date().toISOString(),
      closed_by: closedBy,
    })
    .in("id", ids)
  if (error) throw new Error(`closeSessions failed: ${error.message}`)
  log(`room_sessions closed: ${ids.length}`)
}

/**
 * For the cross-store participant (hostess A2 working at B), production
 * has a DB trigger that requires `session_participants.transfer_request_id`
 * to be set when origin_store_uuid != store_uuid. We pre-create an
 * approved transfer_request and link it.
 */
async function createTransferRequest(
  supabase: SupabaseClient,
  hostessMembershipId: string,
  fromStoreUuid: string,
  toStoreUuid: string,
  businessDayId: string,
  approverProfileId: string,
): Promise<string> {
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from("transfer_requests")
    .insert({
      hostess_membership_id: hostessMembershipId,
      from_store_uuid: fromStoreUuid,
      to_store_uuid: toStoreUuid,
      business_day_id: businessDayId,
      status: "approved",
      from_store_approved_by: approverProfileId,
      from_store_approved_at: nowIso,
      to_store_approved_by: approverProfileId,
      to_store_approved_at: nowIso,
      reason: `${TEST_NOTE_PREFIX} 타매장 근무 승인 (A → B)`,
    })
    .select("id")
    .single()
  if (error || !data) {
    throw new Error(`insert transfer_request failed: ${error?.message}`)
  }
  log(`transfer_request created: ${data.id}`)
  return data.id as string
}

async function createParticipants(
  supabase: SupabaseClient,
  sessions: { s1: SessionRef; s2: SessionRef; s3: SessionRef },
  hostessA1: AccountResolved,
  hostessA2: AccountResolved,
  hostessB1: AccountResolved,
  managerA: AccountResolved,
  managerB: AccountResolved,
  crossStoreTransferRequestId: string,
): Promise<void> {
  const { s1, s2, s3 } = sessions

  // Pricing: 130k base × {1, 1, 1, 1, 1} → manager 91k / hostess 13k / margin 26k
  // simplified per service_type seeded above.
  // session_participants.status enum (production check constraint):
  // 'active' | 'left'. We insert 'active' (parent session is still
  // 'active' at this point) and rely on closeSessions() to flip the
  // parent — visualize edges use deleted_at IS NULL only, ignoring
  // participant.status, so leaving them 'active' is fine.
  const base = {
    role: "hostess",
    category: "퍼블릭",
    time_minutes: 90,
    price_amount: 130_000,
    manager_payout_amount: 91_000,
    hostess_payout_amount: 13_000,
    margin_amount: 26_000,
    status: "active",
  }

  const rows = [
    // s1: A's hostess A1 (managed by manager A)
    {
      ...base,
      session_id: s1.id,
      store_uuid: s1.store_uuid,
      membership_id: hostessA1.membership_id,
      manager_membership_id: managerA.membership_id,
      origin_store_uuid: TEST_STORE_A_UUID,
      entered_at: new Date(Date.now() - 170 * 60_000).toISOString(),
      left_at: new Date(Date.now() - 80 * 60_000).toISOString(),
    },
    // s1: A's hostess A2
    {
      ...base,
      session_id: s1.id,
      store_uuid: s1.store_uuid,
      membership_id: hostessA2.membership_id,
      manager_membership_id: managerA.membership_id,
      origin_store_uuid: TEST_STORE_A_UUID,
      entered_at: new Date(Date.now() - 165 * 60_000).toISOString(),
      left_at: new Date(Date.now() - 75 * 60_000).toISOString(),
    },
    // s2: A's hostess A1 again
    {
      ...base,
      session_id: s2.id,
      store_uuid: s2.store_uuid,
      membership_id: hostessA1.membership_id,
      manager_membership_id: managerA.membership_id,
      origin_store_uuid: TEST_STORE_A_UUID,
      entered_at: new Date(Date.now() - 110 * 60_000).toISOString(),
      left_at: new Date(Date.now() - 40 * 60_000).toISOString(),
    },
    // s3: B's hostess B1
    {
      ...base,
      session_id: s3.id,
      store_uuid: s3.store_uuid,
      membership_id: hostessB1.membership_id,
      manager_membership_id: managerB.membership_id,
      origin_store_uuid: TEST_STORE_B_UUID,
      entered_at: new Date(Date.now() - 80 * 60_000).toISOString(),
      left_at: new Date(Date.now() - 25 * 60_000).toISOString(),
    },
    // s3: A's hostess A2 working AT B (cross-store) — origin = A, store = B.
    // Production DB trigger requires `transfer_request_id` to be set
    // when origin_store_uuid != store_uuid.
    {
      ...base,
      session_id: s3.id,
      store_uuid: s3.store_uuid,
      membership_id: hostessA2.membership_id,
      manager_membership_id: managerB.membership_id, // working store's manager
      origin_store_uuid: TEST_STORE_A_UUID,
      transfer_request_id: crossStoreTransferRequestId,
      entered_at: new Date(Date.now() - 80 * 60_000).toISOString(),
      left_at: new Date(Date.now() - 25 * 60_000).toISOString(),
      memo: `${TEST_NOTE_PREFIX} 타매장 근무 (origin=A, working=B)`,
    },
  ]
  const { data, error } = await supabase
    .from("session_participants")
    .insert(rows)
    .select("id, session_id")
  if (error || !data) throw new Error(`insert session_participants failed: ${error?.message}`)
  log(`session_participants created: ${data.length} rows`)
  for (const row of data) {
    if (row.session_id === s1.id) s1.participantIds.push(row.id as string)
    else if (row.session_id === s2.id) s2.participantIds.push(row.id as string)
    else if (row.session_id === s3.id) s3.participantIds.push(row.id as string)
  }
}

async function createOrders(
  supabase: SupabaseClient,
  sessions: { s1: SessionRef; s2: SessionRef; s3: SessionRef },
  orderedBy: string,
): Promise<void> {
  const rows = [
    {
      session_id: sessions.s1.id,
      store_uuid: sessions.s1.store_uuid,
      business_day_id: sessions.s1.business_day_id,
      item_name: "발렌타인 17년",
      order_type: "양주",
      qty: 1,
      unit_price: 350_000,
      ordered_by: orderedBy,
      notes: `${TEST_NOTE_PREFIX} order`,
    },
    {
      session_id: sessions.s2.id,
      store_uuid: sessions.s2.store_uuid,
      business_day_id: sessions.s2.business_day_id,
      item_name: "과일안주",
      order_type: "안주",
      qty: 1,
      unit_price: 50_000,
      ordered_by: orderedBy,
      notes: `${TEST_NOTE_PREFIX} order`,
    },
    {
      session_id: sessions.s3.id,
      store_uuid: sessions.s3.store_uuid,
      business_day_id: sessions.s3.business_day_id,
      item_name: "웨이터팁",
      order_type: "팁",
      qty: 1,
      unit_price: 30_000,
      ordered_by: orderedBy,
      notes: `${TEST_NOTE_PREFIX} order`,
    },
  ]
  const { error } = await supabase.from("orders").insert(rows)
  if (error) throw new Error(`insert orders failed: ${error.message}`)
  log(`orders created: ${rows.length}`)
}

async function createReceipts(
  supabase: SupabaseClient,
  sessions: { s1: SessionRef; s2: SessionRef; s3: SessionRef },
  finalizedBy: string,
): Promise<void> {
  const nowIso = new Date().toISOString()
  const rows = [
    {
      session_id: sessions.s1.id,
      store_uuid: sessions.s1.store_uuid,
      business_day_id: sessions.s1.business_day_id,
      version: 1,
      gross_total: 610_000, // 350k order + 260k participants (130k×2)
      tc_amount: 122_000,
      manager_amount: 182_000,
      hostess_amount: 26_000,
      margin_amount: 280_000,
      order_total_amount: 350_000,
      participant_total_amount: 260_000,
      discount_amount: 0,
      service_amount: 0,
      status: "finalized",
      finalized_at: nowIso,
      finalized_by: finalizedBy,
      snapshot: { source: TEST_NOTE_PREFIX, session: 1 },
    },
    {
      session_id: sessions.s2.id,
      store_uuid: sessions.s2.store_uuid,
      business_day_id: sessions.s2.business_day_id,
      version: 1,
      gross_total: 180_000,
      tc_amount: 36_000,
      manager_amount: 91_000,
      hostess_amount: 13_000,
      margin_amount: 40_000,
      order_total_amount: 50_000,
      participant_total_amount: 130_000,
      discount_amount: 0,
      service_amount: 0,
      status: "finalized",
      finalized_at: nowIso,
      finalized_by: finalizedBy,
      snapshot: { source: TEST_NOTE_PREFIX, session: 2 },
    },
    {
      session_id: sessions.s3.id,
      store_uuid: sessions.s3.store_uuid,
      business_day_id: sessions.s3.business_day_id,
      version: 1,
      gross_total: 290_000,
      tc_amount: 0,
      manager_amount: 0,
      hostess_amount: 0,
      margin_amount: 0,
      order_total_amount: 30_000,
      participant_total_amount: 260_000,
      discount_amount: 0,
      service_amount: 0,
      status: "draft",
      snapshot: { source: TEST_NOTE_PREFIX, session: 3, note: "draft (cross-store)" },
    },
  ]
  const { error } = await supabase.from("receipts").insert(rows)
  if (error) throw new Error(`insert receipts failed: ${error.message}`)
  log(`receipts created: ${rows.length} (2 finalized + 1 draft)`)
}

type SettlementRefs = {
  settlement1Id: string
  settlement2Id: string
  managerItem1Id: string
  hostessItem1Id: string
  managerItem2Id: string
  hostessItem2Id: string
}

async function createSettlements(
  supabase: SupabaseClient,
  sessions: { s1: SessionRef; s2: SessionRef; s3: SessionRef },
  managerA: AccountResolved,
  hostessA1: AccountResolved,
  hostessA2: AccountResolved,
): Promise<SettlementRefs> {
  const settlementRows = [
    {
      store_uuid: TEST_STORE_A_UUID,
      session_id: sessions.s1.id,
      status: "confirmed",
      total_amount: 610_000,
      manager_amount: 182_000,
      hostess_amount: 26_000,
      store_amount: 280_000,
      confirmed_at: new Date().toISOString(),
    },
    {
      store_uuid: TEST_STORE_A_UUID,
      session_id: sessions.s2.id,
      status: "confirmed",
      total_amount: 180_000,
      manager_amount: 91_000,
      hostess_amount: 13_000,
      store_amount: 40_000,
      confirmed_at: new Date().toISOString(),
    },
  ]
  const { data: setts, error: setErr } = await supabase
    .from("settlements")
    .insert(settlementRows)
    .select("id")
  if (setErr || !setts) throw new Error(`insert settlements failed: ${setErr?.message}`)
  const [settlement1, settlement2] = setts
  log(`settlements created: ${setts.length}`)

  const itemRows = [
    // Settlement 1
    {
      settlement_id: settlement1.id,
      store_uuid: TEST_STORE_A_UUID,
      role_type: "manager",
      amount: 182_000,
      membership_id: managerA.membership_id,
      note: `${TEST_NOTE_PREFIX} item`,
    },
    {
      settlement_id: settlement1.id,
      store_uuid: TEST_STORE_A_UUID,
      role_type: "hostess",
      amount: 13_000,
      membership_id: hostessA1.membership_id,
      participant_id: sessions.s1.participantIds[0] ?? null,
      note: `${TEST_NOTE_PREFIX} item`,
    },
    {
      settlement_id: settlement1.id,
      store_uuid: TEST_STORE_A_UUID,
      role_type: "hostess",
      amount: 13_000,
      membership_id: hostessA2.membership_id,
      participant_id: sessions.s1.participantIds[1] ?? null,
      note: `${TEST_NOTE_PREFIX} item`,
    },
    {
      settlement_id: settlement1.id,
      store_uuid: TEST_STORE_A_UUID,
      role_type: "store",
      amount: 280_000,
      note: `${TEST_NOTE_PREFIX} item`,
    },
    // Settlement 2
    {
      settlement_id: settlement2.id,
      store_uuid: TEST_STORE_A_UUID,
      role_type: "manager",
      amount: 91_000,
      membership_id: managerA.membership_id,
      note: `${TEST_NOTE_PREFIX} item`,
    },
    {
      settlement_id: settlement2.id,
      store_uuid: TEST_STORE_A_UUID,
      role_type: "hostess",
      amount: 13_000,
      membership_id: hostessA1.membership_id,
      participant_id: sessions.s2.participantIds[0] ?? null,
      note: `${TEST_NOTE_PREFIX} item`,
    },
    {
      settlement_id: settlement2.id,
      store_uuid: TEST_STORE_A_UUID,
      role_type: "store",
      amount: 40_000,
      note: `${TEST_NOTE_PREFIX} item`,
    },
  ]
  const { data: items, error: itemErr } = await supabase
    .from("settlement_items")
    .insert(itemRows)
    .select("id, settlement_id, role_type, membership_id")
  if (itemErr || !items) throw new Error(`insert settlement_items failed: ${itemErr?.message}`)
  log(`settlement_items created: ${items.length}`)

  const find = (
    settlementId: string,
    role: string,
    membershipId?: string,
  ): string => {
    const hit = items.find(
      (it) =>
        it.settlement_id === settlementId &&
        it.role_type === role &&
        (membershipId == null || it.membership_id === membershipId),
    )
    if (!hit) throw new Error(`item not found: ${settlementId}/${role}`)
    return hit.id as string
  }

  return {
    settlement1Id: settlement1.id as string,
    settlement2Id: settlement2.id as string,
    managerItem1Id: find(settlement1.id as string, "manager", managerA.membership_id),
    hostessItem1Id: find(settlement1.id as string, "hostess", hostessA1.membership_id),
    managerItem2Id: find(settlement2.id as string, "manager", managerA.membership_id),
    hostessItem2Id: find(settlement2.id as string, "hostess", hostessA1.membership_id),
  }
}

async function createPayouts(
  supabase: SupabaseClient,
  refs: SettlementRefs,
  managerA: AccountResolved,
  hostessA1: AccountResolved,
): Promise<{ approvedIds: string[]; rejectedId: string }> {
  // Production constraints (post 037+038):
  //   chk_payout_records_status         IN (pending, completed, cancelled)
  //   chk_payout_records_payout_type    IN (full, partial, prepayment, cross_store_prepay, reversal)
  //   chk_payout_records_recipient_type IN (hostess, manager)
  // We use status='completed' + payout_type='full' for normal payouts,
  // and payout_type='reversal' (with status='completed') for the
  // visualize "risk" signal. That maps to NetworkStatus='risk' in
  // network.ts via PAYOUT_RISK_TYPES.
  const nowIso = new Date().toISOString()
  const rows = [
    // Settlement 1: both items completed (normal).
    {
      store_uuid: TEST_STORE_A_UUID,
      settlement_id: refs.settlement1Id,
      settlement_item_id: refs.managerItem1Id,
      recipient_type: "manager",
      recipient_membership_id: managerA.membership_id,
      amount: 182_000,
      currency: "KRW",
      payout_type: "full",
      status: "completed",
      completed_at: nowIso,
      paid_at: nowIso,
      memo: `${TEST_NOTE_PREFIX} payout`,
    },
    {
      store_uuid: TEST_STORE_A_UUID,
      settlement_id: refs.settlement1Id,
      settlement_item_id: refs.hostessItem1Id,
      recipient_type: "hostess",
      recipient_membership_id: hostessA1.membership_id,
      amount: 13_000,
      currency: "KRW",
      payout_type: "full",
      status: "completed",
      completed_at: nowIso,
      paid_at: nowIso,
      memo: `${TEST_NOTE_PREFIX} payout`,
    },
    // Settlement 2: hostess completed.
    {
      store_uuid: TEST_STORE_A_UUID,
      settlement_id: refs.settlement2Id,
      settlement_item_id: refs.hostessItem2Id,
      recipient_type: "hostess",
      recipient_membership_id: hostessA1.membership_id,
      amount: 13_000,
      currency: "KRW",
      payout_type: "full",
      status: "completed",
      completed_at: nowIso,
      paid_at: nowIso,
      memo: `${TEST_NOTE_PREFIX} payout`,
    },
    // Settlement 2: reversal (risk signal — payout_type='reversal').
    {
      store_uuid: TEST_STORE_A_UUID,
      settlement_id: refs.settlement2Id,
      settlement_item_id: refs.managerItem2Id,
      recipient_type: "manager",
      recipient_membership_id: managerA.membership_id,
      amount: 91_000,
      currency: "KRW",
      payout_type: "reversal",
      status: "completed",
      completed_at: nowIso,
      paid_at: nowIso,
      memo: `${TEST_NOTE_PREFIX} payout — reversal for review`,
    },
  ]
  const { data, error } = await supabase
    .from("payout_records")
    .insert(rows)
    .select("id, payout_type, status")
  if (error || !data) throw new Error(`insert payout_records failed: ${error?.message}`)
  log(`payout_records created: ${data.length} (3 full + 1 reversal)`)
  const approvedIds = data
    .filter((d) => d.payout_type === "full")
    .map((d) => d.id as string)
  const rejectedId = data.find((d) => d.payout_type === "reversal")?.id as string
  return { approvedIds, rejectedId }
}

async function createCrossStore(
  supabase: SupabaseClient,
  managerA: AccountResolved,
  ownerA: AccountResolved,
): Promise<void> {
  // B (debtor / from_store_uuid) → A (creditor / to_store_uuid).
  // Reflects hostess A2 working at B.
  //
  // Schema migration 038 dropped legacy columns store_uuid /
  // target_store_uuid / note from cross_store_settlements; current
  // columns are from_store_uuid / to_store_uuid / memo. The items
  // table kept store_uuid / target_store_uuid but renamed
  // target_manager_membership_id → manager_membership_id and
  // assigned_amount → amount, prepaid_amount → paid_amount.
  const { data: header, error } = await supabase
    .from("cross_store_settlements")
    .insert({
      from_store_uuid: TEST_STORE_B_UUID,
      to_store_uuid: TEST_STORE_A_UUID,
      total_amount: 50_000,
      prepaid_amount: 0,
      remaining_amount: 50_000,
      status: "open",
      memo: `${TEST_NOTE_PREFIX} B 가 A 에게 송금할 금액`,
      created_by: ownerA.user_id,
    })
    .select("id")
    .single()
  if (error || !header) throw new Error(`insert cross_store_settlements failed: ${error?.message}`)

  const { error: itemErr } = await supabase
    .from("cross_store_settlement_items")
    .insert({
      cross_store_settlement_id: header.id,
      store_uuid: TEST_STORE_B_UUID,
      target_store_uuid: TEST_STORE_A_UUID,
      manager_membership_id: managerA.membership_id,
      amount: 50_000,
      paid_amount: 0,
      remaining_amount: 50_000,
      status: "open",
      note: `${TEST_NOTE_PREFIX} A 매장 매니저(${managerA.email}) 에게 분배`,
    })
  if (itemErr) throw new Error(`insert cross_store_settlement_items failed: ${itemErr.message}`)
  log(`cross_store_settlements + items created`)
}

async function createAuditEvents(
  supabase: SupabaseClient,
  sessions: { s1: SessionRef; s2: SessionRef; s3: SessionRef },
  refs: SettlementRefs,
  payouts: { approvedIds: string[]; rejectedId: string },
  managerA: AccountResolved,
  managerB: AccountResolved,
): Promise<void> {
  const rows = [
    // 1. settlement_finalize × 2 (normal, approved_by edge)
    {
      store_uuid: TEST_STORE_A_UUID,
      actor_profile_id: managerA.user_id,
      actor_membership_id: managerA.membership_id,
      actor_role: "manager",
      actor_type: "test_seed",
      session_id: sessions.s1.id,
      entity_table: "settlements",
      entity_id: refs.settlement1Id,
      action: "settlement_finalize",
      after: { status: "success" },
      reason: `${TEST_NOTE_PREFIX} finalize`,
    },
    {
      store_uuid: TEST_STORE_A_UUID,
      actor_profile_id: managerA.user_id,
      actor_membership_id: managerA.membership_id,
      actor_role: "manager",
      actor_type: "test_seed",
      session_id: sessions.s2.id,
      entity_table: "settlements",
      entity_id: refs.settlement2Id,
      action: "settlement_finalize",
      after: { status: "success" },
      reason: `${TEST_NOTE_PREFIX} finalize`,
    },
    // 2. settlement_edit (warning, edited_by edge)
    {
      store_uuid: TEST_STORE_A_UUID,
      actor_profile_id: managerA.user_id,
      actor_membership_id: managerA.membership_id,
      actor_role: "manager",
      actor_type: "test_seed",
      entity_table: "settlements",
      entity_id: refs.settlement1Id,
      action: "settlement_edit",
      after: { status: "success", reason: "amount adjusted" },
      reason: `${TEST_NOTE_PREFIX} edited tip share`,
    },
    // 3. payout_reject (risk)
    {
      store_uuid: TEST_STORE_A_UUID,
      actor_profile_id: managerA.user_id,
      actor_membership_id: managerA.membership_id,
      actor_role: "manager",
      actor_type: "test_seed",
      entity_table: "payout_records",
      entity_id: payouts.rejectedId,
      action: "payout_reject",
      after: { status: "success" },
      reason: `${TEST_NOTE_PREFIX} reviewer rejected`,
    },
    // 4. participant_force_leave (warning, hidden by default audit_categories)
    {
      store_uuid: TEST_STORE_B_UUID,
      actor_profile_id: managerB.user_id,
      actor_membership_id: managerB.membership_id,
      actor_role: "manager",
      actor_type: "test_seed",
      session_id: sessions.s3.id,
      entity_table: "session_participants",
      entity_id: sessions.s3.participantIds[0] ?? sessions.s3.id,
      action: "participant_force_leave",
      after: { status: "success" },
      reason: `${TEST_NOTE_PREFIX} guest left early`,
    },
    // 5. override_price (warning)
    {
      store_uuid: TEST_STORE_A_UUID,
      actor_profile_id: managerA.user_id,
      actor_membership_id: managerA.membership_id,
      actor_role: "manager",
      actor_type: "test_seed",
      session_id: sessions.s1.id,
      entity_table: "session_participants",
      entity_id: sessions.s1.participantIds[0] ?? sessions.s1.id,
      action: "override_price",
      after: { status: "success", from: 130000, to: 130000 },
      reason: `${TEST_NOTE_PREFIX} manager override (no-op)`,
    },
    // 6. payout_approve (normal)
    {
      store_uuid: TEST_STORE_A_UUID,
      actor_profile_id: managerA.user_id,
      actor_membership_id: managerA.membership_id,
      actor_role: "manager",
      actor_type: "test_seed",
      entity_table: "payout_records",
      entity_id: payouts.approvedIds[0] ?? refs.settlement1Id,
      action: "payout_approve",
      after: { status: "success" },
      reason: `${TEST_NOTE_PREFIX} approved`,
    },
  ]
  const { error } = await supabase.from("audit_events").insert(rows)
  if (error) throw new Error(`insert audit_events failed: ${error.message}`)
  log(`audit_events created: ${rows.length}`)
}

// ─── main ────────────────────────────────────────────────────────────

async function main() {
  log(`SUPABASE_URL = ${SUPABASE_URL}`)
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // ── Step 0: collision guard ──────────────────────────────────────
  // If an unrelated row already occupies one of the test UUIDs, abort.
  // We INSERT only — never UPDATE — so an existing test row is fine
  // (idempotent reuse) but we still want to verify it's actually OUR
  // test marker, not someone else's coincidence.
  for (const s of TEST_STORES) {
    const { data } = await supabase
      .from("stores")
      .select("id, store_name, store_code")
      .eq("id", s.id)
      .maybeSingle()
    if (data && data.store_code !== s.store_code) {
      abort(
        `Store UUID ${s.id} is already taken by store_code='${data.store_code}' (expected '${s.store_code}'). Refusing to seed.`,
      )
    }
  }

  // ── Step 1: core (idempotent) ────────────────────────────────────
  await ensureStores(supabase)
  await ensureStoreSettings(supabase)
  await ensureServiceTypes(supabase)
  const rooms = await ensureRooms(supabase)

  // Resolve all accounts (auth + profile + membership).
  const resolved: Record<string, AccountResolved> = {}
  for (const acc of TEST_ACCOUNTS) {
    const r = await ensureAccount(supabase, acc)
    resolved[acc.email] = r
  }
  const ownerA = resolved[`owner-a${TEST_EMAIL_DOMAIN}`]
  const managerA = resolved[`manager-a${TEST_EMAIL_DOMAIN}`]
  const hostessA1 = resolved[`hostess-a1${TEST_EMAIL_DOMAIN}`]
  const hostessA2 = resolved[`hostess-a2${TEST_EMAIL_DOMAIN}`]
  const managerB = resolved[`manager-b${TEST_EMAIL_DOMAIN}`]
  const hostessB1 = resolved[`hostess-b1${TEST_EMAIL_DOMAIN}`]

  await ensureManagerRow(supabase, managerA)
  await ensureManagerRow(supabase, managerB)
  await ensureHostessRow(supabase, hostessA1, managerA.membership_id)
  await ensureHostessRow(supabase, hostessA2, managerA.membership_id)
  await ensureHostessRow(supabase, hostessB1, managerB.membership_id)

  const operatingDays = await ensureOperatingDays(supabase, ownerA.user_id)

  // ── Step 2: transactional (all-or-nothing) ───────────────────────
  if (await alreadyHasSessions(supabase)) {
    log("room_sessions already exist for test stores — skipping transactional layer.")
    log("Run cleanup first if you want a fresh transactional layer.")
    log("seed: DONE (core only — transactional skipped).")
    return
  }

  // Create sessions as 'active' so the participant trigger lets us
  // insert. Add participants + orders, then close the sessions, then
  // continue with receipts / settlements / payouts.
  const sessions = await createSessions(
    supabase,
    rooms,
    operatingDays,
    managerA.membership_id,
    managerB.membership_id,
    ownerA.user_id,
  )
  // Cross-store hostess A2 needs an approved transfer_request before
  // we can insert her participant row (DB trigger). We use store B's
  // operating day for the request since the work happens there.
  const xstoreBDay = operatingDays.get(TEST_STORE_B_UUID)
  if (!xstoreBDay) {
    abort("operating_days for store B missing — cannot create transfer_request.")
  }
  const transferRequestId = await createTransferRequest(
    supabase,
    hostessA2.membership_id,
    TEST_STORE_A_UUID,
    TEST_STORE_B_UUID,
    xstoreBDay,
    ownerA.user_id,
  )
  await createParticipants(
    supabase,
    sessions,
    hostessA1,
    hostessA2,
    hostessB1,
    managerA,
    managerB,
    transferRequestId,
  )
  await createOrders(supabase, sessions, ownerA.user_id)
  await closeSessions(supabase, sessions, ownerA.user_id)
  await createReceipts(supabase, sessions, ownerA.user_id)
  const refs = await createSettlements(
    supabase,
    sessions,
    managerA,
    hostessA1,
    hostessA2,
  )
  const payouts = await createPayouts(supabase, refs, managerA, hostessA1)
  await createCrossStore(supabase, managerA, ownerA)
  await createAuditEvents(supabase, sessions, refs, payouts, managerA, managerB)

  log("seed: DONE.")
  log(`stores: ${TEST_STORE_UUIDS.length}`)
  log(`accounts: ${TEST_ACCOUNTS.length} (${TEST_EMAIL_DOMAIN})`)
  log(`sessions: 3 (2 in A, 1 in B with cross-store hostess)`)
  log(`settlements: 2 / settlement_items: 7 / payouts: 4 (1 reversal)`)
  log(`cross_store: 1 (B → A, remaining 50000)`)
  log(`audit_events: 7`)
}

main().catch((e) => {
  console.error("[seed] FATAL", e)
  process.exit(1)
})
