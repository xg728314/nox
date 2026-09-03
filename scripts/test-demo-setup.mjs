/**
 * 사용자 데모 시나리오 세팅. Marvel 5F 초기 상태 → 각 기능 노출.
 *
 * 결과 (사용자 앱에서 볼 것):
 *   1번방 · 조준성 담당 · 본 매장 아가씨 1명 · 🔒 잠금 (다른 실장 수정 차단)
 *   2번방 · 조준성 담당 · 본 매장 아가씨 2명 · 🔓 잠금 없음
 *   3번방 · 조준성 담당 · 외부(상한가) 아가씨 1명 · 🔓
 *   4~8번방 · 빈방 (+ 체크인 버튼 = 즉시 체크인)
 *   상단 배지 「🚪 도착 대기 2」 · pending pool (외부 아가씨 방 배정 대기)
 */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"

const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const MARVEL = "ad1b95f0-5023-4c93-9282-efbb3d94ce76"
const JOJUN_OWNER_MID = "db74c206-fd8f-4a43-8e88-49ec43a60a32"

// 조준성 profile_id
const { data: ownerRow } = await sb.from("store_memberships").select("profile_id").eq("id", JOJUN_OWNER_MID).single()
const OWNER_USER_ID = ownerRow.profile_id

// 오늘 영업일
const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
if (kst.getUTCHours() < 6) kst.setUTCDate(kst.getUTCDate() - 1)
const businessDate = kst.toISOString().slice(0,10)
let { data: bd } = await sb.from("store_operating_days").select("id, status")
  .eq("store_uuid", MARVEL).eq("business_date", businessDate).maybeSingle()
if (!bd) {
  const { data: newBd } = await sb.from("store_operating_days")
    .insert({ store_uuid: MARVEL, business_date: businessDate, status: "open", opened_by: OWNER_USER_ID })
    .select("id").single()
  bd = { ...newBd, status: "open" }
} else if (bd.status === "closed") {
  await sb.from("store_operating_days").update({ status: "open", closed_at: null, closed_by: null }).eq("id", bd.id)
}
const BIZ_DAY = bd.id
console.log(`biz_day: ${businessDate}`)

// rooms
const { data: rooms } = await sb.from("rooms").select("id, room_no").eq("store_uuid", MARVEL)
const room = (n) => rooms.find(r => r.room_no === n).id

// service_type 퍼블릭 기본
const { data: st } = await sb.from("store_service_types")
  .select("time_minutes, price, manager_deduction")
  .eq("store_uuid", MARVEL).eq("service_type", "퍼블릭").eq("time_type", "기본").maybeSingle()

// 본 매장 아가씨 3명 (첫 3명 · active 아닌)
const { data: ownHosts } = await sb.from("store_memberships")
  .select("id").eq("store_uuid", MARVEL).eq("role", "hostess").eq("status", "approved").is("deleted_at", null).limit(30)
const ownIds = ownHosts.map(h => h.id)
const { data: activeOwn } = await sb.from("session_participants")
  .select("membership_id").in("membership_id", ownIds).eq("status", "active").is("deleted_at", null)
const activeOwnSet = new Set((activeOwn ?? []).map(p => p.membership_id))
const availableOwn = ownHosts.filter(h => !activeOwnSet.has(h.id)).slice(0, 3)
const { data: ownNames } = await sb.from("hostesses").select("membership_id, name").in("membership_id", availableOwn.map(h => h.id))
const ownNameByMid = new Map(ownNames.map(h => [h.membership_id, h.name]))

// 상한가 외부 아가씨 3명 (첫 3명 · active 아닌)
const { data: sanhStoreRow } = await sb.from("stores").select("id").eq("store_name", "상한가").eq("is_active", true).limit(1)
const SANH = sanhStoreRow[0].id
const { data: extHosts } = await sb.from("store_memberships")
  .select("id, profile_id").eq("store_uuid", SANH).eq("role", "hostess").eq("status", "approved").is("deleted_at", null).limit(30)
const extIds = extHosts.map(h => h.id)
const { data: activeExt } = await sb.from("session_participants")
  .select("membership_id").in("membership_id", extIds).eq("status", "active").is("deleted_at", null)
const activeExtSet = new Set((activeExt ?? []).map(p => p.membership_id))
const availableExt = extHosts.filter(h => !activeExtSet.has(h.id)).slice(0, 3)
const { data: extNames } = await sb.from("hostesses").select("membership_id, name").in("membership_id", availableExt.map(h => h.id))
const extNameByMid = new Map(extNames.map(h => [h.membership_id, h.name]))

const nowIso = new Date().toISOString()

console.log("\n─── 1번방 (조준성 · 본 매장 아가씨 1명 · 🔒 잠금) ───")
const { data: s1 } = await sb.from("room_sessions").insert({
  store_uuid: MARVEL, room_uuid: room("1"), business_day_id: BIZ_DAY,
  status: "active", opened_by: OWNER_USER_ID,
  manager_membership_id: JOJUN_OWNER_MID, manager_name: "조준성",
  is_external_manager: false, started_at: nowIso,
  locked_by_membership_id: JOJUN_OWNER_MID, locked_at: nowIso, // ← 잠금
}).select("id").single()
const h1 = availableOwn[0]
await sb.from("session_participants").insert({
  session_id: s1.id, membership_id: h1.id, role: "hostess",
  category: "퍼블릭", time_minutes: st.time_minutes, price_amount: st.price,
  manager_payout_amount: 0, hostess_payout_amount: st.price,
  margin_amount: 0, cha3_amount: 0, banti_amount: 0,
  waiter_tip_received: false, waiter_tip_amount: 0, greeting_confirmed: false,
  status: "active", store_uuid: MARVEL, origin_store_uuid: null, entered_at: nowIso,
})
console.log(`  ✓ ${ownNameByMid.get(h1.id)} · 🔒`)

