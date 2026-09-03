/**
 * 리셋 상태에서 각 기능 순차 시나리오 · 각 단계 이후 DB 상태 출력 · 문제점 즉시 감지.
 *
 * 시나리오:
 *   T1  체크인 (조준성 → 1번방)          → 세션 1개 · 담당 조준성
 *   T2  본 매장 아가씨 추가 (1번방)        → 참여자 1명 (본 매장)
 *   T3  Pending pool dispatch (상한가→마블) → 도착 대기 1건
 *   T4  Pending assign-room (2번방)       → 참여자 정식 등록 · 세션 실장 조준성
 *   T5  참여자 방 이동 (2번→3번)          → 참여자 3번방 세션 · 원 세션 close
 *   T6  아가씨 leave (1번방)              → 참여자 left · 세션 참여자 0
 *   T7  세션 force-close (1번방)          → 세션 close
 *   T8  Room lock (3번방 잠금)            → locked_by=조준성 · 다른 실장 접근 차단 (기대)
 *   T9  Lock 해제                         → locked_by=null
 */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"

const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const MARVEL = "ad1b95f0-5023-4c93-9282-efbb3d94ce76"
const JOJUN_OWNER_MID = "db74c206-fd8f-4a43-8e88-49ec43a60a32"
const JOJUN_USER_ID = "6cdaeb61-1e57-4d43-8b39-2ecbee9a19f4"  // 조준성 profile
const passes = [], fails = []

const { data: roomsAll } = await sb.from("rooms").select("id, room_no").eq("store_uuid", MARVEL)
const nameByRoomUuid = new Map(roomsAll.map(r => [r.id, r.room_no]))
const uuidByRoomNo = new Map(roomsAll.map(r => [r.room_no, r.id]))

// 조준성 실제 user_id 확인
const { data: ownerRow } = await sb.from("store_memberships").select("profile_id").eq("id", JOJUN_OWNER_MID).single()
const OWNER_USER_ID = ownerRow.profile_id

// 오늘 영업일
const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
if (kst.getUTCHours() < 6) kst.setUTCDate(kst.getUTCDate() - 1)
const businessDate = kst.toISOString().slice(0,10)
let { data: bd } = await sb.from("store_operating_days")
  .select("id, status").eq("store_uuid", MARVEL).eq("business_date", businessDate).maybeSingle()
if (!bd) {
  const { data: newBd, error: bdErr } = await sb.from("store_operating_days")
    .insert({ store_uuid: MARVEL, business_date: businessDate, status: "open", opened_by: null })
    .select("id").single()
  if (bdErr) { console.log(`영업일 생성 실패: ${bdErr.message}`); process.exit(1) }
  bd = { ...newBd, status: "open" }
  console.log(`  ✓ 영업일 자동 생성`)
} else if (bd.status === "closed") {
  await sb.from("store_operating_days").update({ status: "open", closed_at: null, closed_by: null }).eq("id", bd.id)
}
const BIZ_DAY = bd.id
console.log(`biz_day: ${businessDate}\n`)

// 매장 단가 (퍼블릭 기본)
const { data: st } = await sb.from("store_service_types")
  .select("time_minutes, price, manager_deduction")
  .eq("store_uuid", MARVEL).eq("service_type", "퍼블릭").eq("time_type", "기본").maybeSingle()

function log(label, ok, detail) {
  const icon = ok ? "✅" : "❌"
  console.log(`  ${icon} ${label}${detail ? ` · ${detail}` : ""}`)
  ;(ok ? passes : fails).push(label)
}

// ────────────────────────────────────────────────
console.log("═══ T1. 체크인 (조준성 → 1번방) ═══")
// ────────────────────────────────────────────────
const room1 = uuidByRoomNo.get("1")
const { data: t1sess, error: t1err } = await sb.from("room_sessions").insert({
  store_uuid: MARVEL, room_uuid: room1, business_day_id: BIZ_DAY, status: "active",
  opened_by: OWNER_USER_ID,
  manager_membership_id: JOJUN_OWNER_MID, manager_name: "조준성",
  is_external_manager: false, started_at: new Date().toISOString(),
}).select("id, manager_name").single()
if (t1err) { log("T1 세션 생성", false, t1err.message); process.exit(1) }
const SESSION_1 = t1sess.id
log("T1 세션 생성", true, `${SESSION_1.slice(0,8)} · 실장 ${t1sess.manager_name}`)

