/**
 * 마블 — 오늘 영업일에 추가 세션 시드.
 *
 * 목표:
 *   - 10명 아가씨 × 각 ~6 timeshift = ~60 슬롯
 *   - 슬롯/3 = ~20 세션
 *   - 룸 8개 → 룸당 ~2.5 세션 (순차)
 *   - 종목/시간 랜덤 (퍼블릭/셔츠/하퍼 × 기본/반티/차3)
 *   - 모두 finalize, 12시간 (18:00 ~ 06:00) 분산
 *   - 각 hostess 가 최소 5번 이상 참여하도록 라운드로빈
 *
 * 멱등: 오늘 영업일 세션이 20개 이상이면 skip.
 */
import { createClient } from "@supabase/supabase-js"

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
if (!URL || !KEY) { console.error("env"); process.exit(1) }
const sb = createClient(URL, KEY, { auth: { persistSession: false } })
const log = (...a: unknown[]) => console.log("[marvel-d]", ...a)

const MARVEL_ID = "ad1b95f0-5023-4c93-9282-efbb3d94ce76"
const JOJUNSEONG_MGR_MID = "6dd62734-9327-4e82-b3dc-b24ffb808a82"
const TARGET_SESSIONS = 20
const HOSTESSES_PER_SESSION = 3
const TODAY = new Date().toISOString().slice(0, 10)

function pick<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)] }
function pickWeighted<T extends string>(opts: ReadonlyArray<{ t: T; w: number }>): T {
  const total = opts.reduce((a, o) => a + o.w, 0)
  let r = Math.random() * total
  for (const o of opts) { r -= o.w; if (r <= 0) return o.t }
  return opts[0].t
}

const TIME_WEIGHTS = [
  { t: "기본" as const, w: 6 },
  { t: "반티" as const, w: 3 },
  { t: "차3" as const, w: 1 },
]
function pickServiceType(category: string | null): "퍼블릭" | "셔츠" | "하퍼" {
  if (category === "퍼블릭" || category === "셔츠" || category === "하퍼") return category
  return pickWeighted([
    { t: "퍼블릭" as const, w: 5 },
    { t: "셔츠" as const, w: 3 },
    { t: "하퍼" as const, w: 2 },
  ])
}

