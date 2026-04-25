/**
 * NOX 계정 정리 — 실전 투입 전 nuke.
 *
 * 보존: email = xg728314@gmail.com (운영자) **1명만**
 * 삭제: 그 외 전부 (orphan profiles / orphan memberships 포함)
 *
 * 사용:
 *   npx tsx scripts/cleanup/cleanup-test-accounts.ts                  # dry-run
 *   npx tsx scripts/cleanup/cleanup-test-accounts.ts --apply
 *   npx tsx scripts/cleanup/cleanup-test-accounts.ts --apply --include-empty-stores
 *
 * 환경:
 *   NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *
 * 핵심 변경 (R29):
 *   기존엔 auth.users 를 listUsers() 로 iterate 후 그 id 로 cascade 삭제했음.
 *   문제: auth.users 는 사라졌는데 profiles / store_memberships 만 남은
 *   orphan row 가 있으면 빠짐 → /admin/members 페이지에 95건 같은 잔재.
 *
 *   이번 버전은 inverse 정책: keep_user_id (1개) 와 keep_membership_ids 만
 *   확정하고, 모든 table 에서 "NOT IN (keep)" 으로 일괄 삭제. orphan 도 잡힘.
 */

import { createClient } from "@supabase/supabase-js"
import * as readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"

const KEEP_EMAIL = "xg728314@gmail.com"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("✗ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env 필요")
  process.exit(1)
}

const args = new Set(process.argv.slice(2))
const APPLY = args.has("--apply")
const INCLUDE_EMPTY_STORES = args.has("--include-empty-stores")

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function bold(s: string) { return `\x1b[1m${s}\x1b[0m` }
function green(s: string) { return `\x1b[32m${s}\x1b[0m` }
function yellow(s: string) { return `\x1b[33m${s}\x1b[0m` }
function red(s: string) { return `\x1b[31m${s}\x1b[0m` }

