/** Marvel 의 실장 미지정 active session 모두 → 조준성 owner 로 backfill. */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const MARVEL = "ad1b95f0-5023-4c93-9282-efbb3d94ce76"
const JOJUN_OWNER_MID = "db74c206-fd8f-4a43-8e88-49ec43a60a32"

const { data: rooms } = await sb.from("rooms").select("id, room_no").eq("store_uuid", MARVEL)
const nameByRoom = new Map(rooms.map(r => [r.id, r.room_no]))
const { data: sess } = await sb.from("room_sessions")
  .select("id, room_uuid, manager_membership_id, manager_name")
  .eq("store_uuid", MARVEL).eq("status", "active").is("manager_membership_id", null)

for (const s of sess) {
  const { error } = await sb.from("room_sessions")
    .update({ manager_membership_id: JOJUN_OWNER_MID, manager_name: "조준성", is_external_manager: false })
    .eq("id", s.id)
  console.log(error ? `FAIL ${nameByRoom.get(s.room_uuid)}: ${error.message}` : `✓ ${nameByRoom.get(s.room_uuid)}번 → 조준성`)
}
console.log(`\n${sess.length}건 처리`)
