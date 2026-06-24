/**
 * 마블 매장 — 10명 아가씨 보강 (현재 2명 → 10명).
 *
 *   - phantom auth user 생성 (가입 안 한 상태, 실 운영처럼 실장이 등록)
 *   - profile / store_memberships / hostesses 3종 INSERT
 *   - 모두 조준성 매니저 (6dd62734-9327-4e82-b3dc-b24ffb808a82) 에 할당
 *   - category 균등 분배 — 퍼블릭 4, 셔츠 3, 하퍼 3
 */
import { createClient } from "@supabase/supabase-js"
import { randomBytes } from "node:crypto"

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
if (!URL || !KEY) { console.error("env"); process.exit(1) }
const sb = createClient(URL, KEY, { auth: { persistSession: false } })
const log = (...a: unknown[]) => console.log("[marvel-h]", ...a)

const MARVEL_ID = "ad1b95f0-5023-4c93-9282-efbb3d94ce76"
const JOJUNSEONG_MGR_MID = "6dd62734-9327-4e82-b3dc-b24ffb808a82"
const PHANTOM_DOMAIN = "nox-phantom.local"

// 8명 신규 — 박/김미리 제외하고 10 total
const NEW_HOSTESSES = [
  { name: "유나", phone: "01044440001", category: "퍼블릭" },
  { name: "지유", phone: "01044440002", category: "퍼블릭" },
  { name: "다은", phone: "01044440003", category: "퍼블릭" },
  { name: "채아", phone: "01044440004", category: "퍼블릭" },
  { name: "보영", phone: "01044440005", category: "셔츠" },
  { name: "예린", phone: "01044440006", category: "셔츠" },
  { name: "지효", phone: "01044440007", category: "셔츠" },
  { name: "수민", phone: "01044440008", category: "하퍼" },
  { name: "다인", phone: "01044440009", category: "하퍼" },
  { name: "별",   phone: "01044440010", category: "하퍼" },
] as const

function phantomEmail(phone: string) {
  const r = randomBytes(4).toString("hex")
  return `phantom-${phone}-${r}@${PHANTOM_DOMAIN}`
}
function phantomPassword() { return randomBytes(32).toString("base64url") }

async function ensureHostess(h: { name: string; phone: string; category: string }) {
  // 중복 check — 같은 phone 이미 있으면 skip
  const { data: existing } = await sb
    .from("hostesses")
    .select("id, name")
    .eq("store_uuid", MARVEL_ID)
    .eq("phone", h.phone)
    .maybeSingle()
  if (existing) {
    log(`  skip ${h.name} — already exists`)
    return false
  }

  // 1. phantom auth user
  const email = phantomEmail(h.phone)
  const { data: created, error: cErr } = await sb.auth.admin.createUser({
    email,
    password: phantomPassword(),
    email_confirm: true,
    user_metadata: { full_name: h.name, phone: h.phone, phantom: true },
  })
  if (cErr || !created?.user) { log(`  fail ${h.name}: ${cErr?.message}`); return false }
  const userId = created.user.id

  // 2. profile upsert
  await sb.from("profiles").upsert({ id: userId, full_name: h.name, phone: h.phone, is_active: true }, { onConflict: "id" })

  // 3. membership (approved)
  const { data: mem } = await sb
    .from("store_memberships")
    .insert({
      profile_id: userId,
      store_uuid: MARVEL_ID,
      role: "hostess",
      status: "approved",
      is_primary: true,
      approved_at: new Date().toISOString(),
    })
    .select("id")
    .single()
  if (!mem) { log(`  membership fail ${h.name}`); return false }

  // 4. hostess insert (category set + manager 할당)
  const { error: hErr } = await sb
    .from("hostesses")
    .insert({
      store_uuid: MARVEL_ID,
      membership_id: mem.id,
      manager_membership_id: JOJUNSEONG_MGR_MID,
      name: h.name,
      phone: h.phone,
      category: h.category,
      is_active: true,
    })
  if (hErr) { log(`  hostess fail ${h.name}: ${hErr.message}`); return false }
  log(`  ✓ ${h.name} (${h.category})`)
  return true
}

async function main() {
  log(`마블 ${MARVEL_ID} — 8명 phantom 추가 (조준성 매니저 배정)`)
  let ok = 0
  for (const h of NEW_HOSTESSES) {
    if (await ensureHostess(h)) ok++
  }
  log(`완료 — ${ok} 명 추가`)
}

main().catch((e) => { console.error(e); process.exit(1) })