async function main() {
  console.log(bold(`\n=== NOX 계정 nuke ${APPLY ? red("[APPLY]") : green("[DRY-RUN]")} ===\n`))

  // ─── 1) keep user 확정 ─────────────────────────────────────
  const keepUserId = await findKeepUser()
  if (!keepUserId) {
    console.error(red(`⛔ ${KEEP_EMAIL} 계정 없음. 절대 진행 X (운영자 잠금 위험).`))
    process.exit(2)
  }
  console.log(green(`✓ KEEP user_id: ${keepUserId} (${KEEP_EMAIL})`))

  // ─── 2) keep memberships ────────────────────────────────────
  const { data: keepMems } = await sb
    .from("store_memberships")
    .select("id, store_uuid, role, status")
    .eq("profile_id", keepUserId)
  const keepMembershipIds = (keepMems ?? []).map(m => m.id as string)
  const keepStoreIds = [...new Set((keepMems ?? []).map(m => m.store_uuid as string))]
  console.log(green(`✓ KEEP memberships: ${keepMembershipIds.length}`))
  for (const m of keepMems ?? []) {
    console.log(`  - ${m.role} @ ${m.store_uuid} (${m.status})`)
  }
  console.log(green(`✓ KEEP stores: ${keepStoreIds.length}`))

  // ─── 3) 영향 카운트 (NOT IN keep) ──────────────────────────
  console.log(bold("\n[ 삭제될 row 개수 ]"))
  const counts = await Promise.all([
    countNotIn("auth.users (excl. keep)", () => listAuthUsersCount(keepUserId)),
    countNotIn("profiles", async () => countWhereNotIn("profiles", "id", [keepUserId])),
    countNotIn("store_memberships", async () => countWhereNotIn("store_memberships", "profile_id", [keepUserId])),
    countNotIn("hostesses", async () => countWhereNotIn("hostesses", "membership_id", keepMembershipIds)),
    countNotIn("managers", async () => countWhereNotIn("managers", "membership_id", keepMembershipIds)),
    countNotIn("session_participants", async () => countWhereNotIn("session_participants", "membership_id", keepMembershipIds)),
    countNotIn("staff_attendance", async () => countWhereNotIn("staff_attendance", "membership_id", keepMembershipIds)),
    countNotIn("transfer_requests (hostess)", async () => countWhereNotIn("transfer_requests", "hostess_membership_id", keepMembershipIds)),
    countNotIn("audit_events", async () => countWhereNotIn("audit_events", "actor_profile_id", [keepUserId])),
    countNotIn("user_mfa_settings", async () => countWhereNotIn("user_mfa_settings", "user_id", [keepUserId])),
    countNotIn("trusted_devices", async () => countWhereNotIn("trusted_devices", "user_id", [keepUserId])),
  ])
  for (const c of counts) console.log(`  ${c.label.padEnd(35)} ${c.value}`)

  // ─── 4) 매장 분류 ─────────────────────────────────────────
  const { data: allStores } = await sb
    .from("stores")
    .select("id, store_name")
    .is("deleted_at", null)
  const emptyStores = (allStores ?? []).filter(s => !keepStoreIds.includes(s.id as string))
  if (emptyStores.length > 0) {
    console.log(yellow(`\n⚠ 운영자 미소속 매장 ${emptyStores.length}개:`))
    for (const s of emptyStores) console.log(`  - ${s.store_name} (${s.id})`)
    console.log(INCLUDE_EMPTY_STORES
      ? yellow("  → --include-empty-stores 로 함께 삭제됨")
      : "  → 보존됨. 같이 삭제하려면 --include-empty-stores")
  }

  // ─── 5) DRY-RUN 종료 ────────────────────────────────────
  if (!APPLY) {
    console.log(green("\n[DRY-RUN] 변경 없음. 의도 확인 후 --apply 추가하여 재실행."))
    return
  }

  // ─── 6) 최종 확인 ───────────────────────────────────────
  console.log(red(bold("\n⚠ APPLY — 실제 삭제 직전")))
  const rl = readline.createInterface({ input, output })
  const answer = await rl.question(`정확히 "DELETE" 라고 입력해서 확인 → `)
  rl.close()
  if (answer.trim() !== "DELETE") {
    console.log("취소됨.")
    return
  }

  // ─── 7) 삭제 (FK 순서대로 NOT IN keep) ────────────────────
  console.log(bold("\n[ DELETING ]"))

  // 7a. participant_time_segments — session_participants 먼저 lookup
  const delPartIds = await selectIdsNotIn("session_participants", "id", "membership_id", keepMembershipIds)
  await deleteWhereInBatch("participant_time_segments", "participant_id", delPartIds)

  // 7b. session_participants
  await deleteWhereNotIn("session_participants", "membership_id", keepMembershipIds)

  // 7c. orders — ordered_by NOT IN keep
  await deleteWhereNotIn("orders", "ordered_by", [keepUserId])

  // 7d. transfer_requests
  await deleteWhereNotIn("transfer_requests", "hostess_membership_id", keepMembershipIds)

  // 7e. cross_store_work_records
  await deleteWhereNotIn("cross_store_work_records", "hostess_membership_id", keepMembershipIds)

  // 7f. staff_attendance / pre_settlements
  await deleteWhereNotIn("staff_attendance", "membership_id", keepMembershipIds)
  await deleteWhereNotIn("pre_settlements", "requester_membership_id", keepMembershipIds)

  // 7g. chat
  await deleteWhereNotIn("chat_participants", "membership_id", keepMembershipIds)

  // 7h. hostesses / managers
  await deleteWhereNotIn("hostesses", "membership_id", keepMembershipIds)
  await deleteWhereNotIn("managers", "membership_id", keepMembershipIds)

  // 7i. audit_events
  await deleteWhereNotIn("audit_events", "actor_profile_id", [keepUserId])

  // 7j. MFA / trusted device / reauth
  await deleteWhereNotIn("user_mfa_settings", "user_id", [keepUserId])
  await deleteWhereNotIn("trusted_devices", "user_id", [keepUserId])
  await deleteWhereNotIn("reauth_verifications", "user_id", [keepUserId])

  // 7k. room_sessions — opened_by NOT IN keep. orphan session 정리.
  await deleteWhereNotIn("room_sessions", "opened_by", [keepUserId])

  // 7l. store_memberships — keep 만 남김
  await deleteWhereNotIn("store_memberships", "profile_id", [keepUserId])

  // 7m. profiles — keep 만 남김
  await deleteWhereNotIn("profiles", "id", [keepUserId])

  // ─── 8) 빈 매장 cascade (옵션) ────────────────────────────
  if (INCLUDE_EMPTY_STORES) {
    for (const s of emptyStores) {
      console.log(`  store: ${s.store_name} 삭제`)
      const sid = s.id as string
      await sb.from("rooms").delete().eq("store_uuid", sid)
      await sb.from("store_settings").delete().eq("store_uuid", sid)
      await sb.from("store_service_types").delete().eq("store_uuid", sid)
      await sb.from("store_operating_days").delete().eq("store_uuid", sid)
      await sb.from("stores").delete().eq("id", sid)
    }
  }

  // ─── 9) auth.users — keep 외 모두 삭제 ──────────────────────
  await deleteAuthUsersExcept(keepUserId)

  console.log(green(bold("\n✓ 완료\n")))
  console.log("검증:")
  console.log("  SELECT count(*) FROM auth.users;            -- 1")
  console.log("  SELECT count(*) FROM profiles;              -- 1")
  console.log("  SELECT count(*) FROM store_memberships;     -- " + keepMembershipIds.length)
}

async function findKeepUser(): Promise<string | null> {
  let page = 1
  while (true) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 })
    if (error) { console.error("✗ listUsers:", error.message); return null }
    const u = data?.users?.find(x => x.email === KEEP_EMAIL)
    if (u) return u.id
    if (!data?.users || data.users.length < 200) return null
    page++
  }
}