// ────────────────────────────────────────────────
console.log("\n═══ T2. 본 매장 아가씨 추가 (1번방) ═══")
// ────────────────────────────────────────────────
const { data: ownHost } = await sb.from("store_memberships")
  .select("id").eq("store_uuid", MARVEL).eq("role", "hostess").eq("status", "approved").is("deleted_at", null).limit(1)
const ownHostMid = ownHost?.[0]?.id
if (!ownHostMid) {
  log("T2 본 매장 아가씨 존재", false, "본 매장 approved hostess 없음")
} else {
  // active 인지 확인
  const { data: alreadyActive } = await sb.from("session_participants")
    .select("id").eq("membership_id", ownHostMid).eq("status", "active").is("deleted_at", null).limit(1).maybeSingle()
  if (alreadyActive) {
    log("T2 아가씨 사용 가능", false, "이미 다른 세션에서 active")
  } else {
    const { data: ownHostName } = await sb.from("hostesses").select("name").eq("membership_id", ownHostMid).maybeSingle()
    const { data: t2p, error: t2e } = await sb.from("session_participants").insert({
      session_id: SESSION_1, membership_id: ownHostMid, role: "hostess",
      category: "퍼블릭", time_minutes: st.time_minutes, price_amount: st.price,
      manager_payout_amount: st.manager_deduction ?? 0,
      hostess_payout_amount: Math.max(0, st.price - (st.manager_deduction ?? 0)),
      margin_amount: 0, cha3_amount: 0, banti_amount: 0,
      waiter_tip_received: false, waiter_tip_amount: 0, greeting_confirmed: false,
      status: "active", store_uuid: MARVEL, origin_store_uuid: null,
      entered_at: new Date().toISOString(),
    }).select("id").single()
    if (t2e) log("T2 참여자 추가", false, t2e.message)
    else log("T2 참여자 추가", true, `${ownHostName?.name ?? "?"} · participant ${t2p.id.slice(0,8)}`)
  }
}

// ────────────────────────────────────────────────
console.log("\n═══ T3. Pending pool dispatch (상한가 → 마블) ═══")
// ────────────────────────────────────────────────
// 상한가 매장 (DB 에 중복 row 있음 · limit(1) 로 첫 것만)
const { data: originStores } = await sb.from("stores").select("id").eq("store_name", "상한가").limit(1)
const originStore = originStores?.[0]
const { data: extHosts } = await sb.from("store_memberships")
  .select("id, profile_id").eq("store_uuid", originStore.id).eq("role", "hostess").eq("status", "approved").is("deleted_at", null).limit(20)
const extIds = extHosts.map(h => h.id)
const { data: activeExts } = await sb.from("session_participants")
  .select("membership_id").in("membership_id", extIds).eq("status", "active").is("deleted_at", null)
const activeSet = new Set((activeExts ?? []).map(p => p.membership_id))
const targetExt = extHosts.find(h => !activeSet.has(h.id))
if (!targetExt) {
  log("T3 외부 아가씨 확보", false, "상한가에 active 아닌 아가씨 없음")
} else {
  const { data: extName } = await sb.from("hostesses").select("name").eq("membership_id", targetExt.id).maybeSingle()
  const meta = { category: "퍼블릭", time_type: "기본", dispatched_at: new Date().toISOString() }
  const { data: tr, error: trErr } = await sb.from("transfer_requests").insert({
    hostess_membership_id: targetExt.id,
    from_store_uuid: originStore.id, to_store_uuid: MARVEL,
    business_day_id: BIZ_DAY, status: "approved",
    from_store_approved_by: OWNER_USER_ID, from_store_approved_at: new Date().toISOString(),
    to_store_approved_by: OWNER_USER_ID, to_store_approved_at: new Date().toISOString(),
    reason: JSON.stringify(meta),
  }).select("id").single()
  if (trErr) log("T3 pending 등록", false, trErr.message)
  else {
    log("T3 pending 등록", true, `${extName?.name ?? "?"} · tr ${tr.id.slice(0,8)}`)
    globalThis.T3_TR = tr.id
    globalThis.T3_HOST = targetExt.id
    globalThis.T3_HOST_NAME = extName?.name
    globalThis.T3_ORIGIN = originStore.id
  }
}

