/**
 * 풀 시뮬레이션 시드 — [시뮬] prefix 격리
 *
 * 생성:
 *   - 14 매장 ([시뮬] 5층-A, [시뮬] 5층-B, ...)
 *   - 매장당 실장 3명 (총 42명)
 *   - 매장당 아가씨 20명, P:H:S = 7:7:6 (총 280명)
 *     · 실장 1 담당: P 3 + H 2 + S 2 = 7
 *     · 실장 2 담당: P 2 + H 3 + S 2 = 7
 *     · 실장 3 담당: P 2 + H 2 + S 2 = 6
 *   - 매장당 룸 10개
 *   - 매장당 종목 단가 9개 (P/H/S × 기본/반티/차3)
 *   - 하루치 시뮬레이션:
 *     · 룸 활용도 60% → 매장당 6 세션
 *     · 각 세션 1~3 아가씨 참여
 *     · 50% 정산 finalize
 *     · 채팅: 14매장 실장방 + 매장별 실장방 + 메시지
 *
 * 실행:
 *   SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seed-simulation.ts
 *
 * Cleanup (재실행 전):
 *   SIM_CLEANUP=1 npx tsx scripts/seed-simulation.ts
 *
 * 격리:
 *   - 매장명 prefix `[시뮬]`
 *   - 이메일 도메인 `@nox-sim.local`
 *   - 비밀번호: env SIM_PASSWORD 또는 Sim1234!
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[seed-simulation] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")
  process.exit(1)
}

const PASSWORD = process.env.SIM_PASSWORD ?? "Sim1234!"
const SIM_PREFIX = "[시뮬]"
const SIM_EMAIL_DOMAIN = "nox-sim.local"

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

// ─── 매장 14개 (5층~8층 4/4/3/3 분배) ─────────────────
const STORES = [
  { floor: 5, label: "A" }, { floor: 5, label: "B" }, { floor: 5, label: "C" }, { floor: 5, label: "D" },
  { floor: 6, label: "A" }, { floor: 6, label: "B" }, { floor: 6, label: "C" }, { floor: 6, label: "D" },
  { floor: 7, label: "A" }, { floor: 7, label: "B" }, { floor: 7, label: "C" },
  { floor: 8, label: "A" }, { floor: 8, label: "B" }, { floor: 8, label: "C" },
] as const

const MANAGER_SURNAMES = ["김", "박", "이", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "신", "권"]
const HOSTESS_NAMES = [
  "채아", "지유", "미라", "하늘", "유나", "지연", "채은", "서연", "다은", "유리",
  "보영", "하영", "지효", "나래", "수민", "가은", "예린", "채린", "소희", "윤지",
  "라온", "다인", "하린", "보라", "다정", "시은", "단비", "햇살", "여울", "별",
  "윤아", "지원", "혜인", "민서", "예나", "수아", "유진", "주아", "현지", "재이",
]

// 종목 (NOX 비즈니스 규칙)
const SERVICE_TYPES = [
  // 퍼블릭(P)
  { service_type: "퍼블릭", time_type: "기본", time_minutes: 90, price: 130000, manager_deduction: 5000, has_greeting_check: false, sort_order: 1 },
  { service_type: "퍼블릭", time_type: "반티", time_minutes: 45, price:  70000, manager_deduction: 5000, has_greeting_check: false, sort_order: 2 },
  { service_type: "퍼블릭", time_type: "차3",  time_minutes: 15, price:  30000, manager_deduction: 0,    has_greeting_check: false, sort_order: 3 },
  // 셔츠(S)
  { service_type: "셔츠",   time_type: "기본", time_minutes: 60, price: 140000, manager_deduction: 5000, has_greeting_check: true,  sort_order: 4 },
  { service_type: "셔츠",   time_type: "반티", time_minutes: 30, price:  70000, manager_deduction: 5000, has_greeting_check: true,  sort_order: 5 },
  { service_type: "셔츠",   time_type: "차3",  time_minutes: 15, price:  30000, manager_deduction: 0,    has_greeting_check: false, sort_order: 6 },
  // 하퍼(H)
  { service_type: "하퍼",   time_type: "기본", time_minutes: 60, price: 120000, manager_deduction: 5000, has_greeting_check: false, sort_order: 7 },
  { service_type: "하퍼",   time_type: "반티", time_minutes: 30, price:  60000, manager_deduction: 5000, has_greeting_check: false, sort_order: 8 },
  { service_type: "하퍼",   time_type: "차3",  time_minutes: 15, price:  30000, manager_deduction: 0,    has_greeting_check: false, sort_order: 9 },
] as const

// 카테고리별 아가씨 분배 (매장 20명, 실장 3명)
const HOSTESS_DISTRIBUTION = [
  { mgrIdx: 0, P: 3, H: 2, S: 2 }, // 실장 1: 7명
  { mgrIdx: 1, P: 2, H: 3, S: 2 }, // 실장 2: 7명
  { mgrIdx: 2, P: 2, H: 2, S: 2 }, // 실장 3: 6명
] as const
// 카테고리 → service_type 이름 매칭
const CAT_NAME = { P: "퍼블릭", H: "하퍼", S: "셔츠" } as const

// ─── 헬퍼 ────────────────────────────────────────────────

const log = (...a: unknown[]) => console.log("[seed-sim]", ...a)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let userIdByEmail: Map<string, string> | null = null
async function lookupUserIdByEmail(email: string): Promise<string | null> {
  if (!userIdByEmail) {
    userIdByEmail = new Map()
    let page = 1
    while (true) {
      const { data } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
      if (!data?.users?.length) break
      for (const u of data.users) {
        if (u.email) userIdByEmail.set(u.email.toLowerCase(), u.id)
      }
      if (data.users.length < 1000) break
      page++
    }
  }
  return userIdByEmail.get(email.toLowerCase()) ?? null
}

async function getOrCreateUser(email: string, fullName: string): Promise<string> {
  const existing = await lookupUserIdByEmail(email)
  if (existing) {
    await supabase.from("profiles").upsert({ id: existing, full_name: fullName, is_active: true }, { onConflict: "id" })
    return existing
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (error || !data.user) throw new Error(`createUser(${email}): ${error?.message}`)
  userIdByEmail?.set(email.toLowerCase(), data.user.id)
  await supabase.from("profiles").upsert({ id: data.user.id, full_name: fullName, is_active: true }, { onConflict: "id" })
  return data.user.id
}

async function getOrCreateStore(storeName: string, floor: number): Promise<string> {
  const { data: existing } = await supabase
    .from("stores")
    .select("id")
    .eq("store_name", storeName)
    .maybeSingle()
  if (existing) return existing.id
  const { data, error } = await supabase
    .from("stores")
    .insert({ store_name: storeName, floor, is_active: true })
    .select("id")
    .single()
  if (error || !data) throw new Error(`createStore(${storeName}): ${error?.message}`)
  return data.id
}

async function getOrCreateMembership(
  profileId: string,
  storeUuid: string,
  role: "owner" | "manager" | "hostess",
): Promise<string> {
  const { data: existing } = await supabase
    .from("store_memberships")
    .select("id")
    .eq("profile_id", profileId)
    .eq("store_uuid", storeUuid)
    .eq("role", role)
    .maybeSingle()
  if (existing) return existing.id
  const { data, error } = await supabase
    .from("store_memberships")
    .insert({
      profile_id: profileId,
      store_uuid: storeUuid,
      role,
      status: "approved",
      is_primary: true,
      approved_at: new Date().toISOString(),
    })
    .select("id")
    .single()
  if (error || !data) throw new Error(`createMembership: ${error?.message}`)
  return data.id
}

async function ensureManager(storeUuid: string, membershipId: string, name: string): Promise<string> {
  const { data: existing } = await supabase
    .from("managers")
    .select("id")
    .eq("store_uuid", storeUuid)
    .eq("membership_id", membershipId)
    .maybeSingle()
  if (existing) return existing.id
  const { data, error } = await supabase
    .from("managers")
    .insert({ store_uuid: storeUuid, membership_id: membershipId, name, is_active: true })
    .select("id")
    .single()
  if (error || !data) throw new Error(`createManager(${name}): ${error?.message}`)
  return data.id
}

async function ensureHostess(
  storeUuid: string,
  membershipId: string,
  managerMembershipId: string,
  name: string,
  category: "P" | "H" | "S",
): Promise<string> {
  const { data: existing } = await supabase
    .from("hostesses")
    .select("id")
    .eq("store_uuid", storeUuid)
    .eq("membership_id", membershipId)
    .maybeSingle()
  if (existing) {
    await supabase
      .from("hostesses")
      .update({ manager_membership_id: managerMembershipId, name, category: CAT_NAME[category] })
      .eq("id", existing.id)
    return existing.id
  }
  const { data, error } = await supabase
    .from("hostesses")
    .insert({
      store_uuid: storeUuid,
      membership_id: membershipId,
      manager_membership_id: managerMembershipId,
      name,
      category: CAT_NAME[category],
      is_active: true,
    })
    .select("id")
    .single()
  if (error || !data) throw new Error(`createHostess(${name}): ${error?.message}`)
  return data.id
}

async function ensureRoom(storeUuid: string, roomNo: string, floor: number): Promise<string> {
  const { data: existing } = await supabase
    .from("rooms")
    .select("id")
    .eq("store_uuid", storeUuid)
    .eq("room_no", roomNo)
    .maybeSingle()
  if (existing) return existing.id
  const { data, error } = await supabase
    .from("rooms")
    .insert({
      store_uuid: storeUuid,
      room_no: roomNo,
      room_name: `룸 ${roomNo}`,
      floor_no: floor,
      is_active: true,
      sort_order: parseInt(roomNo, 10),
    })
    .select("id")
    .single()
  if (error || !data) throw new Error(`createRoom(${roomNo}): ${error?.message}`)
  return data.id
}

async function ensureServiceType(storeUuid: string, t: typeof SERVICE_TYPES[number]): Promise<void> {
  const { data: existing } = await supabase
    .from("store_service_types")
    .select("id")
    .eq("store_uuid", storeUuid)
    .eq("service_type", t.service_type)
    .eq("time_type", t.time_type)
    .maybeSingle()
  if (existing) return
  await supabase
    .from("store_service_types")
    .insert({ store_uuid: storeUuid, ...t })
}

async function ensureBusinessDay(storeUuid: string, date: string, openedBy: string): Promise<string> {
  const { data: existing } = await supabase
    .from("store_operating_days")
    .select("id, status")
    .eq("store_uuid", storeUuid)
    .eq("business_date", date)
    .maybeSingle()
  if (existing) {
    if (existing.status === "closed") {
      await supabase
        .from("store_operating_days")
        .update({ status: "open", closed_at: null, closed_by: null })
        .eq("id", existing.id)
    }
    return existing.id
  }
  const { data, error } = await supabase
    .from("store_operating_days")
    .insert({ store_uuid: storeUuid, business_date: date, status: "open", opened_by: openedBy })
    .select("id")
    .single()
  if (error || !data) throw new Error(`createBizDay: ${error?.message}`)
  return data.id
}

// 시드 매장 구조 (메모리 캐시)
type StoreInfo = {
  storeUuid: string
  storeName: string
  floor: number
  managers: { membershipId: string; name: string; userId: string }[]
  hostesses: { membershipId: string; name: string; category: "P" | "H" | "S"; managerMembershipId: string }[]
  rooms: { id: string; roomNo: string }[]
}

const seededStores: StoreInfo[] = []

// ─── 1단계: 매장 + 실장 + 아가씨 + 룸 + 종목 ────────────
async function seedStructure() {
  log("=== 1단계: 매장/실장/아가씨/룸/종목 ===")
  let hostessNameIdx = 0
  for (let si = 0; si < STORES.length; si++) {
    const sc = STORES[si]
    const storeName = `${SIM_PREFIX} ${sc.floor}층-${sc.label}`
    log(`[${si + 1}/${STORES.length}] ${storeName}`)
    const storeUuid = await getOrCreateStore(storeName, sc.floor)

    // 종목 단가
    for (const st of SERVICE_TYPES) await ensureServiceType(storeUuid, st)

    // 룸 10개
    const rooms: { id: string; roomNo: string }[] = []
    for (let r = 1; r <= 10; r++) {
      const roomNo = String(r).padStart(3, "0")
      const id = await ensureRoom(storeUuid, roomNo, sc.floor)
      rooms.push({ id, roomNo })
    }

    // 실장 3명
    const managers: StoreInfo["managers"] = []
    for (let m = 0; m < 3; m++) {
      const surname = MANAGER_SURNAMES[(si * 3 + m) % MANAGER_SURNAMES.length]
      const name = `${surname}실장${m + 1}_${sc.floor}${sc.label}`
      const email = `sim-mgr-${sc.floor}${sc.label.toLowerCase()}-${m + 1}@${SIM_EMAIL_DOMAIN}`
      const userId = await getOrCreateUser(email, name)
      const membershipId = await getOrCreateMembership(userId, storeUuid, "manager")
      await ensureManager(storeUuid, membershipId, name)
      managers.push({ membershipId, name, userId })
    }

    // 아가씨 20명 (실장별 P:H:S 분배)
    const hostesses: StoreInfo["hostesses"] = []
    for (const dist of HOSTESS_DISTRIBUTION) {
      const mgr = managers[dist.mgrIdx]
      const sequence: ("P" | "H" | "S")[] = [
        ...Array(dist.P).fill("P"),
        ...Array(dist.H).fill("H"),
        ...Array(dist.S).fill("S"),
      ]
      for (const cat of sequence) {
        const baseName = HOSTESS_NAMES[hostessNameIdx % HOSTESS_NAMES.length]
        const tag = String(Math.floor(hostessNameIdx / HOSTESS_NAMES.length) + 1).padStart(2, "0")
        const name = `${baseName}${tag}`
        const email = `sim-h-${sc.floor}${sc.label.toLowerCase()}-${hostessNameIdx + 1}@${SIM_EMAIL_DOMAIN}`
        hostessNameIdx++
        const userId = await getOrCreateUser(email, name)
        const membershipId = await getOrCreateMembership(userId, storeUuid, "hostess")
        await ensureHostess(storeUuid, membershipId, mgr.membershipId, name, cat)
        hostesses.push({ membershipId, name, category: cat, managerMembershipId: mgr.membershipId })
      }
    }

    seededStores.push({ storeUuid, storeName, floor: sc.floor, managers, hostesses, rooms })
  }
  log(`structure 완료: 매장 ${seededStores.length}, 실장 ${seededStores.length * 3}, 아가씨 ${seededStores.reduce((a, s) => a + s.hostesses.length, 0)}`)
}

// ─── 2단계: 하루치 세션 시뮬레이션 ──────────────────────
function pick<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)] }
function pickN<T>(arr: T[], n: number): T[] {
  const c = arr.slice()
  const out: T[] = []
  for (let i = 0; i < n && c.length > 0; i++) {
    const idx = Math.floor(Math.random() * c.length)
    out.push(c.splice(idx, 1)[0])
  }
  return out
}

async function seedSessions() {
  log("=== 2단계: 세션 시뮬레이션 ===")
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  let sessionCount = 0
  let participantCount = 0
  let finalizedCount = 0

  for (const store of seededStores) {
    const opener = store.managers[0]
    const bizDayId = await ensureBusinessDay(store.storeUuid, today, opener.userId)

    // 매장당 6개 세션 (룸 10개 중 60%)
    const targetSessions = 6
    const selectedRooms = pickN(store.rooms, targetSessions)
    for (let s = 0; s < selectedRooms.length; s++) {
      const room = selectedRooms[s]
      // 시작 시각: 20:00 ~ 02:00 (분산)
      const startHour = 20 + Math.floor(Math.random() * 6) // 20,21,22,23,0,1
      const startedAt = new Date()
      startedAt.setHours(startHour % 24, Math.floor(Math.random() * 60), 0, 0)
      if (startHour >= 24) startedAt.setDate(startedAt.getDate() + 1)

      const mgr = pick(store.managers)

      // 세션 INSERT — 일단 active 로 만들고 참여자 추가 후 closed 로 변경
      //   (트리거: closed 세션에 참여자 INSERT 차단)
      const { data: sessionRow, error: sErr } = await supabase
        .from("room_sessions")
        .insert({
          store_uuid: store.storeUuid,
          room_uuid: room.id,
          business_day_id: bizDayId,
          status: "active",
          opened_by: mgr.userId,
          manager_membership_id: mgr.membershipId,
          manager_name: mgr.name,
          is_external_manager: false,
          started_at: startedAt.toISOString(),
        })
        .select("id")
        .single()
      if (sErr || !sessionRow) {
        log(`  session 생성 실패 (${store.storeName} ${room.roomNo}):`, sErr?.message)
        continue
      }
      sessionCount++
      const willClose = s < 4 // 첫 4 세션은 정산까지

      // 참여자 1~3명 (manager 담당 아가씨 우선)
      const numParticipants = 1 + Math.floor(Math.random() * 3)
      const myHostesses = store.hostesses.filter((h) => h.managerMembershipId === mgr.membershipId)
      const chosen = pickN(myHostesses.length > 0 ? myHostesses : store.hostesses, numParticipants)

      for (const h of chosen) {
        const categoryName = CAT_NAME[h.category]
        const timeType = pick(["기본", "반티", "차3"] as const)
        const stEntry = SERVICE_TYPES.find((t) => t.service_type === categoryName && t.time_type === timeType)!
        const greeting = stEntry.has_greeting_check
        const managerDeduction = stEntry.manager_deduction
        const hostessPayout = Math.max(0, stEntry.price - managerDeduction)

        const { error: pErr } = await supabase.from("session_participants").insert({
          session_id: sessionRow.id,
          membership_id: h.membershipId,
          role: "hostess",
          category: categoryName,
          time_minutes: stEntry.time_minutes,
          price_amount: stEntry.price,
          manager_payout_amount: managerDeduction,
          hostess_payout_amount: hostessPayout,
          margin_amount: 0,
          cha3_amount: timeType === "차3" ? stEntry.price : 0,
          banti_amount: timeType === "반티" ? stEntry.price : 0,
          waiter_tip_received: false,
          waiter_tip_amount: 0,
          greeting_confirmed: greeting ? true : false,
          status: "active",
          store_uuid: store.storeUuid,
          entered_at: startedAt.toISOString(),
        })
        if (pErr) log(`    participant 실패: ${pErr.message}`)
        else participantCount++
      }

      // 첫 4 세션은 finalize (정산까지)
      if (willClose) {
        // 참여자 합산
        const { data: parts } = await supabase
          .from("session_participants")
          .select("price_amount, manager_payout_amount, hostess_payout_amount")
          .eq("session_id", sessionRow.id)
        const totals = (parts ?? []).reduce(
          (acc, p) => ({
            gross: acc.gross + (Number(p.price_amount) || 0),
            mgr: acc.mgr + (Number(p.manager_payout_amount) || 0),
            host: acc.host + (Number(p.hostess_payout_amount) || 0),
          }),
          { gross: 0, mgr: 0, host: 0 },
        )

        const { error: rErr } = await supabase.from("receipts").insert({
          store_uuid: store.storeUuid,
          session_id: sessionRow.id,
          business_day_id: bizDayId,
          status: "finalized",
          gross_total: totals.gross,
          order_total_amount: 0,
          participant_total_amount: totals.gross,
          tc_amount: totals.gross,
          manager_amount: totals.mgr,
          hostess_amount: totals.host,
          margin_amount: 0,
          card_fee_amount: 0,
          payment_method: pick(["cash", "card", "credit"]),
          finalized_at: new Date().toISOString(),
          finalized_by: mgr.userId,
        })
        if (rErr) log(`    receipt 실패: ${rErr.message}`)
        else finalizedCount++

        // 세션 closed 로 마감 (trigger 통과)
        await supabase
          .from("room_sessions")
          .update({
            status: "closed",
            ended_at: new Date(startedAt.getTime() + 90 * 60_000).toISOString(),
          })
          .eq("id", sessionRow.id)
      }
    }
    log(`  [${store.storeName}] 세션 ${targetSessions} (진행 ${targetSessions - 4}, 정산 4)`)
  }
  log(`sessions 완료: 세션 ${sessionCount}, 참여자 ${participantCount}, 정산 ${finalizedCount}`)
}

// ─── 3단계: 채팅 (14매장 글로벌 + 매장별) ────────────────
//   chat_rooms: name (not title), store_uuid, type, is_active
//   chat_participants: store_uuid 필요
//   chat_messages: store_uuid 필요
async function seedChat() {
  log("=== 3단계: 채팅 ===")

  // 글로벌 방의 store_uuid 는 첫 매장으로 (스키마가 NOT NULL 가능)
  const globalStoreUuid = seededStores[0].storeUuid
  let globalRoom: string | null = null
  {
    const { data: existing } = await supabase
      .from("chat_rooms")
      .select("id")
      .eq("type", "global")
      .eq("name", `${SIM_PREFIX} 14매장 실장방`)
      .maybeSingle()
    if (existing) globalRoom = existing.id
    else {
      const { data, error } = await supabase
        .from("chat_rooms")
        .insert({
          type: "global",
          name: `${SIM_PREFIX} 14매장 실장방`,
          store_uuid: globalStoreUuid,
          created_by: seededStores[0].managers[0].membershipId,
          is_active: true,
        })
        .select("id")
        .single()
      if (error) log(`  global chat_rooms 실패: ${error.message}`)
      else if (data) globalRoom = data.id
    }
  }

  let globalParticipants = 0
  if (globalRoom) {
    for (const store of seededStores) {
      for (const mgr of store.managers) {
        const { error } = await supabase
          .from("chat_participants")
          .upsert(
            {
              chat_room_id: globalRoom,
              membership_id: mgr.membershipId,
              store_uuid: store.storeUuid,
            },
            { onConflict: "chat_room_id,membership_id" },
          )
        if (!error) globalParticipants++
      }
    }
    const sampleMessages = [
      "오늘 분주합니다 다들 화이팅",
      "지유 셔츠 들어갔어요 — 신세계방으로",
      "단골손님 7층 → 5층 이동 예정",
      "지금 빈 룸 있는 매장? 보내드릴게요",
      "오늘 정산 후 톡 주세요",
    ]
    for (let i = 0; i < 5; i++) {
      const store = pick(seededStores)
      const mgr = pick(store.managers)
      await supabase.from("chat_messages").insert({
        chat_room_id: globalRoom,
        sender_membership_id: mgr.membershipId,
        store_uuid: store.storeUuid,
        content: sampleMessages[i],
        created_at: new Date(Date.now() - (5 - i) * 7 * 60_000).toISOString(),
      })
    }
  }

  let storeRoomCount = 0
  for (const store of seededStores) {
    const name = `${store.storeName} 실장방`
    const { data: existing } = await supabase
      .from("chat_rooms")
      .select("id")
      .eq("type", "group")
      .eq("name", name)
      .maybeSingle()
    let roomId = existing?.id ?? null
    if (!roomId) {
      const { data, error } = await supabase
        .from("chat_rooms")
        .insert({
          type: "group",
          name,
          store_uuid: store.storeUuid,
          created_by: store.managers[0].membershipId,
          is_active: true,
        })
        .select("id")
        .single()
      if (error) log(`  ${store.storeName} chat_rooms 실패: ${error.message}`)
      else if (data) roomId = data.id
    }
    if (!roomId) continue
    storeRoomCount++
    for (const mgr of store.managers) {
      await supabase
        .from("chat_participants")
        .upsert(
          { chat_room_id: roomId, membership_id: mgr.membershipId, store_uuid: store.storeUuid },
          { onConflict: "chat_room_id,membership_id" },
        )
    }
    const msgs = ["오늘 출근 명단 확인 부탁드려요", "방울 ↔ 7층 룸 변경 확인", "정산 마감 자정"]
    for (let i = 0; i < msgs.length; i++) {
      await supabase.from("chat_messages").insert({
        chat_room_id: roomId,
        sender_membership_id: store.managers[i % 3].membershipId,
        store_uuid: store.storeUuid,
        content: msgs[i],
        created_at: new Date(Date.now() - (3 - i) * 12 * 60_000).toISOString(),
      })
    }
  }
  log(`chat 완료: 글로벌 1 (참여 ${globalParticipants}) + 매장별 ${storeRoomCount}`)
}

// ─── Cleanup (재실행 전 정리) ──────────────────────────
async function cleanup() {
  log("=== CLEANUP — [시뮬] prefix 데이터 일괄 삭제 ===")
  // 1. 시뮬 매장의 store_uuid 수집
  const { data: stores } = await supabase
    .from("stores")
    .select("id")
    .like("store_name", `${SIM_PREFIX}%`)
  const storeIds = (stores ?? []).map((s) => s.id)
  log(`  시뮬 매장 ${storeIds.length}개`)

  if (storeIds.length > 0) {
    // 종속 데이터 — store_uuid 컬럼 있는 테이블들
    const tablesWithStoreUuid = [
      "receipts",
      "session_participants",
      "room_sessions",
      "store_operating_days",
      "rooms",
      "store_service_types",
      "hostesses",
      "managers",
      "chat_messages",
      "chat_participants",
      "chat_rooms",
      "store_memberships",
    ]
    for (const t of tablesWithStoreUuid) {
      const { error, count } = await supabase
        .from(t)
        .delete({ count: "exact" })
        .in("store_uuid", storeIds)
      if (error) log(`  [${t}] 삭제 실패:`, error.message)
      else log(`  [${t}] ${count ?? 0} 삭제`)
    }
    // stores 자체는 id 기준
    const { error, count } = await supabase.from("stores").delete({ count: "exact" }).in("id", storeIds)
    if (error) log(`  [stores] 삭제 실패:`, error.message)
    else log(`  [stores] ${count ?? 0} 삭제`)
  }

  // 시뮬 이메일 사용자 일괄 정리
  const usersToDelete: string[] = []
  let page = 1
  while (true) {
    const { data } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (!data?.users?.length) break
    for (const u of data.users) {
      if (u.email?.endsWith(`@${SIM_EMAIL_DOMAIN}`)) usersToDelete.push(u.id)
    }
    if (data.users.length < 1000) break
    page++
  }
  log(`  시뮬 user ${usersToDelete.length}개 삭제 예정`)
  for (const uid of usersToDelete) {
    try {
      await supabase.from("profiles").delete().eq("id", uid)
      await supabase.auth.admin.deleteUser(uid)
    } catch {
      /* skip */
    }
  }
  log("cleanup 완료")
}

// ─── 메인 ───────────────────────────────────────────────
async function main() {
  if (process.env.SIM_CLEANUP === "1") {
    await cleanup()
    return
  }
  await seedStructure()
  await seedSessions()
  await seedChat()
  log("=== 완료 ===")
  log(`매장 14, 실장 42, 아가씨 280 + 하루치 세션/정산/채팅 시드됨.`)
  log(`로그인: sim-mgr-5A-1@${SIM_EMAIL_DOMAIN} / ${PASSWORD} (예시)`)
}

main().catch((e) => {
  console.error("[seed-simulation] FATAL:", e)
  process.exit(1)
})
