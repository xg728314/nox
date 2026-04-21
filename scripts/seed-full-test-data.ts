/**
 * NOX Full Seed — 4매장 × (실장 10 + 아가씨 30) = 160명
 *
 * 각 매장:
 *   실장 10명: {store}-mgr1~10@nox-test.com
 *   아가씨 30명:
 *     퍼블릭 10명: {store}-pub1~10@nox-test.com
 *     셔츠   10명: {store}-shirt1~10@nox-test.com
 *     하퍼   10명: {store}-harper1~10@nox-test.com
 *
 * 비밀번호: Test1234! (전체)
 * 실행: npx tsx scripts/seed-full-test-data.ts
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// SECURITY (SECURITY_FIX_PLAN.md TASK 0-1): keys MUST come from env.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[seed-full-test-data] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in your shell or .env.local before running.");
  process.exit(1);
}
const PASSWORD = process.env.SEED_PASSWORD ?? "Test1234!";

const STORES_CONFIG = [
  { key: "marvel",    label: "마블",   uuid: "ad1b95f0-5023-4c93-9282-efbb3d94ce76", floor: 5, existing: true },
  { key: "live",      label: "라이브", uuid: "d7f62182-48cb-4731-b694-b1a02d60b1fa", floor: 5, existing: true },
  { key: "burning",   label: "버닝",   uuid: "147b2115-6ece-48ed-9ca0-63fd31ea2c38", floor: 6, existing: true },
  { key: "hwangjini", label: "황진이", uuid: "cbacf389-4cd7-4459-b97d-d7775ddaf8d0", floor: 7, existing: true },
];

const CATEGORIES = [
  { suffix: "pub",    label: "퍼블릭", category: "퍼블릭", count: 10 },
  { suffix: "shirt",  label: "셔츠",   category: "셔츠",   count: 10 },
  { suffix: "harper", label: "하퍼",   category: "하퍼",   count: 10 },
];

let created = 0;
let skipped = 0;

// ─── Helpers ──────────────────────────────────────────────

async function getOrCreateUser(
  supabase: SupabaseClient, email: string, fullName: string
): Promise<string> {
  const { data: existingUsers } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const existing = existingUsers?.users?.find((u) => u.email === email);

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
  created++;
  return userId;
}

async function getOrCreateMembership(
  supabase: SupabaseClient, profileId: string, storeUuid: string, role: string
): Promise<string> {
  const { data: existing } = await supabase
    .from("store_memberships").select("id")
    .eq("profile_id", profileId).eq("store_uuid", storeUuid).eq("role", role)
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
    .maybeSingle();

  if (existing) {
    // category 업데이트 (기존 데이터에 category가 없을 수 있음)
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

// ─── Main ─────────────────────────────────────────────────

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("=== NOX FULL SEED START ===");
  console.log(`4매장 × (실장10 + 아가씨30) = 160명\n`);

  const summary: { store: string; managers: string[]; hostesses: { cat: string; ids: string[] }[] }[] = [];

  for (const store of STORES_CONFIG) {
    console.log(`\n${"━".repeat(50)}`);
    console.log(`  ${store.label} (${store.uuid.slice(0, 8)}...)`);
    console.log(`${"━".repeat(50)}`);

    const storeManagers: string[] = [];
    const storeHostesses: { cat: string; ids: string[] }[] = [];

    // ── 실장 10명 ──
    console.log(`\n  [실장 10명]`);
    const mgrMembershipIds: string[] = [];

    for (let i = 1; i <= 10; i++) {
      const email = `${store.key}-mgr${i}@nox-test.com`;
      const name = `${store.label}실장${i}`;

      const userId = await getOrCreateUser(supabase, email, name);
      const membershipId = await getOrCreateMembership(supabase, userId, store.uuid, "manager");
      await getOrCreateManager(supabase, store.uuid, membershipId, name);

      mgrMembershipIds.push(membershipId);
      storeManagers.push(membershipId);
      process.stdout.write(`    ${name} `);
    }
    console.log("");

    // ── 아가씨 30명 (종목별 10명) ──
    for (const cat of CATEGORIES) {
      console.log(`\n  [${cat.label} 아가씨 ${cat.count}명]`);
      const catIds: string[] = [];

      for (let i = 1; i <= cat.count; i++) {
        const email = `${store.key}-${cat.suffix}${i}@nox-test.com`;
        const name = `${store.label}${cat.label}${i}`;
        // 실장 라운드로빈 배정
        const assignedMgr = mgrMembershipIds[(i - 1) % mgrMembershipIds.length];

        const userId = await getOrCreateUser(supabase, email, name);
        const membershipId = await getOrCreateMembership(supabase, userId, store.uuid, "hostess");
        await getOrCreateHostess(supabase, store.uuid, membershipId, assignedMgr, name, cat.category);

        catIds.push(membershipId);
        process.stdout.write(`    ${name} `);
      }
      console.log("");
      storeHostesses.push({ cat: cat.category, ids: catIds });
    }

    summary.push({ store: store.label, managers: storeManagers, hostesses: storeHostesses });
  }

  // ── 결과 요약 ──
  console.log(`\n\n${"=".repeat(60)}`);
  console.log("  SEED 완료");
  console.log(`${"=".repeat(60)}`);
  console.log(`  생성: ${created} | 스킵(기존): ${skipped} | 합계: ${created + skipped}`);
  console.log(`  비밀번호: ${PASSWORD}\n`);

  for (const s of summary) {
    console.log(`  ${s.store}:`);
    console.log(`    실장: ${s.managers.length}명`);
    for (const h of s.hostesses) {
      console.log(`    ${h.cat}: ${h.ids.length}명`);
    }
  }

  console.log(`\n  이메일 패턴:`);
  console.log(`    실장: {store}-mgr{1~10}@nox-test.com`);
  console.log(`    퍼블릭: {store}-pub{1~10}@nox-test.com`);
  console.log(`    셔츠: {store}-shirt{1~10}@nox-test.com`);
  console.log(`    하퍼: {store}-harper{1~10}@nox-test.com`);
  console.log(`    store = marvel | live | burning | hwangjini`);

  console.log("\n=== DONE ===");
}

main().catch((err) => {
  console.error(`\nSEED FAILED: ${err.message}`);
  process.exit(1);
});
