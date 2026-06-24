/**
 * 5~8F 모든 활성 매장 — phantom 식구 20명 확보.
 *
 *   - 시뮬 매장 (이미 20명) → skip
 *   - 매니저 0명 → "시드매니저" phantom 1명 자동 생성
 *   - 식구 < 20 → phantom 추가, 매니저들에게 라운드로빈 배정
 *   - 식구 category 균등 분배: 퍼블릭 8, 셔츠 6, 하퍼 6
 *   - 매장 종목 단가 (store_service_types) 없으면 시뮬 기본값 자동 생성
 *
 * 멱등: 식구 phone 중복 check. 매장 매니저 수 / 식구 수 마지막에 리포트.
 *
 * 실행:
 *   SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=...   \
 *     npx tsx scripts/seed-all-stores-20-hostess.ts
 */
import { createClient } from "@supabase/supabase-js"
import { randomBytes } from "node:crypto"

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
if (!URL || !KEY) { console.error("env"); process.exit(1) }
const sb = createClient(URL, KEY, { auth: { persistSession: false } })
const log = (...a: unknown[]) => console.log("[seed-20]", ...a)

const PHANTOM_DOMAIN = "nox-phantom.local"
const TARGET = 20

const NAME_POOL = [
  "채아", "지유", "미라", "하늘", "유나", "지연", "채은", "서연", "다은", "유리",
  "보영", "하영", "지효", "나래", "수민", "가은", "예린", "채린", "소희", "윤지",
  "라온", "다인", "하린", "보라", "다정", "시은", "단비", "햇살", "여울", "별",
  "윤아", "지원", "혜인", "민서", "예나", "수아", "유진", "주아", "현지", "재이",
  "지안", "수진", "혜원", "지민", "예진", "수빈", "혜진", "주연", "민지", "지수",
]

const SERVICE_TYPES = [
  { service_type: "퍼블릭", time_type: "기본", time_minutes: 90, price: 130000, manager_deduction: 5000, has_greeting_check: false, sort_order: 1 },
  { service_type: "퍼블릭", time_type: "반티", time_minutes: 45, price:  70000, manager_deduction: 5000, has_greeting_check: false, sort_order: 2 },
  { service_type: "퍼블릭", time_type: "차3",  time_minutes: 15, price:  30000, manager_deduction: 0,    has_greeting_check: false, sort_order: 3 },
  { service_type: "셔츠",   time_type: "기본", time_minutes: 60, price: 140000, manager_deduction: 5000, has_greeting_check: true,  sort_order: 4 },
  { service_type: "셔츠",   time_type: "반티", time_minutes: 30, price:  70000, manager_deduction: 5000, has_greeting_check: true,  sort_order: 5 },
  { service_type: "셔츠",   time_type: "차3",  time_minutes: 15, price:  30000, manager_deduction: 0,    has_greeting_check: false, sort_order: 6 },
  { service_type: "하퍼",   time_type: "기본", time_minutes: 60, price: 120000, manager_deduction: 5000, has_greeting_check: false, sort_order: 7 },
  { service_type: "하퍼",   time_type: "반티", time_minutes: 30, price:  60000, manager_deduction: 5000, has_greeting_check: false, sort_order: 8 },
  { service_type: "하퍼",   time_type: "차3",  time_minutes: 15, price:  30000, manager_deduction: 0,    has_greeting_check: false, sort_order: 9 },
] as const

// 카테고리 분배 — 20명에 P:H:S = 8:6:6
const CAT_DIST = [
  ...Array(8).fill("퍼블릭"),
  ...Array(6).fill("셔츠"),
  ...Array(6).fill("하퍼"),
] as const

function phantomEmail(phone: string) {
  return `phantom-${phone}-${randomBytes(4).toString("hex")}@${PHANTOM_DOMAIN}`
}
function phantomPassword() { return randomBytes(32).toString("base64url") }
function pick<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)] }

type Store = { id: string; store_name: string; floor: number }
type Manager = { membership_id: string; user_id: string; name: string }

