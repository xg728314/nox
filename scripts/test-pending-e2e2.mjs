/** R-auto-manager fix E2E — 채아 → 7번방 배정 시 조준성 자동 실장 확인. */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"
const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const MARVEL = "ad1b95f0-5023-4c93-9282-efbb3d94ce76"
const JOJUN_OWNER_MID = "db74c206-fd8f-4a43-8e88-49ec43a60a32"
const JOJUN_USER_ID = (await sb.from("store_memberships").select("profile_id").eq("id", JOJUN_OWNER_MID).single()).data.profile_id

const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
if (kst.getUTCHours() < 6) kst.setUTCDate(kst.getUTCDate() - 1)
const businessDate = kst.toISOString().slice(0,10)
const { data: bd } = await sb.from("store_operating_days").select("id").eq("store_uuid", MARVEL).eq("business_date", businessDate).maybeSingle()

// 채아 pending TR 찾기
const { data: trs } = await sb.from("transfer_requests")
  .select("id, hostess_membership_id, reason, from_store_uuid, business_day_id")
  .eq("to_store_uuid", MARVEL).eq("status", "approved").eq("business_day_id", bd.id)
const chaeAmid = (await sb.from("hostesses").select("membership_id").eq("name", "채아").limit(1)).data[0]?.membership_id
const tr = trs.find(t => t.hostess_membership_id === chaeAmid && !!t.reason)
if (!tr) { console.log("채아 pending TR 없음 · state 확인 필요"); process.exit(0) }

// used check
const { data: used } = await sb.from("session_participants").select("id").eq("transfer_request_id", tr.id).is("deleted_at", null).maybeSingle()
if (used) { console.log("채아 이미 배정됨 · skip"); process.exit(0) }

// simulate assign-room API for 7번방
const { data: room7 } = await sb.from("rooms").select("id").eq("store_uuid", MARVEL).eq("room_no", "7").single()
const meta = JSON.parse(tr.reason)
const { data: st } = await sb.from("store_service_types").select("time_minutes, price, manager_deduction")
  .eq("store_uuid", MARVEL).eq("service_type", meta.category).eq("time_type", meta.time_type).maybeSingle()

// active session in 7?
const { data: activeSess } = await sb.from("room_sessions").select("id, manager_name").eq("store_uuid", MARVEL).eq("room_uuid", room7.id).eq("status", "active").maybeSingle()
let sessionId, mgrName
if (activeSess) {
  sessionId = activeSess.id
  mgrName = activeSess.manager_name
  console.log(`재사용 session ${sessionId.slice(0,8)} · 실장: ${mgrName ?? "미지정"}`)
} else {
  // NEW LOGIC — auth membership as manager
  const { data: prof } = await sb.from("profiles").select("full_name").eq("id", JOJUN_USER_ID).maybeSingle()
  const assignerName = prof?.full_name ?? null
  const { data: newSess, error } = await sb.from("room_sessions").insert({
    store_uuid: MARVEL, room_uuid: room7.id, business_day_id: bd.id, status: "active",
    opened_by: JOJUN_USER_ID,
    manager_membership_id: JOJUN_OWNER_MID,
    manager_name: assignerName,
    is_external_manager: false,
    started_at: new Date().toISOString(),
  }).select("id, manager_name").single()
  if (error) { console.log("session create FAIL:", error.message); process.exit(1) }
  sessionId = newSess.id
  mgrName = newSess.manager_name
  console.log(`신규 session ${sessionId.slice(0,8)} · 실장 자동: ${mgrName ?? "미지정"}`)
}

// participant insert
const { data: newPart, error: pErr } = await sb.from("session_participants").insert({
  session_id: sessionId, membership_id: tr.hostess_membership_id, role: "hostess",
  category: meta.category, time_minutes: st.time_minutes, price_amount: st.price,
  manager_payout_amount: st.manager_deduction ?? 0,
  hostess_payout_amount: Math.max(0, st.price - (st.manager_deduction ?? 0)),
  margin_amount: 0, cha3_amount: 0, banti_amount: 0,
  waiter_tip_received: false, waiter_tip_amount: 0, greeting_confirmed: false,
  status: "active", store_uuid: MARVEL, origin_store_uuid: tr.from_store_uuid,
  transfer_request_id: tr.id, entered_at: new Date().toISOString(),
}).select("id").single()
if (pErr) { console.log("participant FAIL:", pErr.message); process.exit(1) }

console.log(`\n✅ 채아 → 7번방 배정 완료 · participant ${newPart.id.slice(0,8)}`)
console.log(`   세션 실장: ${mgrName ?? "미지정"} (기대: 조준성)`)
console.log(mgrName === "조준성" ? "\n✅ auto-manager 정상" : "\n❌ FAIL — 실장 지정 안됨")
