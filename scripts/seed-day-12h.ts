/**
 * 12시간 영업 시뮬레이션 시드 (실 운영 모방)
 *
 *   대상: 5~8F 활성 매장 (시뮬/실 둘 다)
 *   생성:
 *     - 매장당 6 세션 (= 손님 6팀)
 *     - 각 세션 3 hostess 참여자 (= 3명 응대)
 *     - 종목 (퍼블릭/셔츠/하퍼) + 시간타입 (기본/반티/차3) 랜덤
 *     - 18:00 ~ 06:00 12시간 분산
 *     - 모두 finalize (receipt status='finalized')
 *
 *   부가 작업:
 *     - hostess.manager_membership_id 가 NULL 이면 매장 첫 매니저로 자동 배정
 *       (e.g. 마블 박미리/김미리 → 조준성 매니저)
 *     - 매장에 매니저/hostess 가 없으면 skip
 *     - store_service_types 없으면 skip (단가 모름)
 *
 *   멱등: 같은 business_day_id 에 이미 6세션 이상 있으면 skip.
 *
 *   실행:
 *     SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=...   \
 *       npx tsx scripts/seed-day-12h.ts
 *
 *   특정 매장만:
 *     ONLY_STORES=marvel,라이브  npx tsx scripts/seed-day-12h.ts
 */
import { createClient } from "@supabase/supabase-js"

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
if (!URL || !KEY) {
  console.error("[seed-day-12h] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요")
  process.exit(1)
}

const sb = createClient(URL, KEY, { auth: { persistSession: false } })
const log = (...a: unknown[]) => console.log("[12h]", ...a)

// 매장 필터 — ONLY_STORES=marvel,라이브 면 매장명 부분일치
const onlyFilter = (process.env.ONLY_STORES ?? "").split(",").map((s) => s.trim()).filter(Boolean)

const SESSIONS_PER_STORE = 6
const HOSTESSES_PER_SESSION = 3
const TIME_TYPE_WEIGHTS = [
  { t: "기본", w: 6 }, // 60%
  { t: "반티", w: 3 }, // 30%
  { t: "차3", w: 1 }, // 10%
] as const
const STATUS_FINALIZE = true

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}
function pickN<T>(arr: T[], n: number): T[] {
  const c = arr.slice()
  const out: T[] = []
  for (let i = 0; i < n && c.length > 0; i++) {
    out.push(c.splice(Math.floor(Math.random() * c.length), 1)[0])
  }
  return out
}
function pickWeighted<T extends string>(opts: ReadonlyArray<{ t: T; w: number }>): T {
  const total = opts.reduce((a, o) => a + o.w, 0)
  let r = Math.random() * total
  for (const o of opts) {
    r -= o.w
    if (r <= 0) return o.t
  }
  return opts[0].t
}

// hostess 의 category 가 있으면 그걸로, 없으면 랜덤
function pickServiceType(hostessCategory?: string | null): "퍼블릭" | "셔츠" | "하퍼" {
  if (hostessCategory === "퍼블릭" || hostessCategory === "셔츠" || hostessCategory === "하퍼") {
    return hostessCategory
  }
  // 50% 퍼블릭, 30% 셔츠, 20% 하퍼
  return pickWeighted([
    { t: "퍼블릭", w: 5 },
    { t: "셔츠", w: 3 },
    { t: "하퍼", w: 2 },
  ] as const)
}

type Store = { id: string; store_name: string; floor: number | null }
type Manager = { membership_id: string; user_id: string; name: string }
type Hostess = {
  membership_id: string
  name: string
  manager_membership_id: string | null
  category: string | null
}
type Room = { id: string; room_no: string }
type ServiceType = {
  service_type: string
  time_type: string
  time_minutes: number
  price: number
  manager_deduction: number
  has_greeting_check: boolean
}