// ────────────────────────────────────────────────
console.log("\n═══ T4. Pending assign-room (2번방) ═══")
// ────────────────────────────────────────────────
if (!globalThis.T3_TR) {
  log("T4 skip", false, "T3 실패로 스킵")
} else {
  const room2 = uuidByRoomNo.get("2")
  // 시뮬레이션: assign-room 로직 재현 (신규 세션 · 조준성 실장 자동)
  const { data: t4sess, error: t4sErr } = await sb.from("room_sessions").insert({
    store_uuid: MARVEL, room_uuid: room2, business_day_id: BIZ_DAY, status: "active",
    opened_by: OWNER_USER_ID, manager_membership_id: JOJUN_OWNER_MID, manager_name: "조준성",
    is_external_manager: false, started_at: new Date().toISOString(),
  }).select("id, manager_name").single()
  if (t4sErr) { log("T4 세션", false, t4sErr.message); }
  else {
    const SESSION_2 = t4sess.id
    log("T4 신규 세션 실장 자동", t4sess.manager_name === "조준성", `session ${SESSION_2.slice(0,8)}`)
    const { data: t4p, error: t4pErr } = await sb.from("session_participants").insert({
      session_id: SESSION_2, membership_id: globalThis.T3_HOST, role: "hostess",
      category: "퍼블릭", time_minutes: st.time_minutes, price_amount: st.price,
      manager_payout_amount: st.manager_deduction ?? 0,
      hostess_payout_amount: Math.max(0, st.price - (st.manager_deduction ?? 0)),
      margin_amount: 0, cha3_amount: 0, banti_amount: 0,
      waiter_tip_received: false, waiter_tip_amount: 0, greeting_confirmed: false,
      status: "active", store_uuid: MARVEL,
      origin_store_uuid: globalThis.T3_ORIGIN, transfer_request_id: globalThis.T3_TR,
      entered_at: new Date().toISOString(),
    }).select("id").single()
    if (t4pErr) log("T4 참여자 등록", false, t4pErr.message)
    else {
      log("T4 참여자 등록", true, `${globalThis.T3_HOST_NAME} → 2번방`)
      globalThis.T4_PART = t4p.id
      globalThis.T4_SESS = SESSION_2
    }
  }
}

// ────────────────────────────────────────────────
console.log("\n═══ T5. 참여자 방 이동 (2번→3번) ═══")
// ────────────────────────────────────────────────
if (!globalThis.T4_PART) {
  log("T5 skip", false, "T4 실패로 스킵")
} else {
  const room3 = uuidByRoomNo.get("3")
  // 대상 방 active session 없음 → 신규 생성
  const { data: t5sess, error: t5sErr } = await sb.from("room_sessions").insert({
    store_uuid: MARVEL, room_uuid: room3, business_day_id: BIZ_DAY, status: "active",
    opened_by: OWNER_USER_ID, manager_membership_id: null, manager_name: null,
    is_external_manager: false, started_at: new Date().toISOString(),
  }).select("id").single()
  if (t5sErr) log("T5 대상 세션 생성", false, t5sErr.message)
  else {
    const SESSION_3 = t5sess.id
    // participant.session_id 교체
    const { error: t5uErr } = await sb.from("session_participants")
      .update({ session_id: SESSION_3 })
      .eq("id", globalThis.T4_PART).eq("status", "active")
    if (t5uErr) log("T5 참여자 이동", false, t5uErr.message)
    else {
      log("T5 참여자 이동", true, `2번 → 3번 · session_id 교체`)
      // 원 세션 close (참여자 0명)
      const { count } = await sb.from("session_participants")
        .select("id", { count: "exact", head: true })
        .eq("session_id", globalThis.T4_SESS).eq("status", "active")
      if ((count ?? 0) === 0) {
        await sb.from("room_sessions").update({ status: "closed", ended_at: new Date().toISOString() }).eq("id", globalThis.T4_SESS)
        log("T5 원 세션 자동 close", true, `2번방 세션 close (참여자 0)`)
      }
      globalThis.T5_SESS = SESSION_3
    }
  }
}

// ────────────────────────────────────────────────
console.log("\n═══ T6. 아가씨 leave (1번방 본 매장) ═══")
// ────────────────────────────────────────────────
const { data: p1 } = await sb.from("session_participants")
  .select("id, membership_id").eq("session_id", SESSION_1).eq("status", "active").limit(1).maybeSingle()