async function main() {
  // 마블 매니저 user_id (조준성)
  const { data: mgr } = await sb
    .from("store_memberships")
    .select("id, profile_id")
    .eq("id", JOJUNSEONG_MGR_MID)
    .single()
  if (!mgr?.profile_id) throw new Error("조준성 매니저 user_id 없음")
  const managerUserId = mgr.profile_id

  // 영업일
  const { data: bizDay } = await sb
    .from("store_operating_days")
    .select("id")
    .eq("store_uuid", MARVEL_ID)
    .eq("business_date", TODAY)
    .maybeSingle()
  if (!bizDay) throw new Error("오늘 영업일 없음")
  const bizDayId = bizDay.id

  // 현재 세션 수
  const { count } = await sb
    .from("room_sessions")
    .select("id", { count: "exact", head: true })
    .eq("store_uuid", MARVEL_ID)
    .eq("business_day_id", bizDayId)
  const existing = count ?? 0
  log(`현재 세션 ${existing} / 목표 ${TARGET_SESSIONS}`)
  if (existing >= TARGET_SESSIONS) { log("skip — 목표 도달"); return }
  const need = TARGET_SESSIONS - existing

  // 룸 + 종목단가 + 조준성 매니저의 hostesses
  const [roomsRes, stRes, hRes] = await Promise.all([
    sb.from("rooms").select("id, room_no").eq("store_uuid", MARVEL_ID).eq("is_active", true),
    sb.from("store_service_types").select("service_type, time_type, time_minutes, price, manager_deduction, has_greeting_check").eq("store_uuid", MARVEL_ID),
    sb.from("hostesses").select("membership_id, name, category, manager_membership_id").eq("store_uuid", MARVEL_ID).eq("manager_membership_id", JOJUNSEONG_MGR_MID).eq("is_active", true).is("deleted_at", null),
  ])
  const rooms = (roomsRes.data ?? []) as Array<{ id: string; room_no: string }>
  const serviceTypes = (stRes.data ?? []) as Array<{ service_type: string; time_type: string; time_minutes: number; price: number; manager_deduction: number; has_greeting_check: boolean }>
  const hostesses = (hRes.data ?? []) as Array<{ membership_id: string; name: string; category: string | null }>

  log(`rooms ${rooms.length}, services ${serviceTypes.length}, hostesses ${hostesses.length}`)
  if (rooms.length === 0 || serviceTypes.length === 0 || hostesses.length === 0) { log("부족 — skip"); return }

  // 라운드로빈: hostess 별 사용 카운터로 가장 적게 사용된 사람부터 선택
  const useCount = new Map<string, number>()
  for (const h of hostesses) useCount.set(h.membership_id, 0)

  function pickHostessRR(n: number): typeof hostesses {
    const sorted = [...hostesses].sort((a, b) => (useCount.get(a.membership_id) ?? 0) - (useCount.get(b.membership_id) ?? 0))
    // 동률 일 때 랜덤하게 — 같은 사용횟수 그룹 안에서 shuffle
    const groups = new Map<number, typeof hostesses>()
    for (const h of sorted) {
      const c = useCount.get(h.membership_id) ?? 0
      if (!groups.has(c)) groups.set(c, [])
      groups.get(c)!.push(h)
    }
    const out: typeof hostesses = []
    const groupKeys = [...groups.keys()].sort((a, b) => a - b)
    for (const k of groupKeys) {
      const g = [...groups.get(k)!]
      // 랜덤 shuffle 후 추가
      for (let i = g.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[g[i], g[j]] = [g[j], g[i]]
      }
      for (const h of g) {
        if (out.length >= n) break
        out.push(h)
      }
      if (out.length >= n) break
    }
    return out
  }

  // 18:00 ~ 06:00 (12h) — 20세션 → 36분 간격
  const base = new Date(); base.setHours(18, 0, 0, 0)

  let added = 0
  let participantsAdded = 0
  let totalGross = 0
  for (let i = 0; i < need; i++) {
    const idx = existing + i
    const startedAt = new Date(base.getTime() + (idx * 36 + Math.floor(Math.random() * 30)) * 60_000)
    const room = rooms[idx % rooms.length]

    const { data: sess, error: sErr } = await sb
      .from("room_sessions")
      .insert({
        store_uuid: MARVEL_ID,
        room_uuid: room.id,
        business_day_id: bizDayId,
        status: "active",
        opened_by: managerUserId,
        manager_membership_id: JOJUNSEONG_MGR_MID,
        manager_name: "조준성",
        is_external_manager: false,
        started_at: startedAt.toISOString(),
      })
      .select("id")
      .single()
    if (sErr || !sess) { log(`  session #${idx + 1} (room ${room.room_no}): ${sErr?.message}`); continue }

    const chosen = pickHostessRR(HOSTESSES_PER_SESSION)
    let sg = 0, sm = 0, sh = 0
    for (const h of chosen) {
      const stype = pickServiceType(h.category)
      const ttype = pickWeighted(TIME_WEIGHTS)
      const st = serviceTypes.find((s) => s.service_type === stype && s.time_type === ttype)
      if (!st) continue
      // 실장수익 — 차3 은 0, 그 외 60% 5천 / 30% 1만 / 10% 0
      let mgrDed = 0
      if (ttype !== "차3") {
        const r = Math.random()
        mgrDed = r < 0.6 ? 5000 : r < 0.9 ? 10000 : 0
      }
      const hostessPayout = Math.max(0, st.price - mgrDed)

      const { error } = await sb.from("session_participants").insert({
        session_id: sess.id,
        membership_id: h.membership_id,
        manager_membership_id: JOJUNSEONG_MGR_MID,
        role: "hostess",
        category: stype,
        time_minutes: st.time_minutes,
        price_amount: st.price,
        manager_payout_amount: mgrDed,
        hostess_payout_amount: hostessPayout,
        margin_amount: 0,
        cha3_amount: ttype === "차3" ? st.price : 0,
        banti_amount: ttype === "반티" ? st.price : 0,
        waiter_tip_received: false,
        waiter_tip_amount: 0,
        greeting_confirmed: st.has_greeting_check ? true : false,
        status: "active",
        store_uuid: MARVEL_ID,
        entered_at: startedAt.toISOString(),
      })
      if (!error) {
        participantsAdded++
        useCount.set(h.membership_id, (useCount.get(h.membership_id) ?? 0) + 1)
        sg += st.price; sm += mgrDed; sh += hostessPayout
      }
    }

    if (sg > 0) {
      await sb.from("receipts").insert({
        store_uuid: MARVEL_ID,
        session_id: sess.id,
        business_day_id: bizDayId,
        status: "finalized",
        gross_total: sg,
        tc_amount: sg,
        order_total_amount: 0,
        participant_total_amount: sg,
        manager_amount: sm,
        hostess_amount: sh,
        margin_amount: 0,
        card_fee_amount: 0,
        discount_amount: 0,
        service_amount: 0,
        payment_method: pick(["cash", "card", "credit"]),
        finalized_at: new Date().toISOString(),
        finalized_by: managerUserId,
      })
      await sb.from("room_sessions").update({ status: "closed", ended_at: new Date(startedAt.getTime() + 90 * 60_000).toISOString() }).eq("id", sess.id)
      totalGross += sg
      added++
    }
  }

  log("=== 시드 결과 ===")
  log(`세션 ${added} 추가, 참여자 ${participantsAdded}, 매출 ${totalGross.toLocaleString()}원`)
  log("=== hostess 별 timeshift 분포 ===")
  for (const h of hostesses) {
    log(`  ${h.name} (${h.category ?? "?"}) : ${useCount.get(h.membership_id)} 타임`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
