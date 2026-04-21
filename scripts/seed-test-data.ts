/**
 * NOX Seed Script — 테스트 데이터 생성
 *
 * 원칙:
 * - UUID는 gen_random_uuid() (DB 생성) — 하드코딩 금지
 * - 모든 테이블에 store_uuid 필수
 * - membership_id 기준 권한 구조
 * - 중복 체크 후 생성 (upsert / skip)
 *
 * 실행: npx tsx scripts/seed-test-data.ts
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ─── Config ────────────────────────────────────────────────────────
// SECURITY (SECURITY_FIX_PLAN.md TASK 0-1): keys MUST come from env.
// Never hardcode the service_role key — it bypasses RLS for the entire DB.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[seed-test-data] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in your shell or .env.local before running.");
  process.exit(1);
}
const PASSWORD = process.env.SEED_PASSWORD ?? "Test1234!";

const MARVEL_STORE_UUID = "ad1b95f0-5023-4c93-9282-efbb3d94ce76";

// ─── Types ─────────────────────────────────────────────────────────
type CreatedAccount = {
  email: string;
  role: string;
  store: string;
  user_id: string;
  membership_id: string;
};

const createdAccounts: CreatedAccount[] = [];

// ─── Helpers ───────────────────────────────────────────────────────
async function getOrCreateUser(
  supabase: SupabaseClient,
  email: string,
  fullName: string
): Promise<string> {
  // Check if user already exists
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  const existing = existingUsers?.users?.find((u) => u.email === email);

  if (existing) {
    console.log(`  [skip] auth user exists: ${email} (${existing.id})`);
    // Ensure profile exists
    await supabase
      .from("profiles")
      .upsert(
        { id: existing.id, full_name: fullName },
        { onConflict: "id" }
      );
    return existing.id;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (error) throw new Error(`createUser(${email}) failed: ${error.message}`);
  const userId = data.user!.id;
  console.log(`  [new] auth user: ${email} (${userId})`);

  // Create profile
  await supabase
    .from("profiles")
    .upsert(
      { id: userId, full_name: fullName },
      { onConflict: "id" }
    );

  return userId;
}

async function getOrCreateMembership(
  supabase: SupabaseClient,
  profileId: string,
  storeUuid: string,
  role: string
): Promise<string> {
  // Check existing
  const { data: existing } = await supabase
    .from("store_memberships")
    .select("id")
    .eq("profile_id", profileId)
    .eq("store_uuid", storeUuid)
    .eq("role", role)
    .maybeSingle();

  if (existing) {
    console.log(`  [skip] membership exists: ${existing.id}`);
    return existing.id;
  }

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

  if (error)
    throw new Error(`createMembership failed: ${error.message}`);
  console.log(`  [new] membership: ${data.id} (${role})`);
  return data.id;
}

async function getOrCreateManager(
  supabase: SupabaseClient,
  storeUuid: string,
  membershipId: string,
  name: string
): Promise<string> {
  const { data: existing } = await supabase
    .from("managers")
    .select("id")
    .eq("store_uuid", storeUuid)
    .eq("membership_id", membershipId)
    .maybeSingle();

  if (existing) {
    console.log(`  [skip] manager exists: ${existing.id}`);
    return existing.id;
  }

  const { data, error } = await supabase
    .from("managers")
    .insert({
      store_uuid: storeUuid,
      membership_id: membershipId,
      name,
      is_active: true,
    })
    .select("id")
    .single();

  if (error) throw new Error(`createManager(${name}) failed: ${error.message}`);
  console.log(`  [new] manager: ${name} (${data.id})`);
  return data.id;
}

async function getOrCreateHostess(
  supabase: SupabaseClient,
  storeUuid: string,
  membershipId: string,
  managerMembershipId: string,
  name: string
): Promise<string> {
  const { data: existing } = await supabase
    .from("hostesses")
    .select("id")
    .eq("store_uuid", storeUuid)
    .eq("membership_id", membershipId)
    .maybeSingle();

  if (existing) {
    console.log(`  [skip] hostess exists: ${existing.id}`);
    return existing.id;
  }

  const { data, error } = await supabase
    .from("hostesses")
    .insert({
      store_uuid: storeUuid,
      membership_id: membershipId,
      manager_membership_id: managerMembershipId,
      name,
      is_active: true,
    })
    .select("id")
    .single();

  if (error) throw new Error(`createHostess(${name}) failed: ${error.message}`);
  console.log(`  [new] hostess: ${name} (${data.id})`);
  return data.id;
}

async function getOrCreateRoom(
  supabase: SupabaseClient,
  storeUuid: string,
  roomNo: string,
  roomName: string
): Promise<string> {
  const { data: existing } = await supabase
    .from("rooms")
    .select("id")
    .eq("store_uuid", storeUuid)
    .eq("room_no", roomNo)
    .maybeSingle();

  if (existing) {
    console.log(`  [skip] room exists: ${roomNo} (${existing.id})`);
    return existing.id;
  }

  const { data, error } = await supabase
    .from("rooms")
    .insert({
      store_uuid: storeUuid,
      room_no: roomNo,
      room_name: roomName,
      is_active: true,
      sort_order: parseInt(roomNo),
    })
    .select("id")
    .single();

  if (error) throw new Error(`createRoom(${roomNo}) failed: ${error.message}`);
  console.log(`  [new] room: ${roomName} (${data.id})`);
  return data.id;
}

async function getOrCreateStore(
  supabase: SupabaseClient,
  storeName: string,
  floor: number
): Promise<string> {
  const { data: existing } = await supabase
    .from("stores")
    .select("id")
    .eq("store_name", storeName)
    .maybeSingle();

  if (existing) {
    console.log(`  [skip] store exists: ${storeName} (${existing.id})`);
    return existing.id;
  }

  const { data, error } = await supabase
    .from("stores")
    .insert({
      store_name: storeName,
      floor,
      is_active: true,
    })
    .select("id")
    .single();

  if (error) throw new Error(`createStore(${storeName}) failed: ${error.message}`);
  console.log(`  [new] store: ${storeName} (${data.id})`);

  // Create default store_settings
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

  // Create default store_service_types (종목별 단가)
  await seedServiceTypes(supabase, data.id);

  return data.id;
}

// ─── Service Types seed ───────────────────────────────────────
async function seedServiceTypes(
  supabase: SupabaseClient,
  storeUuid: string
) {
  // 이미 존재하면 skip
  const { data: existing } = await supabase
    .from("store_service_types")
    .select("id")
    .eq("store_uuid", storeUuid)
    .limit(1);

  if (existing && existing.length > 0) {
    console.log(`  [skip] service_types already exist for store`);
    return;
  }

  const rows = [
    // 퍼블릭: 기본 90분 13만, 반티 45분 7만, 차3 15분 3만
    { service_type: "퍼블릭", time_type: "기본", time_minutes: 90, price: 130000, manager_deduction: 0, has_greeting_check: false, sort_order: 1 },
    { service_type: "퍼블릭", time_type: "반티", time_minutes: 45, price: 70000, manager_deduction: 0, has_greeting_check: false, sort_order: 2 },
    { service_type: "퍼블릭", time_type: "차3", time_minutes: 15, price: 30000, manager_deduction: 0, has_greeting_check: false, sort_order: 3 },
    // 셔츠: 기본 60분 14만, 반티 30분 7만, 차3 15분 3만
    { service_type: "셔츠", time_type: "기본", time_minutes: 60, price: 140000, manager_deduction: 0, has_greeting_check: true, sort_order: 4 },
    { service_type: "셔츠", time_type: "반티", time_minutes: 30, price: 70000, manager_deduction: 0, has_greeting_check: false, sort_order: 5 },
    { service_type: "셔츠", time_type: "차3", time_minutes: 15, price: 30000, manager_deduction: 0, has_greeting_check: false, sort_order: 6 },
    // 하퍼: 기본 60분 12만, 반티 30분 6만, 차3 15분 3만
    { service_type: "하퍼", time_type: "기본", time_minutes: 60, price: 120000, manager_deduction: 0, has_greeting_check: false, sort_order: 7 },
    { service_type: "하퍼", time_type: "반티", time_minutes: 30, price: 60000, manager_deduction: 0, has_greeting_check: false, sort_order: 8 },
    { service_type: "하퍼", time_type: "차3", time_minutes: 15, price: 30000, manager_deduction: 0, has_greeting_check: false, sort_order: 9 },
  ];

  const { error } = await supabase
    .from("store_service_types")
    .insert(rows.map((r) => ({ ...r, store_uuid: storeUuid, is_active: true })));

  if (error) {
    console.error(`  [error] seedServiceTypes: ${error.message}`);
  } else {
    console.log(`  [new] service_types: ${rows.length} rows`);
  }
}

// ─── Manager + Hostesses helper ────────────────────────────────────
async function createManagerWithHostesses(
  supabase: SupabaseClient,
  storeUuid: string,
  storeName: string,
  managerEmail: string,
  managerName: string,
  hostesses: { email: string; name: string }[]
) {
  console.log(`\n  --- ${managerName} ---`);

  // Manager auth + profile + membership + managers row
  const mgrUserId = await getOrCreateUser(supabase, managerEmail, managerName);
  const mgrMembershipId = await getOrCreateMembership(
    supabase,
    mgrUserId,
    storeUuid,
    "manager"
  );
  await getOrCreateManager(
    supabase,
    storeUuid,
    mgrMembershipId,
    managerName
  );

  createdAccounts.push({
    email: managerEmail,
    role: "manager",
    store: storeName,
    user_id: mgrUserId,
    membership_id: mgrMembershipId,
  });

  // Hostesses — manager_membership_id로 연결
  for (const h of hostesses) {
    const hUserId = await getOrCreateUser(supabase, h.email, h.name);
    const hMembershipId = await getOrCreateMembership(
      supabase,
      hUserId,
      storeUuid,
      "hostess"
    );
    await getOrCreateHostess(
      supabase,
      storeUuid,
      hMembershipId,
      mgrMembershipId,
      h.name
    );

    createdAccounts.push({
      email: h.email,
      role: "hostess",
      store: storeName,
      user_id: hUserId,
      membership_id: hMembershipId,
    });
  }
}

// ─── Main ──────────────────────────────────────────────────────────
async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("=== NOX SEED SCRIPT START ===\n");

  // ──────────────────────────────────────────────────────────────
  // 1. 마블 (기존 가게) — 룸 + 실장/아가씨 추가
  // ──────────────────────────────────────────────────────────────
  console.log("━━━ 마블 (기존) ━━━");
  console.log(`store_uuid: ${MARVEL_STORE_UUID}`);

  // 종목별 단가 seed
  await seedServiceTypes(supabase, MARVEL_STORE_UUID);

  // 룸 추가: 2, 3, 4번방
  for (const n of ["2", "3", "4"]) {
    await getOrCreateRoom(supabase, MARVEL_STORE_UUID, n, `${n}번방`);
  }

  // 실장2 + 아가씨 1~3
  await createManagerWithHostesses(
    supabase,
    MARVEL_STORE_UUID,
    "마블",
    "marvel-mgr2@nox-test.com",
    "마블실장2",
    [
      { email: "marvel-h1@nox-test.com", name: "마블아가씨1" },
      { email: "marvel-h2@nox-test.com", name: "마블아가씨2" },
      { email: "marvel-h3@nox-test.com", name: "마블아가씨3" },
    ]
  );

  // 실장3 + 아가씨 4~6
  await createManagerWithHostesses(
    supabase,
    MARVEL_STORE_UUID,
    "마블",
    "marvel-mgr3@nox-test.com",
    "마블실장3",
    [
      { email: "marvel-h4@nox-test.com", name: "마블아가씨4" },
      { email: "marvel-h5@nox-test.com", name: "마블아가씨5" },
      { email: "marvel-h6@nox-test.com", name: "마블아가씨6" },
    ]
  );

  // 실장4 + 아가씨 7~9
  await createManagerWithHostesses(
    supabase,
    MARVEL_STORE_UUID,
    "마블",
    "marvel-mgr4@nox-test.com",
    "마블실장4",
    [
      { email: "marvel-h7@nox-test.com", name: "마블아가씨7" },
      { email: "marvel-h8@nox-test.com", name: "마블아가씨8" },
      { email: "marvel-h9@nox-test.com", name: "마블아가씨9" },
    ]
  );

  // ──────────────────────────────────────────────────────────────
  // 2. 라이브 (신규 가게)
  // ──────────────────────────────────────────────────────────────
  console.log("\n━━━ 라이브 (신규) ━━━");
  const liveStoreUuid = await getOrCreateStore(supabase, "라이브", 5);
  console.log(`store_uuid: ${liveStoreUuid}`);

  // 룸 1~6
  for (const n of ["1", "2", "3", "4", "5", "6"]) {
    await getOrCreateRoom(supabase, liveStoreUuid, n, `${n}번방`);
  }

  // 사장
  console.log("\n  --- 라이브사장 ---");
  const liveOwnerUserId = await getOrCreateUser(
    supabase,
    "live-owner@nox-test.com",
    "라이브사장"
  );
  const liveOwnerMembershipId = await getOrCreateMembership(
    supabase,
    liveOwnerUserId,
    liveStoreUuid,
    "owner"
  );
  createdAccounts.push({
    email: "live-owner@nox-test.com",
    role: "owner",
    store: "라이브",
    user_id: liveOwnerUserId,
    membership_id: liveOwnerMembershipId,
  });

  // 실장1 + 아가씨 1~3
  await createManagerWithHostesses(
    supabase,
    liveStoreUuid,
    "라이브",
    "live-mgr1@nox-test.com",
    "라이브실장1",
    [
      { email: "live-h1@nox-test.com", name: "라이브아가씨1" },
      { email: "live-h2@nox-test.com", name: "라이브아가씨2" },
      { email: "live-h3@nox-test.com", name: "라이브아가씨3" },
    ]
  );

  // 실장2 + 아가씨 4~6
  await createManagerWithHostesses(
    supabase,
    liveStoreUuid,
    "라이브",
    "live-mgr2@nox-test.com",
    "라이브실장2",
    [
      { email: "live-h4@nox-test.com", name: "라이브아가씨4" },
      { email: "live-h5@nox-test.com", name: "라이브아가씨5" },
      { email: "live-h6@nox-test.com", name: "라이브아가씨6" },
    ]
  );

  // 실장3 + 아가씨 7~9
  await createManagerWithHostesses(
    supabase,
    liveStoreUuid,
    "라이브",
    "live-mgr3@nox-test.com",
    "라이브실장3",
    [
      { email: "live-h7@nox-test.com", name: "라이브아가씨7" },
      { email: "live-h8@nox-test.com", name: "라이브아가씨8" },
      { email: "live-h9@nox-test.com", name: "라이브아가씨9" },
    ]
  );

  // ──────────────────────────────────────────────────────────────
  // 3. 버닝 (신규 가게)
  // ──────────────────────────────────────────────────────────────
  console.log("\n━━━ 버닝 (신규) ━━━");
  const burningStoreUuid = await getOrCreateStore(supabase, "버닝", 6);
  console.log(`store_uuid: ${burningStoreUuid}`);

  // 룸 1~5
  for (const n of ["1", "2", "3", "4", "5"]) {
    await getOrCreateRoom(supabase, burningStoreUuid, n, `${n}번방`);
  }

  // 사장
  console.log("\n  --- 버닝사장 ---");
  const burningOwnerUserId = await getOrCreateUser(
    supabase,
    "burning-owner@nox-test.com",
    "버닝사장"
  );
  const burningOwnerMembershipId = await getOrCreateMembership(
    supabase,
    burningOwnerUserId,
    burningStoreUuid,
    "owner"
  );
  createdAccounts.push({
    email: "burning-owner@nox-test.com",
    role: "owner",
    store: "버닝",
    user_id: burningOwnerUserId,
    membership_id: burningOwnerMembershipId,
  });

  // 실장1 + 아가씨 1~3
  await createManagerWithHostesses(
    supabase,
    burningStoreUuid,
    "버닝",
    "burning-mgr1@nox-test.com",
    "버닝실장1",
    [
      { email: "burning-h1@nox-test.com", name: "버닝아가씨1" },
      { email: "burning-h2@nox-test.com", name: "버닝아가씨2" },
      { email: "burning-h3@nox-test.com", name: "버닝아가씨3" },
    ]
  );

  // 실장2 + 아가씨 4~6
  await createManagerWithHostesses(
    supabase,
    burningStoreUuid,
    "버닝",
    "burning-mgr2@nox-test.com",
    "버닝실장2",
    [
      { email: "burning-h4@nox-test.com", name: "버닝아가씨4" },
      { email: "burning-h5@nox-test.com", name: "버닝아가씨5" },
      { email: "burning-h6@nox-test.com", name: "버닝아가씨6" },
    ]
  );

  // 실장3 + 아가씨 7~9
  await createManagerWithHostesses(
    supabase,
    burningStoreUuid,
    "버닝",
    "burning-mgr3@nox-test.com",
    "버닝실장3",
    [
      { email: "burning-h7@nox-test.com", name: "버닝아가씨7" },
      { email: "burning-h8@nox-test.com", name: "버닝아가씨8" },
      { email: "burning-h9@nox-test.com", name: "버닝아가씨9" },
    ]
  );

  // ──────────────────────────────────────────────────────────────
  // 4. 황진이 (신규 가게)
  // ──────────────────────────────────────────────────────────────
  console.log("\n━━━ 황진이 (신규) ━━━");
  const hwangjiniStoreUuid = await getOrCreateStore(supabase, "황진이", 7);
  console.log(`store_uuid: ${hwangjiniStoreUuid}`);

  // 룸 1~6
  for (const n of ["1", "2", "3", "4", "5", "6"]) {
    await getOrCreateRoom(supabase, hwangjiniStoreUuid, n, `${n}번방`);
  }

  // 사장
  console.log("\n  --- 황진이사장 ---");
  const hwangjiniOwnerUserId = await getOrCreateUser(
    supabase,
    "hwangjini-owner@nox-test.com",
    "황진이사장"
  );
  const hwangjiniOwnerMembershipId = await getOrCreateMembership(
    supabase,
    hwangjiniOwnerUserId,
    hwangjiniStoreUuid,
    "owner"
  );
  createdAccounts.push({
    email: "hwangjini-owner@nox-test.com",
    role: "owner",
    store: "황진이",
    user_id: hwangjiniOwnerUserId,
    membership_id: hwangjiniOwnerMembershipId,
  });

  // 실장1 + 아가씨 1~5
  await createManagerWithHostesses(
    supabase,
    hwangjiniStoreUuid,
    "황진이",
    "hwangjini-mgr1@nox-test.com",
    "황진이실장1",
    [
      { email: "hwangjini-h1@nox-test.com", name: "황진이아가씨1" },
      { email: "hwangjini-h2@nox-test.com", name: "황진이아가씨2" },
      { email: "hwangjini-h3@nox-test.com", name: "황진이아가씨3" },
      { email: "hwangjini-h4@nox-test.com", name: "황진이아가씨4" },
      { email: "hwangjini-h5@nox-test.com", name: "황진이아가씨5" },
    ]
  );

  // 실장2 + 아가씨 6~10
  await createManagerWithHostesses(
    supabase,
    hwangjiniStoreUuid,
    "황진이",
    "hwangjini-mgr2@nox-test.com",
    "황진이실장2",
    [
      { email: "hwangjini-h6@nox-test.com", name: "황진이아가씨6" },
      { email: "hwangjini-h7@nox-test.com", name: "황진이아가씨7" },
      { email: "hwangjini-h8@nox-test.com", name: "황진이아가씨8" },
      { email: "hwangjini-h9@nox-test.com", name: "황진이아가씨9" },
      { email: "hwangjini-h10@nox-test.com", name: "황진이아가씨10" },
    ]
  );

  // 실장3 + 아가씨 11~15
  await createManagerWithHostesses(
    supabase,
    hwangjiniStoreUuid,
    "황진이",
    "hwangjini-mgr3@nox-test.com",
    "황진이실장3",
    [
      { email: "hwangjini-h11@nox-test.com", name: "황진이아가씨11" },
      { email: "hwangjini-h12@nox-test.com", name: "황진이아가씨12" },
      { email: "hwangjini-h13@nox-test.com", name: "황진이아가씨13" },
      { email: "hwangjini-h14@nox-test.com", name: "황진이아가씨14" },
      { email: "hwangjini-h15@nox-test.com", name: "황진이아가씨15" },
    ]
  );

  // ──────────────────────────────────────────────────────────────
  // 5. 결과 출력
  // ──────────────────────────────────────────────────────────────
  console.log("\n\n========================================");
  console.log("  SEED 완료 — 생성된 계정 목록");
  console.log("========================================");
  console.log(`  비밀번호 (전체): ${PASSWORD}\n`);

  console.log("  ┌──────────────────────────────┬──────────┬────────┬──────────────────────────────────────┐");
  console.log("  │ 이메일                        │ 역할     │ 가게   │ membership_id                        │");
  console.log("  ├──────────────────────────────┼──────────┼────────┼──────────────────────────────────────┤");
  for (const a of createdAccounts) {
    const em = a.email.padEnd(28);
    const ro = a.role.padEnd(8);
    const st = a.store.padEnd(6);
    console.log(`  │ ${em} │ ${ro} │ ${st} │ ${a.membership_id} │`);
  }
  console.log("  └──────────────────────────────┴──────────┴────────┴──────────────────────────────────────┘");

  console.log("\n  Store UUIDs:");
  console.log(`    마블: ${MARVEL_STORE_UUID}`);
  console.log(`    라이브: ${liveStoreUuid}`);
  console.log(`    버닝: ${burningStoreUuid}`);
  console.log(`    황진이: ${hwangjiniStoreUuid}`);

  console.log("\n=== DONE ===");
}

main().catch((err) => {
  console.error("\n❌ SEED FAILED:", err.message);
  process.exit(1);
});
