/**
 * [시뮬] prefix 매장 완전 삭제 — FK 의존성 고려한 순서.
 *
 *   1. audit_events (session 참조)
 *   2. transfer_requests (membership / business_day 참조)
 *   3. cross_store_work_records
 *   4. pre_settlements / settlements / receipts_snapshots / receipts
 *   5. session_participants
 *   6. room_sessions
 *   7. store_operating_days
 *   8. rooms
 *   9. store_service_types
 *   10. hostesses, managers
 *   11. chat_messages, chat_participants, chat_rooms
 *   12. store_memberships
 *   13. stores
 *
 * 부가:
 *   - @nox-sim.local 도메인 auth users + profiles 삭제
 *
 * 실행:
 *   SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=...   \
 *     npx tsx scripts/purge-sim-stores.ts
 */
import { createClient } from "@supabase/supabase-js"

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
if (!URL || !KEY) { console.error("env"); process.exit(1) }
const sb = createClient(URL, KEY, { auth: { persistSession: false } })
const log = (...a: unknown[]) => console.log("[purge-sim]", ...a)

async function deleteIn(table: string, col: string, ids: string[]) {
  if (ids.length === 0) return 0
  let total = 0
  // 배치 200개씩 (PostgREST URL 길이 제한 대응)
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const { error, count } = await sb.from(table).delete({ count: "exact" }).in(col, chunk)
    if (error) {
      log(`  [${table}.${col}] 삭제 실패:`, error.message)
      return total
    }
    total += count ?? 0
  }
  return total
}

async function main() {
  // 1. 시뮬 매장 store_uuid 수집
  const { data: stores } = await sb.from("stores").select("id").like("store_name", "[시뮬]%")
  const storeIds = (stores ?? []).map((s) => s.id)
  log(`시뮬 매장 ${storeIds.length}개`)
  if (storeIds.length === 0) { log("아무 것도 삭제 안 함"); return }

  // 2. room_sessions / business_days / participants ID 모음 (audit_events 삭제 용)
  const { data: sessions } = await sb.from("room_sessions").select("id").in("store_uuid", storeIds)
  const sessionIds = (sessions ?? []).map((s) => s.id)
  log(`  room_sessions ${sessionIds.length}건`)

  const { data: parts } = await sb.from("session_participants").select("id").in("store_uuid", storeIds)
  const partIds = (parts ?? []).map((p) => p.id)
  log(`  session_participants ${partIds.length}건`)

  const { data: receipts } = await sb.from("receipts").select("id").in("store_uuid", storeIds)
  const receiptIds = (receipts ?? []).map((r) => r.id)
  log(`  receipts ${receiptIds.length}건`)

  // 3. audit_events — session 또는 participant 참조
  log(`삭제: audit_events ...`)
  if (sessionIds.length > 0) {
    const d1 = await deleteIn("audit_events", "session_id", sessionIds)
    log(`  audit_events session ${d1}`)
  }
  // 추가로 store_uuid 직접 매칭
  const a2 = await deleteIn("audit_events", "store_uuid", storeIds)
  log(`  audit_events store ${a2}`)

  // 4. transfer_requests — from/to store
  const t1 = await deleteIn("transfer_requests", "from_store_uuid", storeIds)
  const t2 = await deleteIn("transfer_requests", "to_store_uuid", storeIds)
  log(`  transfer_requests ${t1 + t2}`)

  // 5. cross_store_work_records — origin/working store
  const c1 = await deleteIn("cross_store_work_records", "origin_store_uuid", storeIds)
  const c2 = await deleteIn("cross_store_work_records", "working_store_uuid", storeIds)
  log(`  cross_store_work_records ${c1 + c2}`)

  // 6. receipt_snapshots (있으면)
  try { await deleteIn("receipt_snapshots", "receipt_id", receiptIds) } catch { /* ok */ }
  try { await deleteIn("receipt_snapshots", "store_uuid", storeIds) } catch { /* ok */ }

  // 7. pre_settlements
  try { await deleteIn("pre_settlements", "store_uuid", storeIds) } catch { /* ok */ }

  // 8. receipts
  const r2 = await deleteIn("receipts", "store_uuid", storeIds)
  log(`  receipts ${r2}`)

  // 9. session_participants
  const p2 = await deleteIn("session_participants", "store_uuid", storeIds)
  log(`  session_participants ${p2}`)

  // 10. participant_time_segments (있으면)
  try { await deleteIn("participant_time_segments", "session_id", sessionIds) } catch { /* ok */ }

  // 11. room_sessions
  const rs = await deleteIn("room_sessions", "store_uuid", storeIds)
  log(`  room_sessions ${rs}`)

  // 12. store_operating_days
  const sod = await deleteIn("store_operating_days", "store_uuid", storeIds)
  log(`  store_operating_days ${sod}`)

  // 13. rooms
  const rm = await deleteIn("rooms", "store_uuid", storeIds)
  log(`  rooms ${rm}`)

  // 14. store_service_types
  const st = await deleteIn("store_service_types", "store_uuid", storeIds)
  log(`  store_service_types ${st}`)

  // 15. hostesses, managers
  const h = await deleteIn("hostesses", "store_uuid", storeIds)
  const m = await deleteIn("managers", "store_uuid", storeIds)
  log(`  hostesses ${h}, managers ${m}`)

  // 16. chat
  const cm = await deleteIn("chat_messages", "store_uuid", storeIds)
  const cp = await deleteIn("chat_participants", "store_uuid", storeIds)
  const cr = await deleteIn("chat_rooms", "store_uuid", storeIds)
  log(`  chat msg/part/room ${cm}/${cp}/${cr}`)

  // 17. store_memberships
  const sm = await deleteIn("store_memberships", "store_uuid", storeIds)
  log(`  store_memberships ${sm}`)

  // 18. stores 본체
  const { error: sdErr, count: sdCount } = await sb.from("stores").delete({ count: "exact" }).in("id", storeIds)
  if (sdErr) log(`  stores 삭제 실패: ${sdErr.message}`)
  else log(`  stores ${sdCount ?? 0}`)

  // 19. @nox-sim.local 사용자 정리
  const usersToDelete: string[] = []
  let page = 1
  while (true) {
    const { data } = await sb.auth.admin.listUsers({ page, perPage: 1000 })
    if (!data?.users?.length) break
    for (const u of data.users) {
      const em = u.email ?? ""
      if (em.endsWith("@nox-sim.local")) usersToDelete.push(u.id)
    }
    if (data.users.length < 1000) break
    page++
  }
  log(`sim user 삭제 ${usersToDelete.length}개`)
  for (const uid of usersToDelete) {
    try {
      await sb.from("profiles").delete().eq("id", uid)
      await sb.auth.admin.deleteUser(uid)
    } catch {
      /* best-effort */
    }
  }

  log("=== 완료 ===")
}

main().catch((e) => { console.error(e); process.exit(1) })
