/**
 * R30 테스트 데이터 완전 리셋 — Marvel 매장 초기화.
 *   1) 오늘 영업일 참여자 · 세션 · transfer_requests 삭제
 *   2) 3일치 stale 세션도 정리
 *   3) 검증 로그 출력
 */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"

const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const MARVEL = "ad1b95f0-5023-4c93-9282-efbb3d94ce76"

console.log("═══ 1. Marvel active sessions 조회 ═══")
const { data: activeSess } = await sb.from("room_sessions")
  .select("id, room_uuid, started_at")
  .eq("store_uuid", MARVEL).eq("status", "active")
console.log(`active session ${activeSess.length}건`)

console.log("\n═══ 2. 세션별 참여자 삭제 (hard delete) ═══")
let partDeleted = 0
for (const s of activeSess) {
  const { data: parts } = await sb.from("session_participants")
    .select("id, transfer_request_id").eq("session_id", s.id)
  for (const p of (parts ?? [])) {
    await sb.from("session_participants").delete().eq("id", p.id)
    partDeleted++
  }
}
console.log(`✓ ${partDeleted}건 참여자 삭제`)

console.log("\n═══ 3. active session 모두 종료 (status=closed) ═══")
const nowIso = new Date().toISOString()
for (const s of activeSess) {
  await sb.from("room_sessions").update({ status: "closed", ended_at: nowIso }).eq("id", s.id)
}
console.log(`✓ ${activeSess.length}건 세션 close`)

console.log("\n═══ 4. 오늘 approved transfer_requests 삭제 ═══")
const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
if (kst.getUTCHours() < 6) kst.setUTCDate(kst.getUTCDate() - 1)
const businessDate = kst.toISOString().slice(0,10)
const { data: bds } = await sb.from("store_operating_days")
  .select("id, business_date").eq("store_uuid", MARVEL).order("business_date", { ascending: false }).limit(3)
const bdIds = bds.map(b => b.id)
const { data: trs } = await sb.from("transfer_requests")
  .select("id").eq("to_store_uuid", MARVEL).in("business_day_id", bdIds)
for (const t of (trs ?? [])) {
  await sb.from("transfer_requests").delete().eq("id", t.id)
}
console.log(`✓ ${trs?.length ?? 0}건 transfer_request 삭제`)

console.log("\n═══ 5. 최종 상태 확인 ═══")
const { data: remaining } = await sb.from("room_sessions")
  .select("id, room_uuid").eq("store_uuid", MARVEL).eq("status", "active")
console.log(`active sessions: ${remaining.length}건 (기대: 0)`)

const { data: remainTrs } = await sb.from("transfer_requests")
  .select("id").eq("to_store_uuid", MARVEL).in("business_day_id", bdIds)
console.log(`transfer_requests: ${remainTrs.length}건 (기대: 0)`)

const { data: remainParts } = await sb.from("session_participants")
  .select("id").eq("store_uuid", MARVEL).eq("status", "active").is("deleted_at", null)
console.log(`active participants: ${remainParts.length}건 (기대: 0)`)

console.log("\n✅ 리셋 완료 · Marvel 초기 상태")
