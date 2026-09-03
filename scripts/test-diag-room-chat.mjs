/** 활성 세션 vs room_session 채팅방 mapping 진단 */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const MARVEL = "ad1b95f0-5023-4c93-9282-efbb3d94ce76"
const JOJUN_OWNER_MID = "db74c206-fd8f-4a43-8e88-49ec43a60a32"

const { data: sess } = await sb.from("room_sessions")
  .select("id, room_uuid, started_at, manager_name").eq("store_uuid", MARVEL).eq("status", "active")
const { data: rooms } = await sb.from("rooms").select("id, room_no").eq("store_uuid", MARVEL)
const roomNoBy = new Map(rooms.map(r => [r.id, r.room_no]))

console.log(`Marvel active sessions: ${sess.length}`)
for (const s of sess) {
  const { count: pc } = await sb.from("session_participants").select("id", { count: "exact", head: true })
    .eq("session_id", s.id).eq("status", "active").is("deleted_at", null)
  const { data: chat } = await sb.from("chat_rooms").select("id, name, type, session_id, is_active")
    .eq("session_id", s.id).eq("type", "room_session").maybeSingle()
  console.log(`\n${roomNoBy.get(s.room_uuid)}번방 · 참여자 ${pc} · ${s.manager_name}`)
  console.log(`  session_id: ${s.id}`)
  if (chat) {
    const { count: partCnt } = await sb.from("chat_participants").select("id", { count: "exact", head: true })
      .eq("chat_room_id", chat.id).is("removed_at", null)
    console.log(`  ✓ chat_room ${chat.id.slice(0,8)} · "${chat.name}" · active=${chat.is_active} · 참여자 ${partCnt}`)
    // 조준성 (owner) 이 참여자로 들어가있는지 확인
    const { data: ownerP } = await sb.from("chat_participants")
      .select("id").eq("chat_room_id", chat.id).eq("membership_id", JOJUN_OWNER_MID).is("removed_at", null).limit(1)
    console.log(`  → 조준성 참여자? ${(ownerP ?? []).length > 0 ? "예" : "❌ 아님"}`)
  } else {
    console.log(`  ❌ chat_room 없음 (session_id 매핑된 room_session 없음)`)
  }
}

// chat/page.tsx 가 조준성에게 보여주는 채팅방 목록 · 조준성 chat_participants
console.log(`\n=== 조준성 (owner) 참여 중 chat_rooms ===`)
const { data: cps } = await sb.from("chat_participants")
  .select("chat_room_id").eq("membership_id", JOJUN_OWNER_MID).is("removed_at", null)
const cpRoomIds = (cps ?? []).map(c => c.chat_room_id)
const { data: crs } = await sb.from("chat_rooms").select("id, name, type, session_id, is_active").in("id", cpRoomIds)
for (const c of (crs ?? [])) {
  console.log(`  · ${c.type} · "${c.name}" · session=${c.session_id?.slice(0,8) ?? "-"} · active=${c.is_active}`)
}
