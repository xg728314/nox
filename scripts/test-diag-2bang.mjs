/** 2번방 참여자 세부 진단 · membership_id 별 dedup */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const MARVEL = "ad1b95f0-5023-4c93-9282-efbb3d94ce76"

const { data: rooms } = await sb.from("rooms").select("id, room_no").eq("store_uuid", MARVEL)
const room2 = rooms.find(r => r.room_no === "2")

const { data: sess } = await sb.from("room_sessions")
  .select("id").eq("store_uuid", MARVEL).eq("room_uuid", room2.id).eq("status", "active").maybeSingle()

console.log(`2번방 session: ${sess?.id}`)

const { data: parts, error: pErr } = await sb.from("session_participants")
  .select("id, membership_id, category, time_minutes, status, entered_at")
  .eq("session_id", sess.id).is("deleted_at", null).order("entered_at")
if (pErr) { console.log(`participants query error: ${pErr.message}`); process.exit(1) }
if (!parts || parts.length === 0) { console.log("참여자 없음"); process.exit(0) }
console.log(`\n참여자 ${parts.length}건:\n`)
const bucket = new Map()
for (const p of parts) {
  if (!bucket.has(p.membership_id)) bucket.set(p.membership_id, [])
  bucket.get(p.membership_id).push(p)
}

// hostess names
const { data: names } = await sb.from("hostesses")
  .select("membership_id, name").in("membership_id", [...bucket.keys()])
const nameByMid = new Map(names.map(h => [h.membership_id, h.name]))

for (const [mid, ps] of bucket) {
  console.log(`── ${nameByMid.get(mid) ?? "?"} (mid=${mid.slice(0,8)}) · ${ps.length}건 ──`)
  for (const p of ps) {
    console.log(`   participant ${p.id.slice(0,8)} · ${p.category}/${p.time_minutes}분 · ${p.status} · ${p.entered_at?.slice(11,19)}`)
  }
}

// 이름 별 그룹 (다른 mid 인데 이름 같은 경우)
console.log(`\n── 이름 별 그룹 (혹시 서로 다른 아가씨) ──`)
const byName = new Map()
for (const [mid, ps] of bucket) {
  const name = nameByMid.get(mid)
  if (!byName.has(name)) byName.set(name, [])
  byName.get(name).push({ mid, count: ps.length })
}
for (const [name, entries] of byName) {
  if (entries.length === 1) console.log(`  ${name}: 1명 · ${entries[0].count}개 라운드`)
  else console.log(`  ⚠ ${name}: ${entries.length}명 동명이인!` + entries.map(e => ` (${e.mid.slice(0,6)}·${e.count}회)`).join(""))
}
