/**
 * NOX All-Store Seed — 15매장 전체 backfill
 *
 * 5층: 마블, 라이브, 버닝, 황진이 (기존 — 부족분 보강)
 * 6층: 신세계, 아지트, 아우라, 퍼스트 (신규)
 * 7층: 상한가, 토끼, 발리, 두바이 (신규)
 * 8층: 블랙, 썸, 파티 (신규)
 *
 * 각 매장: 사장 1 + 실장 5 + 아가씨 10 + 방 5 + 설정 + 종목단가
 * 비밀번호: Test1234! (전체)
 * 실행: npx tsx scripts/seed-all-stores.ts
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// SECURITY (SECURITY_FIX_PLAN.md TASK 0-1): keys MUST come from env.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[seed-all-stores] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in your shell or .env.local before running.");
  process.exit(1);
}
const PASSWORD = process.env.SEED_PASSWORD ?? "Test1234!";

// ─── Store Config ────────────────────────────────────────────
// existing: true → store already in DB, skip store creation
// existing: false → create store, settings, service types
type StoreConfig = {
  key: string;
  label: string;
  uuid?: string;       // only for existing stores
  floor: number;
  existing: boolean;
  rooms: number;        // number of rooms to ensure
  managers: number;     // number of managers to ensure
  hostesses: number;    // number of hostesses to ensure
};

const ALL_STORES: StoreConfig[] = [
  // ── 5층 (기존 4매장) ──
  { key: "marvel",    label: "마블",   uuid: "ad1b95f0-5023-4c93-9282-efbb3d94ce76", floor: 5, existing: true,  rooms: 5, managers: 5, hostesses: 10 },
  { key: "live",      label: "라이브", uuid: "d7f62182-48cb-4731-b694-b1a02d60b1fa", floor: 5, existing: true,  rooms: 6, managers: 5, hostesses: 10 },
  { key: "burning",   label: "버닝",   uuid: "147b2115-6ece-48ed-9ca0-63fd31ea2c38", floor: 6, existing: true,  rooms: 5, managers: 5, hostesses: 10 },
  { key: "hwangjini", label: "황진이", uuid: "cbacf389-4cd7-4459-b97d-d7775ddaf8d0", floor: 7, existing: true,  rooms: 6, managers: 5, hostesses: 10 },
  // ── 6층 (신규 4매장) ──
  { key: "shinsegae", label: "신세계", floor: 6, existing: false, rooms: 5, managers: 5, hostesses: 10 },
  { key: "azit",      label: "아지트", floor: 6, existing: false, rooms: 5, managers: 5, hostesses: 10 },
  { key: "aura",      label: "아우라", floor: 6, existing: false, rooms: 5, managers: 5, hostesses: 10 },
  { key: "first",     label: "퍼스트", floor: 6, existing: false, rooms: 5, managers: 5, hostesses: 10 },
  // ── 7층 (신규 4매장) ──
  { key: "sanghanga", label: "상한가", floor: 7, existing: false, rooms: 5, managers: 5, hostesses: 10 },
  { key: "rabbit",    label: "토끼",   floor: 7, existing: false, rooms: 5, managers: 5, hostesses: 10 },
  { key: "bali",      label: "발리",   floor: 7, existing: false, rooms: 5, managers: 5, hostesses: 10 },
  { key: "dubai",     label: "두바이", floor: 7, existing: false, rooms: 5, managers: 5, hostesses: 10 },
  // ── 8층 (신규 3매장) ──
  { key: "black",     label: "블랙",   floor: 8, existing: false, rooms: 5, managers: 5, hostesses: 10 },
  { key: "ssom",      label: "썸",     floor: 8, existing: false, rooms: 5, managers: 5, hostesses: 10 },
  { key: "party",     label: "파티",   floor: 8, existing: false, rooms: 5, managers: 5, hostesses: 10 },
];

// ─── Counters ────────────────────────────────────────────────
let created = 0;
let skipped = 0;

// ─── User cache to avoid repeated listUsers calls ───────────
let cachedUsers: { id: string; email?: string }[] | null = null;

async function loadUserCache(supabase: SupabaseClient) {
  if (cachedUsers) return;
  const allUsers: { id: string; email?: string }[] = [];
  let page = 1;
  const perPage = 1000;
  while (true) {
    const { data } = await supabase.auth.admin.listUsers({ page, perPage });
    if (!data?.users?.length) break;
    allUsers.push(...data.users.map(u => ({ id: u.id, email: u.email })));
    if (data.users.length < perPage) break;
    page++;
  }
  cachedUsers = allUsers;
  console.log(`  [cache] ${cachedUsers.length} auth users loaded\n`);
}

// ─── Helpers ─────────────────────────────────────────────────

async function getOrCreateUser(
  supabase: SupabaseClient, email: string, fullName: string
): Promise<string> {
  await loadUserCache(supabase);
  const existing = cachedUsers!.find(u => u.email === email);

  if (existing) {
    await supabase.from("profiles").upsert({ id: existing.id, full_name: fullName }, { onConflict: "id" });
    skipped++;
    return existing.id;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw new Error(`createUser(${email}): ${error.message}`);
  const userId = data.user!.id;

  await supabase.from("profiles").upsert({ id: userId, full_name: fullName }, { onConflict: "id" });
  cachedUsers!.push({ id: userId, email });
  created++;
  return userId;
}

async function getOrCreateMembership(
  supabase: SupabaseClient, profileId: string, storeUuid: string, role: string
): Promise<string> {
  const { data: existing } = await supabase
    .from("store_memberships").select("id")
    .eq("profile_id", profileId).eq("store_uuid", storeUuid).eq("role", role)
    .is("deleted_at", null)
    .maybeSingle();

  if (existing) { skipped++; return existing.id; }

  const { data, error } = await supabase
    .from("store_memberships")
    .insert({ profile_id: profileId, store_uuid: storeUuid, role, status: "approved", is_primary: true })
    .select("id").single();

  if (error) throw new Error(`createMembership: ${error.message}`);
  created++;
  return data.id;
}

async function getOrCreateManager(
  supabase: SupabaseClient, storeUuid: string, membershipId: string, name: string
): Promise<string> {
  const { data: existing } = await supabase
    .from("managers").select("id")
    .eq("store_uuid", storeUuid).eq("membership_id", membershipId)
    .is("deleted_at", null)
    .maybeSingle();

  if (existing) { skipped++; return existing.id; }

  const { data, error } = await supabase
    .from("managers")
    .insert({ store_uuid: storeUuid, membership_id: membershipId, name, is_active: true })
    .select("id").single();

  if (error) throw new Error(`createManager(${name}): ${error.message}`);
  created++;
  return data.id;
}

async function getOrCreateHostess(
  supabase: SupabaseClient, storeUuid: string, membershipId: string,
  managerMembershipId: string, name: string, category: string
): Promise<string> {
  const { data: existing } = await supabase
    .from("hostesses").select("id")
    .eq("store_uuid", storeUuid).eq("membership_id", membershipId)
    .is("deleted_at", null)
    .maybeSingle();

  if (existing) {
    await supabase.from("hostesses").update({ category }).eq("id", existing.id);
    skipped++;
    return existing.id;
  }

  const { data, error } = await supabase
    .from("hostesses")
    .insert({
      store_uuid: storeUuid, membership_id: membershipId,
      manager_membership_id: managerMembershipId,
      name, category, is_active: true,
    })
    .select("id").single();

  if (error) throw new Error(`createHostess(${name}): ${error.message}`);
  created++;
  return data.id;
}

async function getOrCreateRoom(
  supabase: SupabaseClient, storeUuid: string, roomNo: string, roomName: string
): Promise<string> {
  const { data: existing } = await supabase
    .from("rooms").select("id")
    .eq("store_uuid", storeUuid).eq("room_no", roomNo)
    .maybeSingle();

  if (existing) { skipped++; return existing.id; }

  const { data, error } = await supabase
    .from("rooms")
    .insert({ store_uuid: storeUuid, room_no: roomNo, room_name: roomName, is_active: true, sort_order: parseInt(roomNo) })
    .select("id").single();

  if (error) throw new Error(`createRoom(${roomNo}): ${error.message}`);
  created++;
  return data.id;
}

async function getOrCreateStore(
  supabase: SupabaseClient, storeName: string, floor: number
): Promise<string> {
  const { data: existing } = await supabase
    .from("stores").select("id")
    .eq("store_name", storeName)
    .maybeSingle();

  if (existing) {
    console.log(`  [skip] store exists: ${storeName} (${existing.id})`);
    return existing.id;
  }

  const { data, error } = await supabase
    .from("stores")
    .insert({ store_name: storeName, floor, is_active: true })
    .select("id").single();

  if (error) throw new Error(`createStore(${storeName}): ${error.message}`);
  console.log(`  [new] store: ${storeName} (${data.id})`);

  // Default store_settings
  await supabase.from("store_settings").upsert(
    {
      store_uuid: data.id,
      tc_rate: 0.2,
      manager_payout_rate: 0.7,
      hostess_payout_rate: 0.1,
      payout_basis: "netOfTC",
      rounding_unit: 1000,
    },
    { onConflict: "store_uuid" }
  );

  // Default service_types
  await seedServiceTypes(supabase, data.id);

  return data.id;
}

async function seedServiceTypes(supabase: SupabaseClient, storeUuid: string) {
  const { data: existing } = await supabase
    .from("store_service_types").select("id")
    .eq("store_uuid", storeUuid).limit(1);

  if (existing && existing.length > 0) {
    console.log(`  [skip] service_types already exist`);
    return;
  }

  const rows = [
    { service_type: "퍼블릭", time_type: "기본", time_minutes: 90, price: 130000, manager_deduction: 0, has_greeting_check: false, sort_order: 1 },
    { service_type: "퍼블릭", time_type: "반티", time_minutes: 45, price: 70000,  manager_deduction: 0, has_greeting_check: false, sort_order: 2 },
    { service_type: "퍼블릭", time_type: "차3",  time_minutes: 15, price: 30000,  manager_deduction: 0, has_greeting_check: false, sort_order: 3 },
    { service_type: "셔츠",   time_type: "기본", time_minutes: 60, price: 140000, manager_deduction: 0, has_greeting_check: true,  sort_order: 4 },
    { service_type: "셔츠",   time_type: "반티", time_minutes: 30, price: 70000,  manager_deduction: 0, has_greeting_check: false, sort_order: 5 },
    { service_type: "셔츠",   time_type: "차3",  time_minutes: 15, price: 30000,  manager_deduction: 0, has_greeting_check: false, sort_order: 6 },
    { service_type: "하퍼",   time_type: "기본", time_minutes: 60, price: 120000, manager_deduction: 0, has_greeting_check: false, sort_order: 7 },
    { service_type: "하퍼",   time_type: "반티", time_minutes: 30, price: 60000,  manager_deduction: 0, has_greeting_check: false, sort_order: 8 },
    { service_type: "하퍼",   time_type: "차3",  time_minutes: 15, price: 30000,  manager_deduction: 0, has_greeting_check: false, sort_order: 9 },
  ];

  const { error } = await supabase
    .from("store_service_types")
    .insert(rows.map(r => ({ ...r, store_uuid: storeUuid, is_active: true })));

  if (error) console.error(`  [error] seedServiceTypes: ${error.message}`);
  else console.log(`  [new] service_types: ${rows.length} rows`);
}

// ─── Category assignment for hostesses ───────────────────────
const HOSTESS_CATEGORIES = ["퍼블릭", "셔츠", "하퍼"];

function hostessCategory(index: number): string {
  return HOSTESS_CATEGORIES[index % HOSTESS_CATEGORIES.length];
}

// ─── Main ────────────────────────────────────────────────────

type StoreSummary = {
  label: string;
  floor: number;
  uuid: string;
  ownerCount: number;
  managerCount: number;
  hostessCount: number;
  roomCount: number;
};

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("=== NOX ALL-STORE SEED START ===");
  console.log(`15매장 × (사장1 + 실장5 + 아가씨10) + 방5 + 설정\n`);

  const summaries: StoreSummary[] = [];

  for (const store of ALL_STORES) {
    console.log(`\n${"━".repeat(55)}`);
    console.log(`  ${store.label} (${store.key}) — ${store.floor}층 ${store.existing ? "[기존]" : "[신규]"}`);
    console.log(`${"━".repeat(55)}`);

    // ── 1. Store ──
    let storeUuid: string;
    if (store.existing && store.uuid) {
      storeUuid = store.uuid;
      console.log(`  store_uuid: ${storeUuid}`);
      // Ensure service types exist for existing stores
      await seedServiceTypes(supabase, storeUuid);
    } else {
      storeUuid = await getOrCreateStore(supabase, store.label, store.floor);
      console.log(`  store_uuid: ${storeUuid}`);
    }

    // ── 2. Rooms ──
    console.log(`\n  [방 ${store.rooms}개]`);
    for (let r = 1; r <= store.rooms; r++) {
      await getOrCreateRoom(supabase, storeUuid, String(r), `${r}번방`);
    }

    // ── 3. Owner ──
    console.log(`\n  [사장]`);
    const ownerEmail = `${store.key}-owner@nox-test.com`;
    const ownerName = `${store.label}사장`;
    const ownerUserId = await getOrCreateUser(supabase, ownerEmail, ownerName);
    await getOrCreateMembership(supabase, ownerUserId, storeUuid, "owner");
    console.log(`    ${ownerName} (${ownerEmail})`);

    // ── 4. Managers ──
    console.log(`\n  [실장 ${store.managers}명]`);
    const mgrMembershipIds: string[] = [];

    for (let m = 1; m <= store.managers; m++) {
      const email = `${store.key}-mgr${m}@nox-test.com`;
      const name = `${store.label}실장${m}`;

      const userId = await getOrCreateUser(supabase, email, name);
      const membershipId = await getOrCreateMembership(supabase, userId, storeUuid, "manager");
      await getOrCreateManager(supabase, storeUuid, membershipId, name);

      mgrMembershipIds.push(membershipId);
      console.log(`    ${name} (${email})`);
    }

    // ── 5. Hostesses ──
    console.log(`\n  [아가씨 ${store.hostesses}명]`);
    for (let h = 1; h <= store.hostesses; h++) {
      const email = `${store.key}-h${h}@nox-test.com`;
      const name = `${store.label}아가씨${h}`;
      const category = hostessCategory(h - 1);
      const assignedMgr = mgrMembershipIds[(h - 1) % mgrMembershipIds.length];

      const userId = await getOrCreateUser(supabase, email, name);
      const membershipId = await getOrCreateMembership(supabase, userId, storeUuid, "hostess");
      await getOrCreateHostess(supabase, storeUuid, membershipId, assignedMgr, name, category);

      console.log(`    ${name} [${category}] (${email})`);
    }

    // ── Count actual data in DB for summary ──
    const { count: mgrCount } = await supabase
      .from("managers").select("id", { count: "exact", head: true })
      .eq("store_uuid", storeUuid).eq("is_active", true).is("deleted_at", null);

    const { count: hostCount } = await supabase
      .from("hostesses").select("id", { count: "exact", head: true })
      .eq("store_uuid", storeUuid).eq("is_active", true).is("deleted_at", null);

    const { count: roomCount } = await supabase
      .from("rooms").select("id", { count: "exact", head: true })
      .eq("store_uuid", storeUuid).eq("is_active", true);

    const { count: ownerCount } = await supabase
      .from("store_memberships").select("id", { count: "exact", head: true })
      .eq("store_uuid", storeUuid).eq("role", "owner").eq("status", "approved").is("deleted_at", null);

    summaries.push({
      label: store.label,
      floor: store.floor,
      uuid: storeUuid,
      ownerCount: ownerCount ?? 0,
      managerCount: mgrCount ?? 0,
      hostessCount: hostCount ?? 0,
      roomCount: roomCount ?? 0,
    });
  }

  // ─── Final Report ──────────────────────────────────────────
  console.log(`\n\n${"=".repeat(70)}`);
  console.log("  ALL-STORE SEED 완료");
  console.log(`${"=".repeat(70)}`);
  console.log(`  생성: ${created} | 스킵(기존): ${skipped} | 합계: ${created + skipped}`);
  console.log(`  비밀번호: ${PASSWORD}\n`);

  console.log("  ┌────────┬───┬──────────────────────────────────────┬──────┬──────┬────────┬────┐");
  console.log("  │ 매장   │ 층│ store_uuid                           │ 사장 │ 실장 │ 아가씨 │ 방 │");
  console.log("  ├────────┼───┼──────────────────────────────────────┼──────┼──────┼────────┼────┤");
  for (const s of summaries) {
    const lb = s.label.padEnd(6);
    const fl = String(s.floor).padStart(1);
    const ow = String(s.ownerCount).padStart(4);
    const mg = String(s.managerCount).padStart(4);
    const ho = String(s.hostessCount).padStart(6);
    const rm = String(s.roomCount).padStart(2);
    console.log(`  │ ${lb} │ ${fl} │ ${s.uuid} │ ${ow} │ ${mg} │ ${ho} │ ${rm} │`);
  }
  console.log("  └────────┴───┴──────────────────────────────────────┴──────┴──────┴────────┴────┘");

  console.log(`\n  이메일 패턴:`);
  console.log(`    사장:   {store}-owner@nox-test.com`);
  console.log(`    실장:   {store}-mgr{1~5}@nox-test.com`);
  console.log(`    아가씨: {store}-h{1~10}@nox-test.com`);
  console.log(`\n  store keys: ${ALL_STORES.map(s => s.key).join(", ")}`);

  console.log("\n=== DONE ===");
}

main().catch((err) => {
  console.error(`\nSEED FAILED: ${err.message}`);
  process.exit(1);
});