async function loadStores(): Promise<Store[]> {
  const { data } = await sb
    .from("stores")
    .select("id, store_name, floor")
    .eq("is_active", true)
    .gte("floor", 5).lte("floor", 8)
    .order("floor", { ascending: true })
    .order("store_name", { ascending: true })
  return (data ?? []) as Store[]
}

async function loadManagers(storeUuid: string): Promise<Manager[]> {
  const { data } = await sb
    .from("store_memberships")
    .select("id, profile_id, profiles!store_memberships_profile_id_fkey(full_name)")
    .eq("store_uuid", storeUuid)
    .eq("role", "manager")
    .eq("status", "approved")
  type Row = { id: string; profile_id: string; profiles: { full_name: string } | { full_name: string }[] | null }
  return ((data ?? []) as Row[]).map((r) => {
    const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles
    return { membership_id: r.id, user_id: r.profile_id, name: p?.full_name ?? "?" }
  }).filter((m) => m.user_id)
}

async function ensureServiceTypes(storeUuid: string) {
  const { data: existing } = await sb
    .from("store_service_types")
    .select("service_type, time_type")
    .eq("store_uuid", storeUuid)
  const have = new Set(((existing ?? []) as Array<{ service_type: string; time_type: string }>).map((s) => `${s.service_type}/${s.time_type}`))
  for (const t of SERVICE_TYPES) {
    if (have.has(`${t.service_type}/${t.time_type}`)) continue
    await sb.from("store_service_types").insert({ store_uuid: storeUuid, ...t })
  }
}

async function ensureSeedManager(store: Store): Promise<Manager> {
  // store id slug 를 name 에 포함 — 같은 이름 매장 (e.g. 신세계 2개) 충돌 방지
  const slug = store.id.slice(0, 6)
  const email = `seed-mgr-${slug}@${PHANTOM_DOMAIN}`
  const name = `시드매니저-${store.store_name}-${slug}`
  // 기존 user 있는지 확인 (멱등, full_name 매칭)
  const { data: existProf } = await sb
    .from("profiles")
    .select("id")
    .eq("full_name", name)
    .maybeSingle()
  let userId: string | null = existProf?.id ?? null
  if (!userId) {
    const { data: created, error } = await sb.auth.admin.createUser({
      email,
      password: phantomPassword(),
      email_confirm: true,
      user_metadata: { full_name: name, phantom: true, seed: true },
    })
    if (error || !created?.user) throw new Error(`seed mgr createUser: ${error?.message}`)
    userId = created.user.id
    await sb.from("profiles").upsert({ id: userId, full_name: name, is_active: true }, { onConflict: "id" })
  }

  // membership (manager, approved). is_primary=false — 한 profile 한 primary 제약 회피.
  const { data: existMem } = await sb
    .from("store_memberships")
    .select("id")
    .eq("profile_id", userId)
    .eq("store_uuid", store.id)
    .eq("role", "manager")
    .maybeSingle()
  let memId: string | null = existMem?.id ?? null
  if (!memId) {
    const { data, error } = await sb
      .from("store_memberships")
      .insert({
        profile_id: userId,
        store_uuid: store.id,
        role: "manager",
        status: "approved",
        is_primary: false,
        approved_at: new Date().toISOString(),
      })
      .select("id")
      .single()
    if (error || !data) throw new Error(`seed mgr mem: ${error?.message}`)
    memId = data.id
  }

  // managers 테이블 row 도 보장
  const { data: existMgr } = await sb
    .from("managers")
    .select("id")
    .eq("store_uuid", store.id)
    .eq("membership_id", memId)
    .maybeSingle()
  if (!existMgr) {
    await sb.from("managers").insert({ store_uuid: store.id, membership_id: memId, name, is_active: true })
  }
  if (!memId || !userId) throw new Error("seed mgr 식별자 누락")
  return { membership_id: memId, user_id: userId, name }
}

