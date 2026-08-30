/**
 * 테스트 시나리오: 다른 매장 실장이 자기 소속 아가씨를 Marvel 퍼블릭 완티로 dispatch.
 *
 * 사용자 질문: "그러면 나한테 어떻게 나타나는지 내가 몇번방에 넣을수있는지 확인"
 *
 * 절차:
 *   1. 상한가 (또는 아무 non-Marvel) 매장의 매니저 + 소속 아가씨 1명 찾기.
 *   2. dispatch route 대신 직접 supabase service key 로 상황 재현 (auth mock 생략):
 *      - Marvel 매장의 오늘 business_day 확보 or 생성
 *      - Marvel 의 첫 빈 방에 session_open (자동 방배정 재현)
 *      - session_participants insert (origin_store = 상한가)
 *   3. Marvel 관점에서 /api/manager/incoming-staff GET 흉내 (직접 쿼리) → 결과 출력.
 *   4. 사용자에게 "이렇게 나타난다 + 🚪 방이동 버튼으로 다른 방 이동" 안내.
 */

import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"

// .env.local 파싱
const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(
  envRaw.split("\n").filter(l => l.includes("=")).map(l => {
    const [k, ...rest] = l.split("=")
    return [k.trim(), rest.join("=").trim()]
  })
)
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY

const sb = createClient(url, key, { auth: { persistSession: false } })

// 1. Marvel 매장 조회
const { data: marvel } = await sb
  .from("stores").select("id, store_name, floor").eq("store_name", "마블").maybeSingle()
if (!marvel) { console.error("Marvel 매장 없음"); process.exit(1) }
console.log(`Marvel: ${marvel.id} · floor ${marvel.floor}`)

// 2. non-Marvel origin 매장 하나
const { data: origins } = await sb
  .from("stores").select("id, store_name, floor").eq("is_active", true).neq("id", marvel.id).order("floor")
const origin = origins?.find(s => s.floor === 7) ?? origins?.[0]
if (!origin) { console.error("origin 매장 없음"); process.exit(1) }
console.log(`Origin: ${origin.store_name} (${origin.id}) · floor ${origin.floor}`)

// 3. origin 매장의 approved hostess membership 1명
const { data: hostRows } = await sb
  .from("store_memberships")
  .select("id, profile_id")
  .eq("store_uuid", origin.id)
  .eq("role", "hostess")
  .eq("status", "approved")
  .is("deleted_at", null)
  .limit(5)
if (!hostRows?.length) { console.error(`${origin.store_name}에 아가씨 없음`); process.exit(1) }

// hostess 이름 조회
const memberIds = hostRows.map(h => h.id)
const { data: hostNames } = await sb
  .from("hostesses").select("membership_id, name").in("membership_id", memberIds)
const nameByMid = new Map((hostNames ?? []).map(h => [h.membership_id, h.name]))
const testHost = hostRows.find(h => nameByMid.get(h.id))
if (!testHost) { console.error("이름 있는 hostess 없음"); process.exit(1) }
const testHostName = nameByMid.get(testHost.id)
console.log(`테스트 아가씨: ${testHostName} (membership_id=${testHost.id})`)

// 4. Marvel 오늘 business_day 확보
const now = new Date()
const kstOffset = 9 * 60 * 60 * 1000
const kst = new Date(now.getTime() + kstOffset)
const businessDate = kst.toISOString().slice(0, 10)
console.log(`Business date (KST): ${businessDate}`)

let bizDayId
const { data: existBd } = await sb
  .from("store_operating_days")
  .select("id, status")
  .eq("store_uuid", marvel.id)
  .eq("business_date", businessDate)
  .maybeSingle()

if (existBd) {
  bizDayId = existBd.id
  if (existBd.status === "closed") {
    await sb.from("store_operating_days").update({ status: "open", closed_at: null, closed_by: null }).eq("id", existBd.id)
    console.log(`  reopened bizDay ${bizDayId}`)
  } else {
    console.log(`  reuse open bizDay ${bizDayId}`)
  }
} else {
  const { data: newBd, error: bdErr } = await sb
    .from("store_operating_days")
    .insert({ store_uuid: marvel.id, business_date: businessDate, status: "open", opened_by: testHost.profile_id })
    .select("id").single()
  if (bdErr) { console.error("bizDay insert failed:", bdErr); process.exit(1) }
  bizDayId = newBd.id
  console.log(`  new bizDay ${bizDayId}`)
}

// 5. Marvel 의 첫 빈 방 (또는 첫 방)
const { data: rooms } = await sb
  .from("rooms")
  .select("id, room_no, room_name")
  .eq("store_uuid", marvel.id)
  .eq("is_active", true)
  .order("room_no")
if (!rooms?.length) { console.error("Marvel 방 없음"); process.exit(1) }

const { data: activeSess } = await sb
  .from("room_sessions")
  .select("id, room_uuid")
  .eq("store_uuid", marvel.id)
  .eq("status", "active")
const busy = new Set((activeSess ?? []).map(s => s.room_uuid))
const targetRoom = rooms.find(r => !busy.has(r.id)) ?? rooms[0]
console.log(`  자동 배정 방: ${targetRoom.room_no}번 (${targetRoom.id})`)

// 6. Marvel session 생성 (or reuse)
let sessionId
const reuseSess = (activeSess ?? []).find(s => s.room_uuid === targetRoom.id)
if (reuseSess) {
  sessionId = reuseSess.id
  console.log(`  reuse session ${sessionId}`)
} else {
  const { data: newSess, error: sessErr } = await sb
    .from("room_sessions")
    .insert({
      store_uuid: marvel.id,
      room_uuid: targetRoom.id,
      business_day_id: bizDayId,
      status: "active",
      opened_by: testHost.profile_id,
      manager_membership_id: null,
      manager_name: `${origin.store_name} 실장`,
      is_external_manager: true,
    })
    .select("id").single()
  if (sessErr) { console.error("session insert failed:", sessErr); process.exit(1) }
  sessionId = newSess.id
  console.log(`  new session ${sessionId}`)
}

