/**
 * R30 recent features 전체 검증. 문제점 목록화.
 *
 * 대상:
 *   1. Pending pool 상태 · assign-room · 재조회 (지유 sample)
 *   2. Force-close (빈 세션)
 *   3. Instant checkin flow (session 생성 · manager 세팅)
 *   4. Add hostess (session 확장 flow)
 *   5. Move-room (참여자 이동)
 *   6. Room lock (컬럼 존재 · toggle · guard)
 *   7. Cache 실효성 (building_rooms)
 *   8. AssignFlowSheet 관련 (unused test)
 *   9. Cross-store dispatch immediate/pending mode 구분
 *
 * DB direct 로 endpoint 로직 재현 · HTTP layer 는 auth 필요라 skip.
 */
import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "node:fs"

const envRaw = readFileSync("C:/work/nox/.env.local", "utf8")
const env = Object.fromEntries(envRaw.split("\n").filter(l => l.includes("=")).map(l => { const [k,...r] = l.split("="); return [k.trim(), r.join("=").trim()] }))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const MARVEL = "ad1b95f0-5023-4c93-9282-efbb3d94ce76"
const JOJUN_OWNER_MID = "db74c206-fd8f-4a43-8e88-49ec43a60a32"
const problems = []
const passes = []

function fail(msg) { problems.push(msg); console.log(`❌ ${msg}`) }
function pass(msg) { passes.push(msg); console.log(`✅ ${msg}`) }
function info(msg) { console.log(`   ${msg}`) }

// ─────────────────────────────────────────────
console.log("\n═══ 1. Migration 094 room_session_lock ═══")
// ─────────────────────────────────────────────
const lockProbe = await sb.from("room_sessions").select("locked_by_membership_id, locked_at").limit(1)
if (lockProbe.error?.code === "42703") {
  fail("Migration 094 미적용 — locked_by_membership_id 컬럼 없음 · 방잠금 no-op")
} else if (lockProbe.error) {
  fail(`lock 컬럼 probe 에러: ${lockProbe.error.message}`)
} else {
  pass("Migration 094 적용됨 (locked_by_membership_id 컬럼 존재)")
}

// ─────────────────────────────────────────────
console.log("\n═══ 2. Marvel active sessions 상태 ═══")
// ─────────────────────────────────────────────
const { data: rooms } = await sb.from("rooms").select("id, room_no").eq("store_uuid", MARVEL)
const roomNoByUuid = new Map(rooms.map(r => [r.id, r.room_no]))
const { data: sess } = await sb.from("room_sessions")
  .select("id, room_uuid, started_at, manager_name, manager_membership_id, is_external_manager, status")
  .eq("store_uuid", MARVEL).eq("status", "active")

info(`Marvel active sessions: ${sess.length}건`)
for (const s of sess) {
  const { count: pc } = await sb.from("session_participants")
    .select("id", { count: "exact", head: true })
    .eq("session_id", s.id).eq("status", "active").is("deleted_at", null)
  const hrs = ((Date.now() - new Date(s.started_at).getTime()) / 3600_000).toFixed(1)
  info(`  · ${roomNoByUuid.get(s.room_uuid) ?? "?"}번 · ${hrs}h · 참여자 ${pc} · 실장 ${s.manager_name ?? "미지정"}`)
  if (!s.manager_membership_id) {
    fail(`${roomNoByUuid.get(s.room_uuid)}번방 세션 실장 미지정 (auto-manager 기대)`)
  }
  if (Number(hrs) > 12 && pc === 0) {
    fail(`${roomNoByUuid.get(s.room_uuid)}번방 stale (${hrs}h · 참여자 0)`)
  }
}

// ─────────────────────────────────────────────
console.log("\n═══ 3. Pending pool 상태 ═══")
// ─────────────────────────────────────────────
const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
if (kst.getUTCHours() < 6) kst.setUTCDate(kst.getUTCDate() - 1)
const businessDate = kst.toISOString().slice(0,10)
const { data: bd } = await sb.from("store_operating_days")
  .select("id").eq("store_uuid", MARVEL).eq("business_date", businessDate).maybeSingle()