async function loadStores(): Promise<Store[]> {
  const { data, error } = await sb
    .from("stores")
    .select("id, store_name, floor")
    .eq("is_active", true)
    .gte("floor", 5)
    .lte("floor", 8)
    .order("floor", { ascending: true })
    .order("store_name", { ascending: true })
  if (error) throw new Error(`stores: ${error.message}`)
  const all = (data ?? []) as Store[]
  if (onlyFilter.length === 0) return all
  return all.filter((s) => onlyFilter.some((f) => s.store_name.includes(f)))
}

async function loadManagers(storeUuid: string): Promise<Manager[]> {
  // role=manager + approved + 프로필 join
  const { data, error } = await sb
    .from("store_memberships")
    .select("id, profile_id, profiles!store_memberships_profile_id_fkey(full_name)")
    .eq("store_uuid", storeUuid)
    .eq("role", "manager")
    .eq("status", "approved")
  if (error) throw new Error(`managers: ${error.message}`)
  type Row = { id: string; profile_id: string | null; profiles: { full_name: string } | { full_name: string }[] | null }
  return ((data ?? []) as Row[]).map((r) => {
    const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles
    return {
      membership_id: r.id,
      user_id: r.profile_id ?? "",
      name: p?.full_name ?? "?",
    }
  }).filter((m) => m.user_id)
}

async function loadHostesses(storeUuid: string): Promise<Hostess[]> {
  const { data, error } = await sb
    .from("hostesses")
    .select("membership_id, name, manager_membership_id, category, is_active")
    .eq("store_uuid", storeUuid)
    .eq("is_active", true)
    .is("deleted_at", null)
  if (error) throw new Error(`hostesses: ${error.message}`)
  return ((data ?? []) as Hostess[]).filter((h) => !!h.membership_id)
}

async function loadRooms(storeUuid: string): Promise<Room[]> {
  const { data, error } = await sb
    .from("rooms")
    .select("id, room_no, is_active")
    .eq("store_uuid", storeUuid)
    .eq("is_active", true)
    .order("room_no", { ascending: true })
  if (error) throw new Error(`rooms: ${error.message}`)
  return ((data ?? []) as Room[])
}

async function loadServiceTypes(storeUuid: string): Promise<ServiceType[]> {
  const { data, error } = await sb
    .from("store_service_types")
    .select("service_type, time_type, time_minutes, price, manager_deduction, has_greeting_check")
    .eq("store_uuid", storeUuid)
  if (error) throw new Error(`service_types: ${error.message}`)
  return (data ?? []) as ServiceType[]
}

async function ensureManagerAssignment(storeUuid: string, hostesses: Hostess[], firstManagerMembershipId: string) {
  const unassigned = hostesses.filter((h) => !h.manager_membership_id)
  if (unassigned.length === 0) return
  log(`  [auto-assign] ${unassigned.length} hostess → manager ${firstManagerMembershipId.slice(0, 8)}`)
  const ids = unassigned.map((h) => h.membership_id)
  const { error } = await sb
    .from("hostesses")
    .update({ manager_membership_id: firstManagerMembershipId })
    .eq("store_uuid", storeUuid)
    .in("membership_id", ids)
  if (error) log(`  [auto-assign] 실패: ${error.message}`)
  else hostesses.forEach((h) => { if (ids.includes(h.membership_id)) h.manager_membership_id = firstManagerMembershipId })
}

async function ensureBusinessDay(storeUuid: string, dateISO: string, opener: string): Promise<string | null> {
  const { data: existing } = await sb
    .from("store_operating_days")
    .select("id, status")
    .eq("store_uuid", storeUuid)
    .eq("business_date", dateISO)
    .maybeSingle()
  if (existing) {
    if (existing.status === "closed") {
      await sb
        .from("store_operating_days")
        .update({ status: "open", closed_at: null, closed_by: null })
        .eq("id", existing.id)
    }
    return existing.id
  }
  const { data, error } = await sb
    .from("store_operating_days")
    .insert({ store_uuid: storeUuid, business_date: dateISO, status: "open", opened_by: opener })
    .select("id")
    .single()
  if (error || !data) {
    log(`  bizDay 생성 실패: ${error?.message}`)
    return null
  }
  return data.id
}

