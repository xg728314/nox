/** 5번방 세션 · 참여자 · 최근 transfer_requests 진단 */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const MARVEL = "ad1b95f0-5023-4c93-9282-efbb3d94ce76"

const { data: room5 } = await sb.from("rooms").select("id, room_no").eq("store_uuid", MARVEL).eq("room_no", "5").limit(1)
const room5Id = room5[0].id

const { data: sess5 } = await sb.from("room_sessions")
  .select("id, status, started_at, manager_name")
  .eq("store_uuid", MARVEL).eq("room_uuid", room5Id).eq("status", "active").maybeSingle()

console.log(`=== 5번방 active session ===`)
if (!sess5) { console.log("없음"); process.exit(0) }
console.log(`id: ${sess5.id}`)
console.log(`started_at: ${sess5.started_at}`)
console.log(`manager: ${sess5.manager_name}`)

const { data: parts } = await sb.from("session_participants")
  .select("id, membership_id, external_name, memo, category, time_minutes, status, entered_at, origin_store_uuid, transfer_request_id, price_amount")
  .eq("session_id", sess5.id).is("deleted_at", null).order("entered_at")

console.log(`\n=== 참여자 ${parts.length}건 ===`)
for (const p of parts) {
  let hostessName = p.external_name ?? p.memo ?? "?"
  if (p.membership_id) {
    const { data: h } = await sb.from("hostesses").select("name").eq("membership_id", p.membership_id).maybeSingle()
    if (h?.name) hostessName = h.name
  }
  const originName = p.origin_store_uuid ? (await sb.from("stores").select("store_name").eq("id", p.origin_store_uuid).maybeSingle()).data?.store_name : "본 매장"
  console.log(`  · ${hostessName} · ${p.category ?? "?"}/${p.time_minutes}분 · ${p.status} · ${p.entered_at?.slice(11,16) ?? "?"} · origin ${originName} · tr ${p.transfer_request_id?.slice(0,8) ?? "-"} · ₩${p.price_amount}`)
  console.log(`    membership_id: ${p.membership_id ?? "null"}, external_name: ${p.external_name ?? "null"}, memo: ${p.memo ?? "null"}`)
}

console.log(`\n=== 최근 transfer_requests (to Marvel, 최근 1시간) ===`)
const oneHrAgo = new Date(Date.now() - 60 * 60_000).toISOString()
const { data: trs } = await sb.from("transfer_requests")
  .select("id, hostess_membership_id, from_store_uuid, reason, status, created_at")
  .eq("to_store_uuid", MARVEL).gte("created_at", oneHrAgo).order("created_at", { ascending: false })
for (const t of (trs ?? [])) {
  const { data: h } = t.hostess_membership_id ? await sb.from("hostesses").select("name").eq("membership_id", t.hostess_membership_id).maybeSingle() : { data: null }
  const originName = (await sb.from("stores").select("store_name").eq("id", t.from_store_uuid).maybeSingle()).data?.store_name
  console.log(`  · tr ${t.id.slice(0,8)} · ${h?.name ?? "?"} · ${originName} · ${t.status} · ${t.created_at?.slice(11,19)} · reason=${t.reason?.slice(0,50)}...`)
  // used?
  const { data: usedP } = await sb.from("session_participants").select("id, session_id").eq("transfer_request_id", t.id).limit(1).maybeSingle()
  console.log(`    → participant: ${usedP ? `${usedP.id.slice(0,8)} (session ${usedP.session_id.slice(0,8)})` : "미배정 (pending)"}`)
}

console.log(`\n=== 최근 채팅 메시지 (parsed_at 확인) ===`)
const { data: recentMsgs } = await sb.from("chat_messages")
  .select("id, content, created_at, chat_room_id")
  .gte("created_at", oneHrAgo).order("created_at", { ascending: false }).limit(5)
for (const m of (recentMsgs ?? [])) {
  console.log(`  · ${m.created_at?.slice(11,19)} · "${m.content?.slice(0,60)}..."`)
}