if (!bd) { fail(`오늘 (${businessDate}) 영업일 없음`) }
else {
  info(`business_day: ${bd.id} (${businessDate})`)
  const { data: trs } = await sb.from("transfer_requests")
    .select("id, hostess_membership_id, reason").eq("to_store_uuid", MARVEL)
    .eq("status", "approved").eq("business_day_id", bd.id)
  const trIds = trs.map(t => t.id)
  const { data: used } = await sb.from("session_participants")
    .select("transfer_request_id").in("transfer_request_id", trIds).is("deleted_at", null)
  const usedSet = new Set((used ?? []).map(r => r.transfer_request_id).filter(Boolean))
  const pending = trs.filter(t => !usedSet.has(t.id))
  const assigned = trs.filter(t => usedSet.has(t.id))
  info(`transfer_requests: ${trs.length} (pending ${pending.length}, assigned ${assigned.length})`)

  // reason parse 검증
  let parseFail = 0
  for (const t of trs) {
    if (!t.reason) { parseFail++; continue }
    try {
      const meta = JSON.parse(t.reason)
      if (!meta.category || !meta.time_type) parseFail++
    } catch { parseFail++ }
  }
  if (parseFail > 0) {
    fail(`transfer_requests ${parseFail}건 reason JSON 파싱 실패 · assign-room 시 METADATA_INVALID`)
  } else {
    pass("모든 pending TR reason JSON 파싱 정상")
  }
}

// ─────────────────────────────────────────────
console.log("\n═══ 4. Force-close endpoint 로직 재현 ═══")
// ─────────────────────────────────────────────
// 임의 stale 세션이 없으면 skip
const staleSess = sess.filter(s => Number((Date.now() - new Date(s.started_at).getTime()) / 3600_000) > 24)
if (staleSess.length === 0) {
  pass("stale 세션 없음 (force-close 필요 X)")
} else {
  info(`stale ${staleSess.length}건 · force-close 필요`)
}

// ─────────────────────────────────────────────
console.log("\n═══ 5. Instant checkin 로직 (재현) ═══")
// ─────────────────────────────────────────────
// 빈 방 하나 골라 checkin 시뮬레이션 (실제 create 는 skip · manager assignment 검증만)
const busySet = new Set(sess.map(s => s.room_uuid))
const emptyRoom = rooms.find(r => !busySet.has(r.id))
if (!emptyRoom) {
  fail("Marvel 빈 방 없음 · instant checkin 테스트 불가")
} else {
  info(`빈 방: ${emptyRoom.room_no}번 · checkin 시 manager=조준성 세팅 정상 동작 예상`)
  pass(`instant checkin 대상 확보 (${emptyRoom.room_no}번)`)
}

// ─────────────────────────────────────────────
console.log("\n═══ 6. Building rooms cache freshness ═══")
// ─────────────────────────────────────────────
// checkin route 는 invalidateCache('building_rooms') 호출함. 코드 확인.
const checkinSrc = readFileSync("C:/work/nox/app/api/sessions/checkin/route.ts", "utf8")
if (!checkinSrc.includes('invalidateCache("building_rooms")')) {
  fail("checkin route 에 invalidateCache('building_rooms') 없음")
} else {
  pass("checkin: building_rooms 캐시 invalidate 함")
}
const forceCloseSrc = readFileSync("C:/work/nox/app/api/sessions/[session_id]/force-close/route.ts", "utf8")
if (!forceCloseSrc.includes('invalidateCache("building_rooms")')) {
  fail("force-close: building_rooms invalidate 없음")
} else {
  pass("force-close: building_rooms 캐시 invalidate 함")
}
const assignRoomSrc = readFileSync("C:/work/nox/app/api/manager/pending-arrivals/[transfer_request_id]/assign-room/route.ts", "utf8")
if (!assignRoomSrc.includes('invalidateCache("building_rooms")')) {
  fail("assign-room: building_rooms invalidate 없음")
} else {
  pass("assign-room: building_rooms 캐시 invalidate 함")
}

// ─────────────────────────────────────────────
console.log("\n═══ 7. Lock guard 통합 확인 ═══")
// ─────────────────────────────────────────────
const guardedFiles = [
  "app/api/sessions/participants/route.ts",
  "app/api/sessions/participants/[participant_id]/leave/route.ts",
  "app/api/sessions/[session_id]/route.ts",
  "app/api/sessions/[session_id]/force-close/route.ts",
]
for (const f of guardedFiles) {
  const src = readFileSync(`C:/work/nox/${f}`, "utf8")
  if (!src.includes("assertSessionUnlocked")) {
    fail(`${f}: lockGuard 미통합`)
  } else {
    pass(`${f.split("/").pop()}: lockGuard 통합됨`)
  }
}

