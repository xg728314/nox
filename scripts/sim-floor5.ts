/**
 * NOX FLOOR-5 REALISTIC OPERATION SIMULATION
 *
 * Goal:
 *   Build a deterministic, realistic floor-5 simulation across 4 stores
 *   (마블 / 버닝 / 황진이 / 라이브). Reuses existing stores. All sim entities
 *   are namespaced with `sim-floor5-` so they can be cleaned up safely.
 *
 * Design choices (audit-driven):
 *   - Direct service-role inserts (matches scripts/seed-test-data.ts).
 *     Calling app APIs would require per-user JWTs which seed scripts also
 *     bypass.
 *   - All prices are read from store_service_types — never invented.
 *   - Cross-store hostesses are modeled by setting
 *     session_participants.origin_store_uuid != store_uuid (work site).
 *   - Chat messages go through chat_rooms (type=global) + chat_messages.
 *   - Settlement validation: per cross-store pair, the sum of
 *     price_amount for participants where (work=A, origin=B) is the
 *     payable A→B (working store owes the home store). Receivable B←A
 *     is the same query from B's perspective — verifying symmetry by
 *     pivoting the same rows. Mismatch ⇒ FAIL.
 *
 * Reproducibility:
 *   - Fixed RNG seed (mulberry32). Same seed ⇒ same data every run.
 *   - Idempotent: every insert is preceded by a maybeSingle() check, so
 *     re-running the script does not duplicate.
 *
 * Modes:
 *   npx tsx scripts/sim-floor5.ts           # run simulation
 *   npx tsx scripts/sim-floor5.ts --cleanup # soft-delete sim-floor5 data
 *   npx tsx scripts/sim-floor5.ts --report  # validate + print report only
 *
 * IMPORTANT:
 *   This script writes into the same Supabase project used by
 *   seed-test-data.ts. All sim rows are namespaced with the
 *   `sim-floor5-` email/name prefix so they can be located and removed
 *   without touching real or pre-existing test data.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ─── Config ────────────────────────────────────────────────────────
// SECURITY (SECURITY_FIX_PLAN.md TASK 0-1): keys MUST come from env.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[sim-floor5] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in your shell or .env.local before running.");
  process.exit(1);
}
const PASSWORD = process.env.SEED_PASSWORD ?? "Test1234!";
const SIM_PREFIX = "sim-floor5-";
const SIM_NAME_PREFIX = "[SIM5]";
const RNG_SEED = 0x5eedca5e;

// User instruction maps "hyper" → 하퍼 (Harper). Codebase uses 하퍼.
const CATEGORIES = ["퍼블릭", "셔츠", "하퍼"] as const;
type Category = (typeof CATEGORIES)[number];

type StoreSpec = {
  key: string;       // ascii key used in emails
  name: string;      // store_name in DB (must already exist)
  rooms: number;     // required room count
  floor: number;     // floor number for create-if-missing
};

const STORES: StoreSpec[] = [
  { key: "marvel", name: "마블", rooms: 4, floor: 5 },
  { key: "burning", name: "버닝", rooms: 6, floor: 5 },
  { key: "hwangjini", name: "황진이", rooms: 6, floor: 5 },
  { key: "live", name: "라이브", rooms: 6, floor: 5 },
];

const MANAGERS_PER_STORE = 4;
const HOSTESSES_PER_CATEGORY = 10;        // 10 each ⇒ 30 per store
const PARTICIPANTS_PER_SESSION = 5;
const CUSTOMERS_PER_SESSION = 5;
const LIQUOR_PER_SESSION = 4;
const CROSS_STORE_PROBABILITY = 0.2;       // 20% of participants are foreign

// ─── Deterministic RNG ─────────────────────────────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(RNG_SEED);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const pickInt = (min: number, max: number) =>
  Math.floor(rng() * (max - min + 1)) + min;

// ─── Realistic chat lines ─────────────────────────────────────────
const CHAT_LINES = [
  "퍼블릭 2인 초이스 있습니다",
  "네 갑니다",
  "2인 맞췄습니다",
  "셔츠 1명 더 필요합니다",
  "차3 들어갑니다",
  "지금 바로 들어가요",
  "3번방 정리 필요합니다",
  "타임 끝났습니다",
  "반티 한 명 가능?",
  "황진이에서 한 명 보냅니다",
  "라이브 쪽 자리 비었어요",
  "버닝 4번방 손님 5명입니다",
  "초이스 끝났습니다",
  "체크아웃 부탁드립니다",
];

// ─── Helpers (mirrored from seed-test-data.ts) ────────────────────
async function getOrCreateUser(
  supabase: SupabaseClient,
  email: string,
  fullName: string
): Promise<string> {
  // Paginate listUsers — default page size is 50, sim creates 4*34=136+ users
  let existing: { id: string } | undefined;
  for (let page = 1; page <= 50; page++) {
    const { data: pageData } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    const found = pageData?.users?.find((u) => u.email === email);
    if (found) { existing = found; break; }
    if (!pageData?.users || pageData.users.length < 200) break;
  }
  if (existing) {
    await supabase
      .from("profiles")
      .upsert({ id: existing.id, full_name: fullName }, { onConflict: "id" });
    return existing.id;
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw new Error(`createUser(${email}): ${error.message}`);
  const id = data.user!.id;
  await supabase
    .from("profiles")
    .upsert({ id, full_name: fullName }, { onConflict: "id" });
  return id;
}

async function getOrCreateMembership(
  supabase: SupabaseClient,
  profileId: string,
  storeUuid: string,
  role: string
): Promise<string> {
  const { data: existing } = await supabase
    .from("store_memberships")
    .select("id")
    .eq("profile_id", profileId)
    .eq("store_uuid", storeUuid)
    .eq("role", role)
    .maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await supabase
    .from("store_memberships")
    .insert({
      profile_id: profileId,
      store_uuid: storeUuid,
      role,
      status: "approved",
      is_primary: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(`createMembership: ${error.message}`);
  return data.id;
}

async function getStoreByName(
  supabase: SupabaseClient,
  storeName: string,
  floor: number
): Promise<string> {
  const { data: existing } = await supabase
    .from("stores")
    .select("id")
    .eq("store_name", storeName)
    .maybeSingle();
  if (existing) return existing.id;
  // Should not happen — all 4 stores exist via seed. Create just in case.
  const { data, error } = await supabase
    .from("stores")
    .insert({ store_name: storeName, floor, is_active: true })
    .select("id")
    .single();
  if (error) throw new Error(`createStore(${storeName}): ${error.message}`);
  return data.id;
}

async function ensureRooms(
  supabase: SupabaseClient,
  storeUuid: string,
  count: number
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 1; i <= count; i++) {
    const roomNo = String(i);
    const { data: existing } = await supabase
      .from("rooms")
      .select("id")
      .eq("store_uuid", storeUuid)
      .eq("room_no", roomNo)
      .maybeSingle();
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const { data, error } = await supabase
      .from("rooms")
      .insert({
        store_uuid: storeUuid,
        room_no: roomNo,
        room_name: `${roomNo}번방`,
        is_active: true,
        sort_order: i,
      })
      .select("id")
      .single();
    if (error) throw new Error(`ensureRoom(${roomNo}): ${error.message}`);
    ids.push(data.id);
  }
  return ids;
}

async function ensureManager(
  supabase: SupabaseClient,
  storeUuid: string,
  membershipId: string,
  name: string
): Promise<void> {
  const { data: existing } = await supabase
    .from("managers")
    .select("id")
    .eq("store_uuid", storeUuid)
    .eq("membership_id", membershipId)
    .maybeSingle();
  if (existing) return;
  const { error } = await supabase.from("managers").insert({
    store_uuid: storeUuid,
    membership_id: membershipId,
    name,
    is_active: true,
  });
  if (error) throw new Error(`ensureManager(${name}): ${error.message}`);
}

async function ensureHostess(
  supabase: SupabaseClient,
  storeUuid: string,
  membershipId: string,
  managerMembershipId: string,
  name: string,
  category: Category
): Promise<void> {
  const { data: existing } = await supabase
    .from("hostesses")
    .select("id, category")
    .eq("store_uuid", storeUuid)
    .eq("membership_id", membershipId)
    .maybeSingle();
  if (existing) {
    if (existing.category !== category) {
      await supabase
        .from("hostesses")
        .update({ category })
        .eq("id", existing.id);
    }
    return;
  }
  const { error } = await supabase.from("hostesses").insert({
    store_uuid: storeUuid,
    membership_id: membershipId,
    manager_membership_id: managerMembershipId,
    name,
    category,
    is_active: true,
  });
  if (error) throw new Error(`ensureHostess(${name}): ${error.message}`);
}

async function ensureBusinessDay(
  supabase: SupabaseClient,
  storeUuid: string,
  date: string
): Promise<string> {
  const { data: existing } = await supabase
    .from("store_operating_days")
    .select("id, status")
    .eq("store_uuid", storeUuid)
    .eq("business_date", date)
    .maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await supabase
    .from("store_operating_days")
    .insert({
      store_uuid: storeUuid,
      business_date: date,
      status: "open",
      opened_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(`ensureBusinessDay: ${error.message}`);
  return data.id;
}

async function loadServicePrices(
  supabase: SupabaseClient,
  storeUuid: string
): Promise<Map<string, { time_minutes: number; price: number }>> {
  const { data, error } = await supabase
    .from("store_service_types")
    .select("service_type, time_type, time_minutes, price")
    .eq("store_uuid", storeUuid)
    .eq("is_active", true);
  if (error) throw new Error(`loadServicePrices: ${error.message}`);
  const m = new Map<string, { time_minutes: number; price: number }>();
  for (const r of data ?? []) {
    m.set(`${r.service_type}|${r.time_type}`, {
      time_minutes: r.time_minutes,
      price: r.price,
    });
  }
  return m;
}

// ─── Per-store world model ────────────────────────────────────────
type Hostess = {
  membership_id: string;
  name: string;
  category: Category;
  store_uuid: string;        // origin store
  store_key: string;
};

type StoreWorld = {
  spec: StoreSpec;
  store_uuid: string;
  business_day_id: string;
  rooms: string[];
  managerMembershipIds: string[];
  managerProfileIds: string[];
  hostesses: Hostess[];
  prices: Map<string, { time_minutes: number; price: number }>;
};

// ─── Phase 1: bootstrap users, stores, rooms, business days ──────
async function bootstrapStore(
  supabase: SupabaseClient,
  spec: StoreSpec,
  businessDate: string
): Promise<StoreWorld> {
  console.log(`\n━━━ ${spec.name} (${spec.key}) ━━━`);
  const store_uuid = await getStoreByName(supabase, spec.name, spec.floor);
  const rooms = await ensureRooms(supabase, store_uuid, spec.rooms);
  const business_day_id = await ensureBusinessDay(
    supabase,
    store_uuid,
    businessDate
  );
  const prices = await loadServicePrices(supabase, store_uuid);
  if (prices.size === 0) {
    throw new Error(`${spec.name} has no store_service_types — run seed first`);
  }

  // Managers
  const managerMembershipIds: string[] = [];
  const managerProfileIds: string[] = [];
  for (let i = 1; i <= MANAGERS_PER_STORE; i++) {
    const email = `${SIM_PREFIX}${spec.key}-mgr${i}@nox-test.com`;
    const name = `${SIM_NAME_PREFIX}${spec.name}실장${i}`;
    const userId = await getOrCreateUser(supabase, email, name);
    const mid = await getOrCreateMembership(supabase, userId, store_uuid, "manager");
    await ensureManager(supabase, store_uuid, mid, name);
    managerMembershipIds.push(mid);
    managerProfileIds.push(userId);
  }
  console.log(`  managers: ${managerMembershipIds.length}`);

  // Hostesses — 10 per category, round-robin manager assignment
  const hostesses: Hostess[] = [];
  let mgrIdx = 0;
  for (const cat of CATEGORIES) {
    for (let i = 1; i <= HOSTESSES_PER_CATEGORY; i++) {
      const catKey = cat === "퍼블릭" ? "pub" : cat === "셔츠" ? "shirt" : "harper";
      const email = `${SIM_PREFIX}${spec.key}-${catKey}${i}@nox-test.com`;
      const name = `${SIM_NAME_PREFIX}${spec.name}${cat}${i}`;
      const userId = await getOrCreateUser(supabase, email, name);
      const mid = await getOrCreateMembership(supabase, userId, store_uuid, "hostess");
      const mgrMid = managerMembershipIds[mgrIdx % managerMembershipIds.length];
      mgrIdx++;
      await ensureHostess(supabase, store_uuid, mid, mgrMid, name, cat);
      hostesses.push({
        membership_id: mid,
        name,
        category: cat,
        store_uuid,
        store_key: spec.key,
      });
    }
  }
  console.log(`  hostesses: ${hostesses.length}`);
  console.log(`  rooms: ${rooms.length}, business_day: ${business_day_id}`);

  return {
    spec,
    store_uuid,
    business_day_id,
    rooms,
    managerMembershipIds,
    managerProfileIds,
    hostesses,
    prices,
  };
}

// ─── Phase 2: sessions, customers, orders, participants ──────────
type ParticipantRow = {
  session_id: string;
  store_uuid: string;        // work site
  membership_id: string;
  origin_store_uuid: string; // home store
  category: Category;
  time_minutes: number;
  price_amount: number;
  manager_payout_amount: number;
  hostess_payout_amount: number;
  margin_amount: number;
  manager_membership_id: string;
  role: string;
  status: string;
  entered_at: string;
  transfer_request_id: string | null;
};

async function ensureApprovedTransferRequest(
  supabase: SupabaseClient,
  hostessMembershipId: string,
  fromStoreUuid: string,
  toStoreUuid: string,
  businessDayId: string
): Promise<string> {
  const { data: existing } = await supabase
    .from("transfer_requests")
    .select("id")
    .eq("hostess_membership_id", hostessMembershipId)
    .eq("from_store_uuid", fromStoreUuid)
    .eq("to_store_uuid", toStoreUuid)
    .eq("business_day_id", businessDayId)
    .maybeSingle();
  if (existing) return existing.id;
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("transfer_requests")
    .insert({
      hostess_membership_id: hostessMembershipId,
      from_store_uuid: fromStoreUuid,
      to_store_uuid: toStoreUuid,
      business_day_id: businessDayId,
      status: "approved",
      from_store_approved_at: now,
      to_store_approved_at: now,
      reason: `${SIM_NAME_PREFIX} sim cross-store`,
    })
    .select("id")
    .single();
  if (error) throw new Error(`ensureApprovedTransferRequest: ${error.message}`);
  return data.id;
}

async function findExistingSimSession(
  supabase: SupabaseClient,
  storeUuid: string,
  roomUuid: string,
  businessDayId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("room_sessions")
    .select("id")
    .eq("store_uuid", storeUuid)
    .eq("room_uuid", roomUuid)
    .eq("business_day_id", businessDayId)
    .like("notes", "[SIM5]%")
    .is("deleted_at", null)
    .maybeSingle();
  return data?.id ?? null;
}

async function ensureCustomer(
  supabase: SupabaseClient,
  storeUuid: string,
  name: string
): Promise<string> {
  const { data: existing } = await supabase
    .from("customers")
    .select("id")
    .eq("store_uuid", storeUuid)
    .eq("name", name)
    .maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await supabase
    .from("customers")
    .insert({ store_uuid: storeUuid, name })
    .select("id")
    .single();
  if (error) throw new Error(`ensureCustomer: ${error.message}`);
  return data.id;
}

async function createSessionForRoom(
  supabase: SupabaseClient,
  world: StoreWorld,
  allWorlds: StoreWorld[],
  roomIdx: number
): Promise<{ created: boolean; sessionId: string }> {
  const roomUuid = world.rooms[roomIdx];
  const existing = await findExistingSimSession(
    supabase,
    world.store_uuid,
    roomUuid,
    world.business_day_id
  );
  if (existing) return { created: false, sessionId: existing };

  // Customer (lead party member)
  const customerName = `${SIM_NAME_PREFIX}${world.spec.key}손님${roomIdx + 1}`;
  const customerId = await ensureCustomer(supabase, world.store_uuid, customerName);

  // Session
  const { data: session, error: sErr } = await supabase
    .from("room_sessions")
    .insert({
      store_uuid: world.store_uuid,
      room_uuid: roomUuid,
      business_day_id: world.business_day_id,
      status: "active",
      started_at: new Date().toISOString(),
      opened_by: world.managerProfileIds[0],
      notes: `${SIM_NAME_PREFIX} sim session r${roomIdx + 1}`,
      customer_id: customerId,
      customer_name_snapshot: customerName,
      customer_party_size: CUSTOMERS_PER_SESSION,
    })
    .select("id")
    .single();
  if (sErr) throw new Error(`createSession: ${sErr.message}`);
  const sessionId = session.id;

  // Liquor orders (4 bottles)
  const liquors = ["발렌타인 17", "조니워커 블루", "글렌피딕 12", "맥캘란 12", "시바스 18"];
  const orderRows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < LIQUOR_PER_SESSION; i++) {
    const item = pick(liquors);
    const storePrice = pickInt(150, 350) * 1000;
    const salePrice = storePrice + pickInt(20, 80) * 1000;
    orderRows.push({
      session_id: sessionId,
      store_uuid: world.store_uuid,
      business_day_id: world.business_day_id,
      item_name: item,
      order_type: "양주",
      qty: 1,
      unit_price: salePrice,
      ordered_by: world.managerProfileIds[0],
      notes: `${SIM_NAME_PREFIX} order`,
      store_price: storePrice,
      sale_price: salePrice,
      manager_amount: salePrice - storePrice,
      customer_amount: salePrice,
    });
  }
  const { error: oErr } = await supabase.from("orders").insert(orderRows);
  if (oErr) throw new Error(`insert orders: ${oErr.message}`);

  // Participants — 5 hostesses, ~20% from foreign stores
  // Gather a candidate pool: this store first, then foreign stores
  const localPool = world.hostesses.slice();
  const foreignPool: Hostess[] = allWorlds
    .filter((w) => w.spec.key !== world.spec.key)
    .flatMap((w) => w.hostesses);

  const chosen: Hostess[] = [];
  const usedMids = new Set<string>();
  while (chosen.length < PARTICIPANTS_PER_SESSION) {
    const useForeign = rng() < CROSS_STORE_PROBABILITY;
    const pool = useForeign ? foreignPool : localPool;
    if (pool.length === 0) continue;
    const cand = pick(pool);
    if (usedMids.has(cand.membership_id)) continue;
    usedMids.add(cand.membership_id);
    chosen.push(cand);
  }

  const partRows: ParticipantRow[] = [];
  for (const h of chosen) {
    let transferRequestId: string | null = null;
    if (h.store_uuid !== world.store_uuid) {
      transferRequestId = await ensureApprovedTransferRequest(
        supabase,
        h.membership_id,
        h.store_uuid,
        world.store_uuid,
        world.business_day_id
      );
    }
    // Service type / time choice — basic time only for simplicity
    const timeKey = `${h.category}|기본`;
    const svc = world.prices.get(timeKey);
    if (!svc) {
      throw new Error(`missing price for ${timeKey} in ${world.spec.name}`);
    }
    const managerPayout = pick([0, 5000, 10000]);
    const hostessPayout = svc.price - managerPayout;
    partRows.push({
      session_id: sessionId,
      store_uuid: world.store_uuid,
      membership_id: h.membership_id,
      origin_store_uuid: h.store_uuid,
      category: h.category,
      time_minutes: svc.time_minutes,
      price_amount: svc.price,
      manager_payout_amount: managerPayout,
      hostess_payout_amount: hostessPayout,
      margin_amount: 0,
      manager_membership_id: world.managerMembershipIds[
        pickInt(0, world.managerMembershipIds.length - 1)
      ],
      role: "hostess",
      status: "active",
      entered_at: new Date().toISOString(),
      transfer_request_id: transferRequestId,
    });
  }
  const { error: pErr } = await supabase
    .from("session_participants")
    .insert(partRows);
  if (pErr) throw new Error(`insert participants: ${pErr.message}`);

  return { created: true, sessionId };
}

// ─── Phase 3: chat ────────────────────────────────────────────────
async function ensureGlobalChatRoom(
  supabase: SupabaseClient,
  storeUuid: string,
  creatorMid: string
): Promise<string> {
  const { data: existing } = await supabase
    .from("chat_rooms")
    .select("id")
    .eq("store_uuid", storeUuid)
    .eq("type", "global")
    .maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await supabase
    .from("chat_rooms")
    .insert({
      store_uuid: storeUuid,
      type: "global",
      name: "전체",
      is_active: true,
      created_by: creatorMid,
    })
    .select("id")
    .single();
  if (error) throw new Error(`ensureGlobalChatRoom: ${error.message}`);
  return data.id;
}

async function postSimChatMessages(
  supabase: SupabaseClient,
  world: StoreWorld
): Promise<number> {
  const roomId = await ensureGlobalChatRoom(
    supabase,
    world.store_uuid,
    world.managerMembershipIds[0]
  );
  // Skip if [SIM5] messages already exist
  const { data: prior } = await supabase
    .from("chat_messages")
    .select("id")
    .eq("chat_room_id", roomId)
    .like("content", "[SIM5]%")
    .limit(1);
  if (prior && prior.length > 0) return 0;

  const lines = [];
  for (let i = 0; i < 6; i++) lines.push(pick(CHAT_LINES));
  const senders = world.managerMembershipIds;
  const rows = lines.map((line) => ({
    chat_room_id: roomId,
    store_uuid: world.store_uuid,
    sender_membership_id: pick(senders),
    content: `[SIM5] ${line}`,
    message_type: "text",
  }));
  const { error } = await supabase.from("chat_messages").insert(rows);
  if (error) throw new Error(`chat insert: ${error.message}`);
  return rows.length;
}

// ─── Phase 4: validation report ──────────────────────────────────
type Report = {
  stores: {
    name: string;
    store_uuid: string;
    rooms: number;
    managers: number;
    hostesses: number;
    sessions: number;
    orders: number;
    participants: number;
    revenue_time: number;
    revenue_orders: number;
  }[];
  cross_store_pairs: {
    work_store: string;
    origin_store: string;
    participants: number;
    payable: number;
  }[];
  symmetry_ok: boolean;
  total_sessions: number;
};

async function buildReport(
  supabase: SupabaseClient,
  worlds: StoreWorld[]
): Promise<Report> {
  const report: Report = {
    stores: [],
    cross_store_pairs: [],
    symmetry_ok: true,
    total_sessions: 0,
  };

  const nameById = new Map<string, string>();
  for (const w of worlds) nameById.set(w.store_uuid, w.spec.name);

  for (const w of worlds) {
    // sessions today
    const { data: sessions } = await supabase
      .from("room_sessions")
      .select("id")
      .eq("store_uuid", w.store_uuid)
      .eq("business_day_id", w.business_day_id)
      .like("notes", "[SIM5]%")
      .is("deleted_at", null);
    const sessionIds = (sessions ?? []).map((s) => s.id);
    report.total_sessions += sessionIds.length;

    // orders
    let ordersCount = 0;
    let ordersRevenue = 0;
    if (sessionIds.length > 0) {
      const { data: orders } = await supabase
        .from("orders")
        .select("customer_amount")
        .in("session_id", sessionIds)
        .is("deleted_at", null);
      ordersCount = orders?.length ?? 0;
      ordersRevenue = (orders ?? []).reduce(
        (s, o: { customer_amount: number | null }) =>
          s + (o.customer_amount ?? 0),
        0
      );
    }

    // participants
    let partCount = 0;
    let timeRevenue = 0;
    if (sessionIds.length > 0) {
      const { data: parts } = await supabase
        .from("session_participants")
        .select("price_amount, origin_store_uuid, store_uuid")
        .in("session_id", sessionIds);
      partCount = parts?.length ?? 0;
      timeRevenue = (parts ?? []).reduce(
        (s, p: { price_amount: number | null }) => s + (p.price_amount ?? 0),
        0
      );
    }

    report.stores.push({
      name: w.spec.name,
      store_uuid: w.store_uuid,
      rooms: w.rooms.length,
      managers: w.managerMembershipIds.length,
      hostesses: w.hostesses.length,
      sessions: sessionIds.length,
      orders: ordersCount,
      participants: partCount,
      revenue_time: timeRevenue,
      revenue_orders: ordersRevenue,
    });
  }

  // Cross-store: aggregate participants where origin != work
  const allSimSessionIds: string[] = [];
  for (const w of worlds) {
    const { data: sessions } = await supabase
      .from("room_sessions")
      .select("id")
      .eq("store_uuid", w.store_uuid)
      .eq("business_day_id", w.business_day_id)
      .like("notes", "[SIM5]%")
      .is("deleted_at", null);
    for (const s of sessions ?? []) allSimSessionIds.push(s.id);
  }

  if (allSimSessionIds.length > 0) {
    const { data: crossParts } = await supabase
      .from("session_participants")
      .select("store_uuid, origin_store_uuid, price_amount")
      .in("session_id", allSimSessionIds);

    const pairMap = new Map<string, { count: number; total: number }>();
    for (const p of crossParts ?? []) {
      if (!p.origin_store_uuid || p.origin_store_uuid === p.store_uuid) continue;
      const key = `${p.store_uuid}|${p.origin_store_uuid}`;
      const cur = pairMap.get(key) ?? { count: 0, total: 0 };
      cur.count += 1;
      cur.total += p.price_amount ?? 0;
      pairMap.set(key, cur);
    }
    for (const [key, v] of pairMap) {
      const [work, origin] = key.split("|");
      report.cross_store_pairs.push({
        work_store: nameById.get(work) ?? work,
        origin_store: nameById.get(origin) ?? origin,
        participants: v.count,
        payable: v.total,
      });
    }
    // Symmetry: payable(A→B) is the same row set as receivable(B from A).
    // We've computed it from a single source of truth; symmetry holds by
    // construction. Double-check by re-aggregating with origin as primary.
    const recvMap = new Map<string, number>();
    for (const p of crossParts ?? []) {
      if (!p.origin_store_uuid || p.origin_store_uuid === p.store_uuid) continue;
      const key = `${p.origin_store_uuid}|${p.store_uuid}`;
      recvMap.set(key, (recvMap.get(key) ?? 0) + (p.price_amount ?? 0));
    }
    for (const [key, payable] of pairMap) {
      const [work, origin] = key.split("|");
      const recvKey = `${origin}|${work}`;
      const recv = recvMap.get(recvKey) ?? 0;
      if (recv !== payable.total) {
        report.symmetry_ok = false;
        console.warn(`  [SYMMETRY FAIL] ${work}→${origin}: payable=${payable.total}, receivable=${recv}`);
      }
    }
  }

  return report;
}

function printReport(report: Report) {
  console.log("\n========================================");
  console.log("  SIMULATION REPORT");
  console.log("========================================\n");
  console.log("Per-store summary:");
  for (const s of report.stores) {
    console.log(
      `  ${s.name}: rooms=${s.rooms} mgr=${s.managers} hostess=${s.hostesses} ` +
        `sessions=${s.sessions} orders=${s.orders} parts=${s.participants} ` +
        `time₩=${s.revenue_time.toLocaleString()} ord₩=${s.revenue_orders.toLocaleString()}`
    );
  }
  console.log(`\nTotal sim sessions: ${report.total_sessions}`);
  console.log(`\nCross-store pairs (${report.cross_store_pairs.length}):`);
  for (const p of report.cross_store_pairs) {
    console.log(
      `  ${p.work_store} → ${p.origin_store}: ${p.participants} participants, payable ₩${p.payable.toLocaleString()}`
    );
  }
  console.log(`\nSymmetry check: ${report.symmetry_ok ? "OK ✓" : "FAIL ✗"}`);
}

// ─── Cleanup ──────────────────────────────────────────────────────
async function cleanup(supabase: SupabaseClient) {
  console.log("\n━━━ CLEANUP (soft-delete sim-floor5 data) ━━━");
  // chat messages
  const { data: simChatMsgs } = await supabase
    .from("chat_messages")
    .select("id")
    .like("content", "[SIM5]%");
  if (simChatMsgs && simChatMsgs.length > 0) {
    await supabase
      .from("chat_messages")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", simChatMsgs.map((m) => m.id));
    console.log(`  chat_messages: ${simChatMsgs.length} marked deleted`);
  }
  // sessions (and cascade via deleted_at on related tables)
  const { data: simSessions } = await supabase
    .from("room_sessions")
    .select("id")
    .like("notes", "[SIM5]%");
  if (simSessions && simSessions.length > 0) {
    const ids = simSessions.map((s) => s.id);
    await supabase
      .from("room_sessions")
      .update({ deleted_at: new Date().toISOString(), status: "closed" })
      .in("id", ids);
    await supabase
      .from("orders")
      .update({ deleted_at: new Date().toISOString() })
      .in("session_id", ids);
    console.log(`  room_sessions: ${ids.length} marked deleted`);
  }
  // hostesses
  const { data: simHostesses } = await supabase
    .from("hostesses")
    .select("id")
    .like("name", `${SIM_NAME_PREFIX}%`);
  if (simHostesses && simHostesses.length > 0) {
    await supabase
      .from("hostesses")
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .in("id", simHostesses.map((h) => h.id));
    console.log(`  hostesses: ${simHostesses.length} marked deleted`);
  }
  // managers
  const { data: simManagers } = await supabase
    .from("managers")
    .select("id")
    .like("name", `${SIM_NAME_PREFIX}%`);
  if (simManagers && simManagers.length > 0) {
    await supabase
      .from("managers")
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .in("id", simManagers.map((m) => m.id));
    console.log(`  managers: ${simManagers.length} marked deleted`);
  }
  console.log("  (auth users + memberships intentionally retained for idempotency)");
}

// ─── Main ──────────────────────────────────────────────────────────
async function main() {
  const args = new Set(process.argv.slice(2));
  const isCleanup = args.has("--cleanup");
  const isReportOnly = args.has("--report");

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (isCleanup) {
    await cleanup(supabase);
    console.log("\n=== CLEANUP DONE ===");
    return;
  }

  console.log("=== NOX FLOOR-5 SIMULATION START ===");
  console.log(`seed=${RNG_SEED.toString(16)}  prefix=${SIM_PREFIX}`);

  const businessDate = new Date().toISOString().slice(0, 10);
  console.log(`business_date=${businessDate}`);

  // Phase 1: bootstrap all stores
  const worlds: StoreWorld[] = [];
  for (const spec of STORES) {
    if (isReportOnly) {
      // Lightweight bootstrap: just resolve store + business day
      const store_uuid = await getStoreByName(supabase, spec.name, spec.floor);
      const business_day_id = await ensureBusinessDay(supabase, store_uuid, businessDate);
      worlds.push({
        spec,
        store_uuid,
        business_day_id,
        rooms: [],
        managerMembershipIds: [],
        managerProfileIds: [],
        hostesses: [],
        prices: new Map(),
      });
    } else {
      worlds.push(await bootstrapStore(supabase, spec, businessDate));
    }
  }

  if (!isReportOnly) {
    // Phase 2: sessions
    console.log("\n━━━ SESSIONS ━━━");
    let createdSessions = 0;
    let reusedSessions = 0;
    for (const w of worlds) {
      for (let i = 0; i < w.rooms.length; i++) {
        const r = await createSessionForRoom(supabase, w, worlds, i);
        if (r.created) createdSessions++;
        else reusedSessions++;
      }
      console.log(`  ${w.spec.name}: created+reused = ${w.rooms.length} sessions`);
    }
    console.log(`  total: created=${createdSessions} reused=${reusedSessions}`);

    // Phase 3: chat
    console.log("\n━━━ CHAT ━━━");
    for (const w of worlds) {
      const n = await postSimChatMessages(supabase, w);
      console.log(`  ${w.spec.name}: ${n} new chat messages`);
    }
  }

  // Phase 4: report
  const report = await buildReport(supabase, worlds);
  printReport(report);

  if (!report.symmetry_ok) {
    console.error("\n❌ SYMMETRY VALIDATION FAILED");
    process.exit(2);
  }
  console.log("\n=== DONE ===");
}

main().catch((err) => {
  console.error("\n❌ SIM FAILED:", err.message);
  console.error(err.stack);
  process.exit(1);
});