async function countSessionsToday(storeUuid: string, bizDayId: string): Promise<number> {
  const { count } = await sb
    .from("room_sessions")
    .select("id", { count: "exact", head: true })
    .eq("store_uuid", storeUuid)
    .eq("business_day_id", bizDayId)
  return count ?? 0
}

type SeededCount = {
  sessions: number
  participants: number
  finalized: number
  totalGross: number
}

async function seedStore(store: Store): Promise<SeededCount | null> {
  const result: SeededCount = { sessions: 0, participants: 0, finalized: 0, totalGross: 0 }
  log(`[${store.floor}F ${store.store_name}]`)

  const [managers, hostesses, rooms, serviceTypes] = await Promise.all([
    loadManagers(store.id),
    loadHostesses(store.id),
    loadRooms(store.id),
    loadServiceTypes(store.id),
  ])

  if (managers.length === 0) { log(`  skip — manager 0`); return null }
  if (hostesses.length === 0) { log(`  skip — hostess 0`); return null }
  if (rooms.length === 0) { log(`  skip — room 0`); return null }
  if (serviceTypes.length === 0) { log(`  skip — service_types 0`); return null }

  await ensureManagerAssignment(store.id, hostesses, managers[0].membership_id)

  const today = new Date().toISOString().slice(0, 10)
  const opener = managers[0].user_id
  const bizDayId = await ensureBusinessDay(store.id, today, opener)
  if (!bizDayId) return null

  // 멱등 — 이미 6 세션 이상 있으면 skip
  const existing = await countSessionsToday(store.id, bizDayId)
  if (existing >= SESSIONS_PER_STORE) {
    log(`  skip — already ${existing} sessions today`)
    return null
  }

  // 6 세션 × 3 참여자 = 18 slot. 가능하면 hostesses 골고루.
  const needCount = SESSIONS_PER_STORE - existing
  const targetRooms = pickN(rooms, needCount)
  if (targetRooms.length < needCount) {
    log(`  skip — only ${targetRooms.length} active rooms < ${needCount}`)
    return null
  }

  // 12시간 분산 — 오늘 18:00 ~ 다음날 06:00 사이로 6슬롯
  // 인덱스 i (0..5) → start = 18:00 + (i * 2h) + 랜덤 0..50분
  const base = new Date()
  base.setHours(18, 0, 0, 0)

  for (let i = 0; i < needCount; i++) {
    const room = targetRooms[i]
    const mgr = pick(managers)

    const startedAt = new Date(base.getTime() + (i * 120 + Math.floor(Math.random() * 50)) * 60_000)

    // 세션 INSERT
    const { data: sessionRow, error: sErr } = await sb
      .from("room_sessions")
      .insert({
        store_uuid: store.id,
        room_uuid: room.id,
        business_day_id: bizDayId,
        status: "active",
        opened_by: mgr.user_id,
        manager_membership_id: mgr.membership_id,
        manager_name: mgr.name,
        is_external_manager: false,
        started_at: startedAt.toISOString(),
      })
      .select("id")
      .single()
    if (sErr || !sessionRow) {
      log(`  session ${room.room_no} INSERT 실패: ${sErr?.message}`)
      continue
    }
    result.sessions++

    // 3 참여자 — 매니저 담당 hostess 우선, 부족하면 매장 전체
    const myHostesses = hostesses.filter((h) => h.manager_membership_id === mgr.membership_id)
    const candidates = myHostesses.length >= HOSTESSES_PER_SESSION ? myHostesses : hostesses
    const chosen = pickN(candidates, Math.min(HOSTESSES_PER_SESSION, candidates.length))

    let sessionGross = 0
    let sessionMgrTotal = 0
    let sessionHostTotal = 0

    for (const h of chosen) {
      const serviceType = pickServiceType(h.category)
      const timeType = pickWeighted(TIME_TYPE_WEIGHTS)
      const st = serviceTypes.find((s) => s.service_type === serviceType && s.time_type === timeType)
      if (!st) {
        log(`    skip participant — service_type ${serviceType}/${timeType} 없음`)
        continue
      }
      const hostessPayout = Math.max(0, st.price - st.manager_deduction)

      const { error: pErr } = await sb.from("session_participants").insert({
        session_id: sessionRow.id,
        membership_id: h.membership_id,
        role: "hostess",
        category: serviceType,
        time_minutes: st.time_minutes,
        price_amount: st.price,
        manager_payout_amount: st.manager_deduction,
        hostess_payout_amount: hostessPayout,
        margin_amount: 0,
        cha3_amount: timeType === "차3" ? st.price : 0,
        banti_amount: timeType === "반티" ? st.price : 0,
        waiter_tip_received: false,
        waiter_tip_amount: 0,
        greeting_confirmed: st.has_greeting_check ? true : false,
        status: "active",
        store_uuid: store.id,
        entered_at: startedAt.toISOString(),
      })
      if (pErr) {
        log(`    participant 실패 (${h.name}): ${pErr.message}`)
        continue
      }
      result.participants++
      sessionGross += st.price
      sessionMgrTotal += st.manager_deduction
      sessionHostTotal += hostessPayout
    }

    // Finalize
    if (STATUS_FINALIZE && sessionGross > 0) {
      const { error: rErr } = await sb.from("receipts").insert({
        store_uuid: store.id,
        session_id: sessionRow.id,
        business_day_id: bizDayId,
        status: "finalized",
        gross_total: sessionGross,
        tc_amount: sessionGross,
        order_total_amount: 0,
        participant_total_amount: sessionGross,
        manager_amount: sessionMgrTotal,
        hostess_amount: sessionHostTotal,
        margin_amount: 0,
        card_fee_amount: 0,
        discount_amount: 0,
        service_amount: 0,
        payment_method: pick(["cash", "card", "credit"]),
        finalized_at: new Date().toISOString(),
        finalized_by: mgr.user_id,
      })
      if (rErr) log(`    receipt 실패: ${rErr.message}`)
      else {
        result.finalized++
        result.totalGross += sessionGross
      }

      await sb
        .from("room_sessions")
        .update({
          status: "closed",
          ended_at: new Date(startedAt.getTime() + 90 * 60_000).toISOString(),
        })
        .eq("id", sessionRow.id)
    }
  }

  log(
    `  세션 ${result.sessions} · 참여 ${result.participants} · 정산 ${result.finalized} · 총매출 ${result.totalGross.toLocaleString()}원`,
  )
  return result
}

async function main() {
  log("=== 12시간 영업 시뮬레이션 시작 ===")
  const stores = await loadStores()
  log(`대상 매장 ${stores.length}개${onlyFilter.length > 0 ? ` (필터: ${onlyFilter.join(", ")})` : ""}`)
  const totals = { stores: 0, sessions: 0, participants: 0, finalized: 0, gross: 0 }
  for (const s of stores) {
    const r = await seedStore(s)
    if (!r) continue
    totals.stores++
    totals.sessions += r.sessions
    totals.participants += r.participants
    totals.finalized += r.finalized
    totals.gross += r.totalGross
  }
  log("=== 완료 ===")
  log(
    `매장 ${totals.stores} · 세션 ${totals.sessions} · 참여 ${totals.participants} · 정산 ${totals.finalized} · 총매출 ${totals.gross.toLocaleString()}원`,
  )
}

main().catch((e) => {
  console.error("[seed-day-12h] FATAL:", e)
  process.exit(1)
})