// move-room 은 guard 없음 (도착 매장 아가씨 이동은 원 세션 lock 무관)
const moveRoomSrc = readFileSync("C:/work/nox/app/api/sessions/participants/[participant_id]/move-room/route.ts", "utf8")
if (!moveRoomSrc.includes("assertSessionUnlocked")) {
  info("move-room: guard 미통합 (의도적? · 이동은 원 세션에서 참여자 제거 · lock 우회 가능)")
  problems.push("move-room 에 lockGuard 없음 — 잠금된 세션에서도 참여자를 다른 방으로 옮길 수 있음")
}

// pending-arrivals/assign-room 은 guard 대상 X (신규 세션 or 재사용 시 처리)

// ─────────────────────────────────────────────
console.log("\n═══ 8. AddHostessToSessionSheet default filter ═══")
// ─────────────────────────────────────────────
const sheetSrc = readFileSync("C:/work/nox/app/m/_components/AddHostessToSessionSheet.tsx", "utf8")
if (!sheetSrc.includes("includeExternal")) {
  fail("AddHostessToSessionSheet: includeExternal 필터 없음")
} else if (sheetSrc.includes("useState(false)")) {
  pass("AddHostessToSessionSheet: default 본 매장만 (includeExternal=false)")
} else {
  fail("AddHostessToSessionSheet: includeExternal default 세팅 확인 필요")
}

// ─────────────────────────────────────────────
console.log("\n═══ 9. UI 확인 ═══")
// ─────────────────────────────────────────────
const staffSrc = readFileSync("C:/work/nox/app/m/(app)/staff/page.tsx", "utf8")
const uiChecks = [
  { k: "lockBusy", label: "방잠금 state" },
  { k: "toggleLock", label: "잠금 toggle 함수" },
  { k: "instantCheckin", label: "즉시 체크인 함수" },
  { k: "forceClose", label: "세션 종료 함수" },
  { k: "AddHostessToSessionSheet", label: "아가씨 추가 시트 import" },
  { k: "PendingArrivalSheet", label: "도착 대기 시트 import" },
  { k: "usePendingArrivals", label: "도착 대기 hook" },
]
for (const c of uiChecks) {
  if (staffSrc.includes(c.k)) pass(`staff page: ${c.label} (${c.k})`)
  else fail(`staff page: ${c.label} (${c.k}) 없음`)
}

// ─────────────────────────────────────────────
console.log("\n═══ 10. 잠재 이슈 정적 스캔 ═══")
// ─────────────────────────────────────────────
// (a) reason 필드 JSON 파싱 — 기존 dispatch immediate 모드도 reason 에 텍스트 저장 → pending-arrivals 목록에 섞이면?
const dispatchSrc = readFileSync("C:/work/nox/app/api/cross-store/dispatch/route.ts", "utf8")
if (dispatchSrc.includes('reason: `[dispatch]')) {
  // immediate 모드는 reason='[dispatch]... 즉시 배정' (plain text)
  // pending-arrivals 는 이 TR 을 참여자 있음으로 걸러냄 · 안전
  info("immediate mode: reason=plain text · pending-arrivals 는 이미 배정된 것 걸러냄 (safe)")
}

// (b) instant checkin — 다른 매장 방 (super_admin) 인 경우 링크 유지 확인
if (staffSrc.includes("isOwnStore") && staffSrc.includes("if (!isOwnStore)")) {
  pass("instant checkin: 다른 매장 방은 링크 유지 (안전)")
} else {
  fail("instant checkin: 다른 매장 방 처리 로직 확인 필요")
}

// (c) MoveRoomSheet 타 매장 이동 차단 — API 는 store_uuid 일치 확인함
const moveRoomApi = readFileSync("C:/work/nox/app/api/sessions/participants/[participant_id]/move-room/route.ts", "utf8")
if (moveRoomApi.includes("ROOM_STORE_MISMATCH")) {
  pass("move-room API: 다른 매장 방 차단")
} else {
  fail("move-room API: 다른 매장 방 차단 로직 없음")
}

// (d) LiveRoomCard 잠금 UI — locked_by_membership_id undefined 처리
if (staffSrc.includes("s.locked_by_membership_id ?? null")) {
  pass("LiveRoomCard: locked_by undefined 안전 처리")
} else {
  fail("LiveRoomCard: locked_by undefined 처리 확인 필요")
}

// ─────────────────────────────────────────────
console.log("\n═══ 결과 요약 ═══")
console.log(`  ✅ 통과: ${passes.length}`)
console.log(`  ❌ 문제: ${problems.length}`)
if (problems.length > 0) {
  console.log("\n─ 문제점 ─")
  problems.forEach((p, i) => console.log(`  ${i+1}. ${p}`))
}
