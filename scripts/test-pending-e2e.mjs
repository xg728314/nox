/**
 * pending pool E2E — DB 레벨에서 두 API 흐름 재현.
 *
 * 1) GET /api/manager/pending-arrivals (Marvel context)
 *    → 목록 조회 (채아 + 지유 등장 확인)
 * 2) POST /api/manager/pending-arrivals/[id]/assign-room (채아 → 5번방)
 *    → session_participant 생성 확인
 * 3) 재조회 → 채아 사라짐 (assigned) · 지유만 남음
 */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"

const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k, ...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const MARVEL = "ad1b95f0-5023-4c93-9282-efbb3d94ce76"

console.log("─".repeat(60))
console.log("1) GET /api/manager/pending-arrivals — Marvel context")
console.log("─".repeat(60))

// 오늘 영업일
const now = new Date()
const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
if (kst.getUTCHours() < 6) kst.setUTCDate(kst.getUTCDate() - 1)
const businessDate = kst.toISOString().slice(0, 10)
const { data: bd } = await sb.from("store_operating_days")
  .select("id").eq("store_uuid", MARVEL).eq("business_date", businessDate).maybeSingle()
console.log(`bizDay: ${bd?.id ?? "?"} (${businessDate})`)

// approved to Marvel + not yet assigned
const { data: trs } = await sb.from("transfer_requests")
  .select("id, hostess_membership_id, from_store_uuid, reason, created_at, from_store_approved_at")
  .eq("to_store_uuid", MARVEL).eq("status", "approved").eq("business_day_id", bd.id)
  .order("created_at", { ascending: false })

const trIds = trs.map(t => t.id)
const { data: usedRows } = await sb.from("session_participants")
  .select("transfer_request_id").in("transfer_request_id", trIds).is("deleted_at", null)
const usedSet = new Set((usedRows ?? []).map(r => r.transfer_request_id).filter(Boolean))
const pending = trs.filter(t => !usedSet.has(t.id))
console.log(`pending: ${pending.length}건`)

const mids = Array.from(new Set(pending.map(p => p.hostess_membership_id)))
const { data: hnames } = await sb.from("hostesses").select("membership_id, name").in("membership_id", mids)
const nameByMid = new Map(hnames.map(h => [h.membership_id, h.name]))

for (const t of pending) {
  const meta = t.reason ? JSON.parse(t.reason) : {}
  console.log(`  · ${nameByMid.get(t.hostess_membership_id)} · ${meta.category ?? "?"}/${meta.time_type ?? "?"} · tr=${t.id.slice(0,8)}`)
}

if (pending.length === 0) { console.log("FAIL — 도착 대기 없음"); process.exit(1) }

console.log()
console.log("─".repeat(60))
console.log("2) POST /assign-room — 첫 아가씨 → 5번방")
console.log("─".repeat(60))
const target = pending[0]
const targetName = nameByMid.get(target.hostess_membership_id)

// 5번방 uuid
const { data: room5 } = await sb.from("rooms")
  .select("id, room_no").eq("store_uuid", MARVEL).eq("room_no", "5").maybeSingle()
console.log(`target room: 5번 · ${room5.id}`)

// endpoint logic 재현:
// - meta 파싱
const meta = JSON.parse(target.reason)
console.log(`meta: category=${meta.category} time_type=${meta.time_type}`)

// - service_types 조회
const { data: st } = await sb.from("store_service_types")
  .select("time_minutes, price, manager_deduction")
  .eq("store_uuid", MARVEL).eq("service_type", meta.category).eq("time_type", meta.time_type).maybeSingle()
console.log(`price: ₩${st.price} · ${st.time_minutes}분 · 실장수익 ₩${st.manager_deduction}`)

// - active session in room 5?
const { data: activeSess } = await sb.from("room_sessions")
  .select("id").eq("store_uuid", MARVEL).eq("room_uuid", room5.id).eq("status", "active").maybeSingle()

let sessionId
if (activeSess) {
  sessionId = activeSess.id
  console.log(`session: 재사용 ${sessionId.slice(0,8)}`)
} else {
  const { data: newSess, error: sErr } = await sb.from("room_sessions").insert({
    store_uuid: MARVEL, room_uuid: room5.id, business_day_id: target.business_day_id ?? bd.id,
    status: "active", opened_by: null, manager_membership_id: null, manager_name: null,
    is_external_manager: false, started_at: new Date().toISOString(),
  }).select("id").single()
  if (sErr) { console.log("FAIL session:", sErr.message); process.exit(1) }
  sessionId = newSess.id
  console.log(`session: 신규 ${sessionId.slice(0,8)}`)
}

// - participant insert
const hostessPayout = Math.max(0, st.price - (st.manager_deduction ?? 0))
const { data: newPart, error: pErr } = await sb.from("session_participants").insert({
  session_id: sessionId,
  membership_id: target.hostess_membership_id,
  role: "hostess",
  category: meta.category,
  time_minutes: st.time_minutes,
  price_amount: st.price,
  manager_payout_amount: st.manager_deduction ?? 0,
  hostess_payout_amount: hostessPayout,
  margin_amount: 0,
  cha3_amount: meta.time_type === "차3" ? st.price : 0,
  banti_amount: meta.time_type === "반티" ? st.price : 0,
  waiter_tip_received: false,
  waiter_tip_amount: 0,
  greeting_confirmed: false,
  status: "active",
  store_uuid: MARVEL,
  origin_store_uuid: target.from_store_uuid,
  transfer_request_id: target.id,
  entered_at: new Date().toISOString(),
}).select("id, entered_at").single()
if (pErr) { console.log("FAIL participant:", pErr.message); process.exit(1) }
console.log(`✓ ${targetName} → 5번방 배정 완료 · participant ${newPart.id.slice(0,8)}`)

console.log()
console.log("─".repeat(60))
console.log("3) 재조회 — 채아 사라져야 함, 지유만 남음")
console.log("─".repeat(60))
const { data: trs2 } = await sb.from("transfer_requests")
  .select("id, hostess_membership_id").eq("to_store_uuid", MARVEL).eq("status", "approved").eq("business_day_id", bd.id)
const { data: used2 } = await sb.from("session_participants")
  .select("transfer_request_id").in("transfer_request_id", trs2.map(t=>t.id)).is("deleted_at", null)
const used2Set = new Set((used2 ?? []).map(r => r.transfer_request_id).filter(Boolean))
const pending2 = trs2.filter(t => !used2Set.has(t.id))
console.log(`pending: ${pending2.length}건 (기대: 1건)`)
for (const t of pending2) {
  console.log(`  · ${nameByMid.get(t.hostess_membership_id)}`)
}

console.log()
console.log(pending2.length === pending.length - 1 ? "✅ 전체 flow 정상" : "❌ FAIL — 카운트 불일치")
console.log()
console.log(`Cleanup: node scripts/test-pending-cleanup.mjs`)
