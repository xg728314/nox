import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const MARVEL = "ad1b95f0-5023-4c93-9282-efbb3d94ce76"
const JOJUN_OWNER_MID = "db74c206-fd8f-4a43-8e88-49ec43a60a32"

const { data: rooms } = await sb.from("rooms").select("id, room_no").eq("store_uuid", MARVEL)
const room6 = rooms.find(r => r.room_no === "6")
const { data: sess } = await sb.from("room_sessions")
  .select("id, manager_name").eq("store_uuid", MARVEL).eq("room_uuid", room6.id).eq("status", "active").maybeSingle()
if (!sess) { console.log("6번방 active session 없음"); process.exit(0) }
console.log(`6번방 session ${sess.id} · 현재 실장: ${sess.manager_name ?? "미지정"}`)
const { error } = await sb.from("room_sessions")
  .update({ manager_membership_id: JOJUN_OWNER_MID, manager_name: "조준성", is_external_manager: false })
  .eq("id", sess.id)
console.log(error ? `FAIL: ${error.message}` : `✓ 조준성 실장 세팅`)