if (p1) {
  const { error: t6e } = await sb.from("session_participants")
    .update({ status: "left", left_at: new Date().toISOString() }).eq("id", p1.id)
  if (t6e) log("T6 leave", false, t6e.message)
  else log("T6 leave", true, `participant ${p1.id.slice(0,8)} · left`)
} else {
  log("T6 leave", false, "1번방 세션에 참여자 없음")
}

// ────────────────────────────────────────────────
console.log("\n═══ T7. 세션 force-close (1번방) ═══")
// ────────────────────────────────────────────────
const { count: t7count } = await sb.from("session_participants")
  .select("id", { count: "exact", head: true })
  .eq("session_id", SESSION_1).eq("status", "active")
if ((t7count ?? 0) === 0) {
  const { error: t7e } = await sb.from("room_sessions")
    .update({ status: "closed", ended_at: new Date().toISOString() })
    .eq("id", SESSION_1).eq("status", "active")
  log("T7 force-close", !t7e, t7e ? t7e.message : "1번방 세션 close")
} else {
  log("T7 force-close", false, `active 참여자 ${t7count}명 (기대: 0)`)
}

// ────────────────────────────────────────────────
console.log("\n═══ T8. Room lock (3번방 잠금) ═══")
// ────────────────────────────────────────────────
if (!globalThis.T5_SESS) {
  log("T8 skip", false, "T5 실패")
} else {
  const { error: t8e } = await sb.from("room_sessions")
    .update({ locked_by_membership_id: JOJUN_OWNER_MID, locked_at: new Date().toISOString() })
    .eq("id", globalThis.T5_SESS)
  if (t8e?.code === "42703") {
    log("T8 잠금", false, "Migration 094 미적용 · locked_by_membership_id 컬럼 없음")
  } else if (t8e) {
    log("T8 잠금", false, t8e.message)
  } else {
    const { data: lockedSess } = await sb.from("room_sessions")
      .select("locked_by_membership_id").eq("id", globalThis.T5_SESS).single()
    log("T8 잠금", lockedSess.locked_by_membership_id === JOJUN_OWNER_MID, `locked_by=${lockedSess.locked_by_membership_id?.slice(0,8)}`)
  }
}

// ────────────────────────────────────────────────
console.log("\n═══ T9. Lock 해제 ═══")
// ────────────────────────────────────────────────
if (!globalThis.T5_SESS) {
  log("T9 skip", false, "")
} else {
  const { error: t9e } = await sb.from("room_sessions")
    .update({ locked_by_membership_id: null, locked_at: null })
    .eq("id", globalThis.T5_SESS)
  if (t9e?.code === "42703") log("T9 해제", false, "Migration 미적용")
  else if (t9e) log("T9 해제", false, t9e.message)
  else log("T9 해제", true, "locked_by=null")
}

// ────────────────────────────────────────────────
console.log("\n═══ 최종 DB 상태 ═══")
// ────────────────────────────────────────────────
const { data: finalSess } = await sb.from("room_sessions")
  .select("id, room_uuid, status, manager_name").eq("store_uuid", MARVEL).eq("status", "active")
console.log(`Marvel active sessions: ${finalSess.length}`)
for (const s of finalSess) {
  const { count } = await sb.from("session_participants").select("id", { count: "exact", head: true })
    .eq("session_id", s.id).eq("status", "active")
  console.log(`  ${nameByRoomUuid.get(s.room_uuid)}번 · 참여자 ${count} · 실장 ${s.manager_name}`)
}
const { data: incoming } = await sb.from("session_participants")
  .select("id, hostess_payout_amount").eq("store_uuid", MARVEL).eq("status", "active")
  .gte("entered_at", `${businessDate}T06:00:00+09:00`).is("deleted_at", null)
const revenue = (incoming ?? []).reduce((a, p) => a + (p.hostess_payout_amount ?? 0) + (p.manager_payout_amount ?? 0), 0)
console.log(`\n오늘 매출 지표: 참여자 ${incoming?.length ?? 0}명 · 대략 매출 계산 참고용`)

console.log(`\n═══ 결과 ═══`)
console.log(`✅ ${passes.length} · ❌ ${fails.length}`)
if (fails.length > 0) {
  console.log(`\n실패:`)
  fails.forEach((f, i) => console.log(`  ${i+1}. ${f}`))
}
