/** Marvel 의 stale (175시간+, 참여자 0명) active session 정리. */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const MARVEL = "ad1b95f0-5023-4c93-9282-efbb3d94ce76"

const { data: sess } = await sb.from("room_sessions")
  .select("id, room_uuid, started_at").eq("store_uuid", MARVEL).eq("status", "active")

const { data: rooms } = await sb.from("rooms").select("id, room_no").eq("store_uuid", MARVEL)
const roomNoByUuid = new Map(rooms.map(r => [r.id, r.room_no]))

let closed = 0, skipped = 0
for (const s of sess) {
  const { count } = await sb.from("session_participants")
    .select("id", { count: "exact", head: true }).eq("session_id", s.id).eq("status", "active").is("deleted_at", null)
  const hoursAgo = (Date.now() - new Date(s.started_at).getTime()) / 3600_000
  if ((count ?? 0) === 0 && hoursAgo > 24) {
    // stale — close
    await sb.from("room_sessions").update({ status: "closed", ended_at: new Date().toISOString() }).eq("id", s.id)
    console.log(`✓ closed ${roomNoByUuid.get(s.room_uuid)}번 · ${hoursAgo.toFixed(0)}h 전 (참여자 0)`)
    closed++
  } else {
    console.log(`- keep ${roomNoByUuid.get(s.room_uuid)}번 · 참여자 ${count} · ${hoursAgo.toFixed(1)}h`)
    skipped++
  }
}
console.log(`\nclosed=${closed} skipped=${skipped}`)
