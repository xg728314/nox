/** 현재 pending pool + Marvel active session 상태 진단 */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const MARVEL = "ad1b95f0-5023-4c93-9282-efbb3d94ce76"

// 오늘 KST ops date
const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
if (kst.getUTCHours() < 6) kst.setUTCDate(kst.getUTCDate() - 1)
const businessDate = kst.toISOString().slice(0,10)
console.log(`biz date: ${businessDate}`)

const { data: bds } = await sb.from("store_operating_days")
  .select("id, business_date, status").eq("store_uuid", MARVEL)
  .order("business_date", { ascending: false }).limit(3)
console.log("recent biz_days:", bds)

// 오늘 · approved · to Marvel
const todayBd = bds?.find(b => b.business_date === businessDate)
if (todayBd) {
  const { data: trs } = await sb.from("transfer_requests")
    .select("id, hostess_membership_id, reason, from_store_uuid")
    .eq("to_store_uuid", MARVEL).eq("status", "approved").eq("business_day_id", todayBd.id)
  const trIds = trs.map(t => t.id)
  const { data: used } = await sb.from("session_participants")
    .select("transfer_request_id, id, status").in("transfer_request_id", trIds)
  const usedSet = new Set((used ?? []).filter(u => !u.deleted_at).map(r => r.transfer_request_id))
  console.log(`\ntransfer_requests (오늘, to Marvel, approved): ${trs.length}건`)
  const mids = Array.from(new Set(trs.map(t => t.hostess_membership_id)))
  const { data: hnames } = await sb.from("hostesses").select("membership_id, name").in("membership_id", mids)
  const nameByMid = new Map((hnames ?? []).map(h => [h.membership_id, h.name]))
  for (const t of trs) {
    const isPending = !usedSet.has(t.id)
    console.log(`  ${isPending ? "🚪 PENDING" : "✓ ASSIGNED"} · ${nameByMid.get(t.hostess_membership_id) ?? "?"} · tr=${t.id.slice(0,8)}`)
  }
}

// active sessions in Marvel
const { data: sess } = await sb.from("room_sessions")
  .select("id, room_uuid, status, started_at, manager_name, is_external_manager")
  .eq("store_uuid", MARVEL).eq("status", "active")
const { data: rooms } = await sb.from("rooms").select("id, room_no").eq("store_uuid", MARVEL)
const roomNoByUuid = new Map(rooms.map(r => [r.id, r.room_no]))
console.log(`\nMarvel active sessions: ${sess.length}건`)
for (const s of sess) {
  const { count } = await sb.from("session_participants")
    .select("id", { count: "exact", head: true }).eq("session_id", s.id).eq("status", "active").is("deleted_at", null)
  const hoursAgo = ((Date.now() - new Date(s.started_at).getTime()) / 3600_000).toFixed(1)
  console.log(`  · ${roomNoByUuid.get(s.room_uuid) ?? "?"}번 · 참여자 ${count} · ${hoursAgo}시간 전 · ${s.manager_name ?? "실장 미지정"}${s.is_external_manager ? " (external)" : ""}`)
}