// 7. Marvel service_types 조회 — 퍼블릭 기본
const { data: st } = await sb
  .from("store_service_types")
  .select("time_minutes, price, manager_deduction")
  .eq("store_uuid", marvel.id)
  .eq("service_type", "퍼블릭")
  .eq("time_type", "기본")
  .maybeSingle()
if (!st) { console.error("Marvel 퍼블릭 기본 단가 미설정"); process.exit(1) }
console.log(`  단가: ${st.price} · ${st.time_minutes}분 · 실장수익 ${st.manager_deduction}`)

// 8a. transfer_request 자동 생성 (DB 트리거 요구)
const nowIso = new Date().toISOString()
const { data: trRow, error: trErr } = await sb
  .from("transfer_requests")
  .insert({
    hostess_membership_id: testHost.id,
    from_store_uuid: origin.id,
    to_store_uuid: marvel.id,
    business_day_id: bizDayId,
    status: "approved",
    from_store_approved_by: testHost.profile_id,
    from_store_approved_at: nowIso,
    to_store_approved_by: testHost.profile_id,
    to_store_approved_at: nowIso,
    reason: "[test-script] 시나리오 재현",
  })
  .select("id").single()
if (trErr) { console.error("transfer_request insert failed:", trErr); process.exit(1) }
console.log(`  transfer_request ${trRow.id} (approved)`)

// 8b. session_participants insert (origin_store = 발리)
const { data: newPart, error: partErr } = await sb
  .from("session_participants")
  .insert({
    session_id: sessionId,
    membership_id: testHost.id,
    role: "hostess",
    category: "퍼블릭",
    time_minutes: st.time_minutes,
    price_amount: st.price,
    manager_payout_amount: st.manager_deduction,
    hostess_payout_amount: st.price - st.manager_deduction,
    margin_amount: 0,
    cha3_amount: 0,
    banti_amount: 0,
    waiter_tip_received: false,
    waiter_tip_amount: 0,
    greeting_confirmed: false,
    origin_store_uuid: origin.id,
    transfer_request_id: trRow.id,
    status: "active",
    store_uuid: marvel.id,
  })
  .select("id, entered_at").single()
if (partErr) { console.error("participant insert failed:", partErr); process.exit(1) }
console.log(`\n✅ 참여자 등록됨: ${newPart.id} · entered_at=${newPart.entered_at}`)

console.log(`\n--- 이제 Marvel 조준성이 /m/settle 열면 ---`)
console.log(`  🔄 우리 매장 들어온 타매장 식구`)
console.log(`    ${origin.store_name} · 실장 미배정`)
console.log(`      ${testHostName} · 퍼블릭 90분 · ${targetRoom.room_no}번방 · 지금`)
console.log(`      [🚪 방이동] [✏️ 수정]`)
console.log(`      ${st.price.toLocaleString()}원 · 줄 ${(st.price - st.manager_deduction).toLocaleString()}`)
console.log(`\n  🚪 클릭 → 방 grid → 다른 방 선택 → 이동 완료`)

// 9. /api/manager/incoming-staff 결과 검증 (직접 쿼리 흉내)
const startKst = new Date(`${businessDate}T06:00:00+09:00`)
const endKst = new Date(startKst); endKst.setUTCDate(endKst.getUTCDate() + 1)
const { data: parts } = await sb
  .from("session_participants")
  .select("id, session_id, membership_id, origin_store_uuid, category, time_minutes, price_amount, hostess_payout_amount, manager_payout_amount, status, entered_at")
  .eq("store_uuid", marvel.id)
  .gte("entered_at", startKst.toISOString())
  .lt("entered_at", endKst.toISOString())
  .not("origin_store_uuid", "is", null)
  .neq("origin_store_uuid", marvel.id)
  .is("deleted_at", null)

const sessionIds = [...new Set(parts.map(p => p.session_id))]
const { data: sessRows } = await sb.from("room_sessions").select("id, room_uuid").in("id", sessionIds)
const roomBySession = new Map(sessRows.map(s => [s.id, s.room_uuid]))
const roomUuids = [...new Set(sessRows.map(s => s.room_uuid))]
const { data: roomRows } = await sb.from("rooms").select("id, room_no").in("id", roomUuids)
const nameByRoom = new Map(roomRows.map(r => [r.id, r.room_no]))

console.log(`\n--- API 응답 검증 (${parts.length}건) ---`)
for (const p of parts) {
  const ru = roomBySession.get(p.session_id)
  const rn = ru ? nameByRoom.get(ru) : null
  const hName = nameByMid.get(p.membership_id) ?? (await sb.from("hostesses").select("name").eq("membership_id", p.membership_id).maybeSingle()).data?.name
  console.log(`  ${hName} · ${p.category} · ${p.time_minutes}분 · ${rn ? rn + "번방" : "방없음"} · ₩${p.price_amount} · 줄 ₩${p.hostess_payout_amount}`)
  console.log(`    session_id=${p.session_id}, participant_id=${p.id}`)
}

console.log(`\n===`)
console.log(`Marvel 조준성 앱에서 /m/settle 접속 → 「🔄 우리 매장 들어온 타매장 식구」`)
console.log(`섹션에 ${origin.store_name} 카드 · ${testHostName} 표시됨.`)
console.log(`「🚪」 클릭 → 방 grid → 원하는 방 pick → 이동.`)
console.log(`정리 후 원복하려면 이 참여자 id ${newPart.id} + session ${sessionId} 삭제.`)