async function listAuthUsersCount(keepId: string): Promise<number> {
  let total = 0
  let page = 1
  while (true) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 })
    if (error) return total
    if (!data?.users || data.users.length === 0) break
    total += data.users.filter(u => u.id !== keepId).length
    if (data.users.length < 200) break
    page++
  }
  return total
}

async function countWhereNotIn(table: string, col: string, keepIds: string[]): Promise<number> {
  // Postgrest does not support NOT IN with an empty list cleanly. Use total - in(keep).
  const { count: total } = await sb.from(table).select("*", { count: "exact", head: true })
  if (keepIds.length === 0) return total ?? 0
  // batch — avoid query length limit
  let kept = 0
  for (let i = 0; i < keepIds.length; i += 100) {
    const batch = keepIds.slice(i, i + 100)
    const { count } = await sb.from(table).select("*", { count: "exact", head: true }).in(col, batch)
    kept += count ?? 0
  }
  return Math.max(0, (total ?? 0) - kept)
}

type CountResult = { label: string; value: number }
async function countNotIn(label: string, fn: () => Promise<number>): Promise<CountResult> {
  try { return { label, value: await fn() } }
  catch { return { label: `${label} (err)`, value: -1 } }
}

async function deleteWhereNotIn(table: string, col: string, keepIds: string[]): Promise<void> {
  // Strategy: iterate target rows in batches, filter to non-keep ids, delete by id.
  // Efficient enough for ≤ 100K rows; we don't have that scale yet.
  const KEEP = new Set(keepIds)
  let deleted = 0
  let from = 0
  const PAGE = 1000
  while (true) {
    // 'id, <col>' — id 가 없는 테이블 (e.g. cron_heartbeats) 은 별도 path 로 처리.
    const { data, error } = await sb
      .from(table)
      .select(`id, ${col}`)
      .range(from, from + PAGE - 1)
    if (error) {
      console.warn(`  ⚠ ${table}: 'id' 컬럼 없거나 select 실패 (${error.message}) — 스킵`)
      return
    }
    if (!data || data.length === 0) break
    const rows = data as unknown as Array<Record<string, unknown>>
    const idsToDelete = rows
      .filter((r) => {
        const v = r[col]
        return typeof v === "string" ? !KEEP.has(v) : true
      })
      .map((r) => r.id as string)
      .filter(Boolean)

    if (idsToDelete.length > 0) {
      for (let i = 0; i < idsToDelete.length; i += 100) {
        const batch = idsToDelete.slice(i, i + 100)
        const { error, count } = await sb.from(table).delete({ count: "exact" }).in("id", batch)
        if (error) console.warn(`  ✗ ${table} delete batch: ${error.message}`)
        else deleted += count ?? 0
      }
    }
    if (data.length < PAGE) break
    from += PAGE
  }
  console.log(`  ${table.padEnd(35)} -${deleted}`)
}

async function deleteWhereInBatch(table: string, col: string, ids: string[]): Promise<void> {
  if (ids.length === 0) { console.log(`  ${table.padEnd(35)} skip`); return }
  let deleted = 0
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100)
    const { error, count } = await sb.from(table).delete({ count: "exact" }).in(col, batch)
    if (error) console.warn(`  ✗ ${table} batch ${i}: ${error.message}`)
    else deleted += count ?? 0
  }
  console.log(`  ${table.padEnd(35)} -${deleted}`)
}

async function selectIdsNotIn(
  table: string,
  selectCol: string,
  filterCol: string,
  keepIds: string[],
): Promise<string[]> {
  const KEEP = new Set(keepIds)
  const out: string[] = []
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await sb.from(table).select(`${selectCol}, ${filterCol}`).range(from, from + PAGE - 1)
    if (error || !data || data.length === 0) break
    for (const row of (data as unknown as Array<Record<string, unknown>>)) {
      const f = row[filterCol]
      const s = row[selectCol]
      if (typeof s === "string" && (typeof f !== "string" || !KEEP.has(f))) out.push(s)
    }
    if (data.length < PAGE) break
    from += PAGE
  }
  return out
}

async function deleteAuthUsersExcept(keepId: string): Promise<void> {
  let deleted = 0, failed = 0
  let page = 1
  while (true) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 })
    if (error) break
    if (!data?.users || data.users.length === 0) break
    for (const u of data.users) {
      if (u.id === keepId) continue
      const { error: dErr } = await sb.auth.admin.deleteUser(u.id)
      if (dErr) { console.warn(`  ✗ auth ${u.email}: ${dErr.message}`); failed++ }
      else deleted++
    }
    if (data.users.length < 200) break
    // page 1 다시 — listUsers 가 변동 페이지 처리 안전성 위해 page 유지
    page++
  }
  console.log(`  auth.users (excl. keep)               -${deleted}${failed ? ` (실패 ${failed})` : ""}`)
}

main().catch(e => { console.error("✗ 예외:", e); process.exit(1) })
