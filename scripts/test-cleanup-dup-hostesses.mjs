/**
 * 매장별 동명이인 hostesses 병합 · 참여 이력 없는 duplicate 삭제.
 *
 * 규칙:
 *   1. 같은 매장 · 같은 이름 hostesses 그룹핑
 *   2. 각 그룹에서 canonical = 가장 오래된 created_at (or 참여 이력 있는 것)
 *   3. duplicate (참여 이력 없음) → hostesses row delete + store_memberships delete + profile delete
 *   4. 참여 이력 있는 duplicate → 로그만 (사용자 판단 필요)
 *
 * DRY_RUN 환경변수 true 시 실제 delete 안 함.
 */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const MARVEL = "ad1b95f0-5023-4c93-9282-efbb3d94ce76"
const DRY = process.env.DRY_RUN === "true"
if (DRY) console.log("⚠ DRY_RUN=true · 실제 삭제 없음\n")

// Marvel 소속 hostesses 전부
const { data: hosts } = await sb.from("hostesses")
  .select("id, membership_id, name, created_at, is_active, deleted_at")
  .eq("store_uuid", MARVEL).is("deleted_at", null)

const byName = new Map()
for (const h of (hosts ?? [])) {
  if (!byName.has(h.name)) byName.set(h.name, [])
  byName.get(h.name).push(h)
}
const dups = [...byName.entries()].filter(([, arr]) => arr.length > 1)
console.log(`총 hostesses: ${hosts.length} · 동명이인 그룹: ${dups.length}`)

// 참여 이력 조회 (모든 dup mids 한 번에)
const allDupMids = dups.flatMap(([, arr]) => arr.map(h => h.membership_id))
console.log(`체크 대상 memberships: ${allDupMids.length}건`)

// chunked count 조회
const usedMids = new Set()
const CHUNK = 100
for (let i = 0; i < allDupMids.length; i += CHUNK) {
  const chunk = allDupMids.slice(i, i + CHUNK)
  const { data } = await sb.from("session_participants")
    .select("membership_id").in("membership_id", chunk)
  for (const p of (data ?? [])) usedMids.add(p.membership_id)
}
console.log(`참여 이력 있음: ${usedMids.size}건\n`)

let deletedHosts = 0, deletedMems = 0, deletedProfs = 0, keptWithHistory = 0

for (const [name, arr] of dups) {
  // canonical: 참여 이력 있는 것 우선, 없으면 가장 오래된 것
  const withHistory = arr.filter(h => usedMids.has(h.membership_id))
  const canonical = withHistory[0] ?? arr.sort((a,b) => new Date(a.created_at) - new Date(b.created_at))[0]

  const toDelete = []
  for (const h of arr) {
    if (h.membership_id === canonical.membership_id) continue
    if (usedMids.has(h.membership_id)) {
      keptWithHistory++
      continue  // 참여 이력 있는 duplicate → 유지 (병합은 별도)
    }
    toDelete.push(h)
  }

  if (toDelete.length === 0) continue

  if (DRY) {
    console.log(`[DRY] ${name}: ${arr.length}명 → canonical ${canonical.membership_id.slice(0,8)} · 삭제 ${toDelete.length}`)
    continue
  }

  // cascade delete: hostesses → store_memberships → profiles
  const delMids = toDelete.map(h => h.membership_id)
  const { data: mems } = await sb.from("store_memberships").select("id, profile_id").in("id", delMids)
  const profIds = (mems ?? []).map(m => m.profile_id).filter(Boolean)

  // 1. hostesses hard delete
  const { error: hErr } = await sb.from("hostesses").delete().in("membership_id", delMids)
  if (hErr) { console.log(`❌ ${name}: hostesses delete failed - ${hErr.message}`); continue }
  deletedHosts += toDelete.length

  // 2. alias_learnings (resolved_id 참조 있으면 정리)
  await sb.from("alias_learnings").delete().eq("resolved_type", "hostess").in("resolved_id", delMids)

  // 3. store_memberships
  const { error: memErr } = await sb.from("store_memberships").delete().in("id", delMids)
  if (!memErr) deletedMems += delMids.length

  // 4. profiles (다른 참조 없으면)
  if (profIds.length > 0) {
    // 다른 store_memberships 있으면 skip
    const { data: otherMems } = await sb.from("store_memberships").select("profile_id").in("profile_id", profIds)
    const stillUsed = new Set((otherMems ?? []).map(m => m.profile_id))
    const orphanProfs = profIds.filter(p => !stillUsed.has(p))
    if (orphanProfs.length > 0) {
      await sb.from("profiles").delete().in("id", orphanProfs)
      deletedProfs += orphanProfs.length
    }
  }

  console.log(`✓ ${name}: ${arr.length} → 1 · 삭제 ${toDelete.length}`)
}

console.log(`\n결과:`)
console.log(`  hostesses 삭제: ${deletedHosts}`)
console.log(`  memberships 삭제: ${deletedMems}`)
console.log(`  profiles 삭제: ${deletedProfs}`)
console.log(`  참여 이력 있어 유지된 동명이인: ${keptWithHistory} (수동 병합 필요)`)
