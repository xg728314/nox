/**
 * Auth.users 정리 — NUKE.sql 실행 후 마지막 단계.
 *
 * 보존: email = xg728314@gmail.com 1명만.
 * 삭제: 그 외 모든 auth.users (Supabase Admin API).
 *
 * 사용:
 *   npx tsx scripts/cleanup/delete-auth-users.ts                # dry-run
 *   npx tsx scripts/cleanup/delete-auth-users.ts --apply
 *
 * 환경:
 *   NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js"

const KEEP_EMAIL = "xg728314@gmail.com"
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
if (!URL || !KEY) {
  console.error("✗ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요")
  process.exit(1)
}
const APPLY = process.argv.includes("--apply")
const sb = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } })

async function main() {
  console.log(`=== auth.users 정리 [${APPLY ? "APPLY" : "DRY-RUN"}] ===\n`)

  const all: Array<{ id: string; email?: string }> = []
  let page = 1
  while (true) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 })
    if (error) { console.error("✗ listUsers:", error.message); process.exit(1) }
    if (!data?.users || data.users.length === 0) break
    all.push(...data.users.map(u => ({ id: u.id, email: u.email ?? undefined })))
    if (data.users.length < 200) break
    page++
  }
  console.log(`총 ${all.length} 명`)

  const keep = all.filter(u => u.email === KEEP_EMAIL)
  const del = all.filter(u => u.email !== KEEP_EMAIL)

  if (keep.length === 0) {
    console.error(`⛔ ${KEEP_EMAIL} 못 찾음. 절대 진행 X.`)
    process.exit(2)
  }
  console.log(`✓ KEEP ${keep.length} 명: ${keep.map(u => u.email).join(", ")}`)
  console.log(`✗ DELETE ${del.length} 명`)
  for (const u of del.slice(0, 5)) console.log(`  - ${u.email}`)
  if (del.length > 5) console.log(`  ... + ${del.length - 5} 명`)

  if (!APPLY) {
    console.log("\n[DRY-RUN] --apply 추가하면 실제 삭제.")
    return
  }

  console.log("\n[APPLY] 삭제 시작...")
  let ok = 0, fail = 0
  for (const u of del) {
    const { error } = await sb.auth.admin.deleteUser(u.id)
    if (error) { console.warn(`  ✗ ${u.email}: ${error.message}`); fail++ }
    else ok++
  }
  console.log(`\n✓ 완료: ${ok} 성공 / ${fail} 실패`)
}

main().catch(e => { console.error("✗ 예외:", e); process.exit(1) })