async function addHostess(
  store: Store,
  managerMembershipId: string,
  name: string,
  phone: string,
  category: "퍼블릭" | "셔츠" | "하퍼",
): Promise<boolean> {
  // 중복 check (phone)
  const { data: dup } = await sb
    .from("hostesses")
    .select("id")
    .eq("store_uuid", store.id)
    .eq("phone", phone)
    .maybeSingle()
  if (dup) return false

  const email = phantomEmail(phone)
  const { data: created, error: cErr } = await sb.auth.admin.createUser({
    email,
    password: phantomPassword(),
    email_confirm: true,
    user_metadata: { full_name: name, phone, phantom: true, seed: true },
  })
  if (cErr || !created?.user) {
    log(`  ${name} createUser 실패: ${cErr?.message}`)
    return false
  }
  const userId = created.user.id

  await sb.from("profiles").upsert({ id: userId, full_name: name, phone, is_active: true }, { onConflict: "id" })

  const { data: mem, error: mErr } = await sb
    .from("store_memberships")
    .insert({
      profile_id: userId,
      store_uuid: store.id,
      role: "hostess",
      status: "approved",
      is_primary: true,
      approved_at: new Date().toISOString(),
    })
    .select("id")
    .single()
  if (mErr || !mem) {
    log(`  ${name} membership 실패: ${mErr?.message}`)
    return false
  }

  const { error: hErr } = await sb
    .from("hostesses")
    .insert({
      store_uuid: store.id,
      membership_id: mem.id,
      manager_membership_id: managerMembershipId,
      name,
      phone,
      category,
      is_active: true,
    })
  if (hErr) {
    log(`  ${name} hostess 실패: ${hErr.message}`)
    return false
  }
  return true
}

async function processStore(store: Store, storeIdx: number) {
  // 매니저 확보
  let managers = await loadManagers(store.id)
  if (managers.length === 0) {
    const m = await ensureSeedManager(store)
    managers = [m]
    log(`  [${store.store_name}] 시드매니저 1명 생성`)
  }

  // 종목 단가 확보
  await ensureServiceTypes(store.id)

  // 현재 식구 수
  const { count } = await sb
    .from("hostesses")
    .select("id", { count: "exact", head: true })
    .eq("store_uuid", store.id)
    .eq("is_active", true)
  const have = count ?? 0
  if (have >= TARGET) {
    log(`  [${store.store_name}] skip — 이미 ${have}/${TARGET}`)
    return { added: 0 }
  }
  const need = TARGET - have

  let added = 0
  // hostess seq 시작: storeIdx*100 + (TARGET-need) 부터
  for (let i = 0; i < need; i++) {
    const slotIdx = have + i
    const baseName = NAME_POOL[slotIdx % NAME_POOL.length]
    const suffix = String(Math.floor(slotIdx / NAME_POOL.length) + 1).padStart(2, "0")
    const name = `${baseName}${suffix}`
    // 11자리 phone: 010 + 7 7 + 4자리 store_idx + 3자리 seq = 010 77 XXXX YYY (= 12자리, too long)
    // → 010 + 8XX + XXXX YYY = 11자리. 8 으로 시작 (사용 안 함). 80000 0000 ~ 89999 9999.
    const phoneSeq = (storeIdx * 100 + slotIdx).toString().padStart(7, "0")
    const phone = `0108${phoneSeq}` // 11자리
    const category = CAT_DIST[slotIdx % CAT_DIST.length]
    const mgrIdx = i % managers.length
    const ok = await addHostess(store, managers[mgrIdx].membership_id, name, phone, category)
    if (ok) added++
  }
  log(`  [${store.store_name}] ${added}명 추가 (${have} → ${have + added})`)
  return { added }
}

async function main() {
  log("=== 모든 매장 식구 20명 확보 ===")
  const stores = await loadStores()
  log(`대상 매장 ${stores.length}`)
  let totalAdded = 0
  let storesTouched = 0
  for (let i = 0; i < stores.length; i++) {
    const r = await processStore(stores[i], i)
    totalAdded += r.added
    if (r.added > 0) storesTouched++
  }
  log("=== 완료 ===")
  log(`매장 ${storesTouched} 매장에 ${totalAdded} 명 추가 (총 ${stores.length} 매장 검사)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
