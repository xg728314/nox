/** 지금 있는 Marvel active 세션들 room_session chat_room 백필. */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const MARVEL = "ad1b95f0-5023-4c93-9282-efbb3d94ce76"
const JOJUN_OWNER_MID = "db74c206-fd8f-4a43-8e88-49ec43a60a32"

// syncRoomSessionChat 로직 재현 (script 편의)
async function syncOne(sessionId) {
  const { data: session } = await sb.from("room_sessions")
    .select("id, room_uuid, manager_membership_id, status, store_uuid").eq("id", sessionId).maybeSingle()
  if (!session || session.status !== "active") return { skip: "not active" }

  const { data: room } = await sb.from("rooms")
    .select("room_name, room_no").eq("id", session.room_uuid).is("deleted_at", null).maybeSingle()
  const roomName = room?.room_name || (room?.room_no ? `${room.room_no}번방` : "룸")

  const { data: existing } = await sb.from("chat_rooms")
    .select("id").eq("store_uuid", session.store_uuid).eq("type", "room_session").eq("session_id", sessionId).eq("is_active", true).maybeSingle()
  let chatRoomId
  if (existing) chatRoomId = existing.id
  else {
    const { data: created, error } = await sb.from("chat_rooms").insert({
      store_uuid: session.store_uuid, type: "room_session", session_id: sessionId,
      room_uuid: session.room_uuid, name: `${roomName} 채팅`, created_by: JOJUN_OWNER_MID,
    }).select("id").single()
    if (error) return { error: error.message }
    chatRoomId = created.id
  }

  const { data: parts } = await sb.from("session_participants")
    .select("membership_id").eq("session_id", sessionId).eq("status", "active").is("deleted_at", null)
  const memSet = new Set()
  for (const p of (parts ?? [])) memSet.add(p.membership_id)
  if (session.manager_membership_id) memSet.add(session.manager_membership_id)
  memSet.add(JOJUN_OWNER_MID) // owner 도 참여 (앱에서 채팅 볼 수 있게)

  if (memSet.size === 0) return { chat_room_id: chatRoomId, synced_count: 0 }

  const rows = [...memSet].map(mid => ({ chat_room_id: chatRoomId, membership_id: mid, store_uuid: session.store_uuid }))
  const { error: upErr } = await sb.from("chat_participants").upsert(rows, { onConflict: "chat_room_id,membership_id" })
  if (upErr) return { chat_room_id: chatRoomId, error: upErr.message }

  // 기존 chat_room 이름이 "룸 채팅" 이면 정정
  if (existing) {
    await sb.from("chat_rooms").update({ name: `${roomName} 채팅` }).eq("id", chatRoomId)
  }
  return { chat_room_id: chatRoomId, synced_count: rows.length, room_name: roomName }
}

const { data: sess } = await sb.from("room_sessions")
  .select("id, room_uuid").eq("store_uuid", MARVEL).eq("status", "active")
const { data: rooms } = await sb.from("rooms").select("id, room_no").eq("store_uuid", MARVEL)
const roomNoBy = new Map(rooms.map(r => [r.id, r.room_no]))

console.log(`backfill ${sess.length}개 active session\n`)
for (const s of sess) {
  const r = await syncOne(s.id)
  console.log(`${roomNoBy.get(s.room_uuid)}번방 (${s.id.slice(0,8)}) → ${JSON.stringify(r)}`)
}
