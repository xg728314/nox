/** 세션이 이미 closed 인데 chat_room 은 is_active=true 인 잔재 정리 */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: rows } = await sb.from("chat_rooms")
  .select("id, session_id, name")
  .eq("type", "room_session").eq("is_active", true).not("session_id", "is", null)

console.log(`활성 room_session chat_rooms: ${rows.length}건`)

const sids = [...new Set(rows.map(r => r.session_id))]
const { data: sess } = await sb.from("room_sessions")
  .select("id, status").in("id", sids)
const activeIds = new Set(sess.filter(s => s.status === "active").map(s => s.id))

const orphans = rows.filter(r => !activeIds.has(r.session_id))
console.log(`orphan (세션 종료됐는데 채팅방 살아있음): ${orphans.length}건`)

for (const o of orphans) {
  await sb.from("chat_rooms").update({
    is_active: false,
    updated_at: new Date().toISOString(),
  }).eq("id", o.id)
  console.log(`  ✓ archive ${o.id.slice(0,8)} · ${o.name}`)
}

console.log(`\n✓ ${orphans.length}건 archive 완료`)