console.log("\n─── 2번방 (조준성 · 본 매장 아가씨 2명 · 🔓) ───")
const { data: s2 } = await sb.from("room_sessions").insert({
  store_uuid: MARVEL, room_uuid: room("2"), business_day_id: BIZ_DAY,
  status: "active", opened_by: OWNER_USER_ID,
  manager_membership_id: JOJUN_OWNER_MID, manager_name: "조준성",
  is_external_manager: false, started_at: nowIso,
}).select("id").single()
for (const h of [availableOwn[1], availableOwn[2]]) {
  await sb.from("session_participants").insert({
    session_id: s2.id, membership_id: h.id, role: "hostess",
    category: "퍼블릭", time_minutes: st.time_minutes, price_amount: st.price,
    manager_payout_amount: 0, hostess_payout_amount: st.price,
    margin_amount: 0, cha3_amount: 0, banti_amount: 0,
    waiter_tip_received: false, waiter_tip_amount: 0, greeting_confirmed: false,
    status: "active", store_uuid: MARVEL, origin_store_uuid: null, entered_at: nowIso,
  })
  console.log(`  ✓ ${ownNameByMid.get(h.id)}`)
}

console.log("\n─── 3번방 (조준성 · 외부 상한가 아가씨 1명 · 🔓) ───")
// 외부 아가씨는 transfer_request + participant 필요
const meta = { category: "퍼블릭", time_type: "기본", dispatched_at: nowIso }
const { data: tr3 } = await sb.from("transfer_requests").insert({
  hostess_membership_id: availableExt[0].id,
  from_store_uuid: SANH, to_store_uuid: MARVEL, business_day_id: BIZ_DAY, status: "approved",
  from_store_approved_by: OWNER_USER_ID, from_store_approved_at: nowIso,
  to_store_approved_by: OWNER_USER_ID, to_store_approved_at: nowIso,
  reason: JSON.stringify(meta),
}).select("id").single()
const { data: s3 } = await sb.from("room_sessions").insert({
  store_uuid: MARVEL, room_uuid: room("3"), business_day_id: BIZ_DAY,
  status: "active", opened_by: OWNER_USER_ID,
  manager_membership_id: JOJUN_OWNER_MID, manager_name: "조준성",
  is_external_manager: false, started_at: nowIso,
}).select("id").single()
await sb.from("session_participants").insert({
  session_id: s3.id, membership_id: availableExt[0].id, role: "hostess",
  category: "퍼블릭", time_minutes: st.time_minutes, price_amount: st.price,
  manager_payout_amount: 0, hostess_payout_amount: st.price,
  margin_amount: 0, cha3_amount: 0, banti_amount: 0,
  waiter_tip_received: false, waiter_tip_amount: 0, greeting_confirmed: false,
  status: "active", store_uuid: MARVEL, origin_store_uuid: SANH,
  transfer_request_id: tr3.id, entered_at: nowIso,
})
console.log(`  ✓ ${extNameByMid.get(availableExt[0].id)} (상한가) · 3번방`)

console.log("\n─── 도착 대기 pool (2명 · 방 미배정) ───")
for (const ext of [availableExt[1], availableExt[2]]) {
  const meta = { category: "퍼블릭", time_type: "기본", dispatched_at: nowIso }
  await sb.from("transfer_requests").insert({
    hostess_membership_id: ext.id,
    from_store_uuid: SANH, to_store_uuid: MARVEL, business_day_id: BIZ_DAY, status: "approved",
    from_store_approved_by: OWNER_USER_ID, from_store_approved_at: nowIso,
    to_store_approved_by: OWNER_USER_ID, to_store_approved_at: nowIso,
    reason: JSON.stringify(meta),
  })
  console.log(`  ✓ ${extNameByMid.get(ext.id)} (상한가 → 마블 대기)`)
}

console.log("\n═══ 데모 세팅 완료 ═══")
console.log(`앱에서 강제새로고침 (Ctrl+Shift+R) 후 /m/staff (외부조판) 접속:`)
console.log(`  • 상단 amber pulse 배지 「🚪 도착 대기 · 방 배정 필요 2명」`)
console.log(`  • 1번방 진행 · 조준성 · 🔒 (잠금 · 다른 실장 수정 차단)`)
console.log(`  • 2번방 진행 · 조준성 · 참여자 2명 · 🔓 (확장하면 아가씨 추가/세션종료)`)
console.log(`  • 3번방 진행 · 조준성 · 외부 아가씨 1명`)
console.log(`  • 4~8번방 빈방 · + 체크인 버튼 (즉시 체크인)`)
console.log(``)
console.log(`/m (조판 홈) 접속:`)
console.log(`  • 상단 「🚪 도착 대기 2」 소형 amber 배지`)
console.log(`  • empty state 힌트 (담당 아가씨 없으면 외부조판/정산 링크)`)
console.log(``)
console.log(`/m/settle → 「우리 매장 들어온 타매장 식구」 → 상한가 카드`)
console.log(`  • 참여자에 방번호 표시 (3번방)`)
console.log(`  • 🚪 방이동 버튼 (다른 방으로 이동)`)
console.log(``)
console.log(`정리: node scripts/test-full-reset.mjs`)
