/**
 * GET /api/manager/staff-detail/[hostess_id]
 *
 * 스태프의 오늘 세션별 상세 + 매장별/종목별 집계.
 *   - 세션마다: 매장 · 방 · 종목 · 시간 · 매출 · 실장공제 · 아가씨지급 · 상태
 *   - 매장별 합계 (예: "아우라 6타임", "신세계 1타임")
 *   - 종목별 합계 (예: "셔츠 2, 퍼블릭 3, 하퍼 1")
 *   - 시간당 실장공제 rate 저장/조회 (staff_payout_states)
 *
 * PATCH /api/manager/staff-detail/[hostess_id]
 *   body:
 *     - deduction_per_hour?: 시간당 공제 (원). 전 세션에 일괄 적용.
 *     - overrides?: [{ participant_id, manager_payout_amount }]  세션별 override
 *   응답: 재계산된 세션 리스트 + 합계.
 *
 * 권한: owner / manager / super_admin.
 * R-staff-detail (2026-07-19).
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"
import { getBusinessDateForOps } from "@/lib/time/businessDate"

type SessionRow = {
  participant_id: string
  session_id: string
  store_uuid: string
  store_name: string | null
  origin_store_uuid: string | null
  origin_store_name: string | null
  room_no: string | null
  category: string | null
  time_minutes: number | null
  price_amount: number
  manager_payout_amount: number
  hostess_payout_amount: number
  status: string
  entered_at: string | null
  left_at: string | null
  is_expected_price: boolean
  expected_price: number | null
}

async function resolveBusinessDayId(
  supabase: ReturnType<typeof getServiceClient>,
  storeUuid: string,
): Promise<string | null> {
  const today = getBusinessDateForOps()
  let { data: bd } = await supabase
    .from("store_operating_days")
    .select("id")
    .eq("store_uuid", storeUuid)
    .eq("business_date", today)
    .maybeSingle()
  if (!bd) {
    const { data: latest } = await supabase
      .from("store_operating_days")
      .select("id")
      .eq("store_uuid", storeUuid)
      .eq("status", "open")
      .order("business_date", { ascending: false })
      .limit(1)
      .maybeSingle()
    bd = latest
  }
  return (bd as { id: string } | null)?.id ?? null
}

async function loadRows(
  supabase: ReturnType<typeof getServiceClient>,
  storeUuid: string,
  hostessMid: string,
  bid: string,
): Promise<SessionRow[]> {

  // 이 스태프가 참여한 세션 (origin=본매장 OR store=본매장)
  //   본 매장 소속인 경우: origin_store_uuid=본매장 (다른 매장에서 일해도 정산은 여기)
  //   그날 본 매장에서 일한 참여자만 필터 (business_day_id)
  // 오늘 영업일의 sessions 만
  const { data: sessions } = await supabase
    .from("room_sessions")
    .select("id, store_uuid, room_uuid, business_day_id")
    .eq("business_day_id", bid)
  const sessIds = ((sessions ?? []) as Array<{ id: string }>).map((s) => s.id)
  if (sessIds.length === 0) return []

  // 해당 스태프 참여 (본 매장 origin)
  const { data: parts } = await supabase
    .from("session_participants")
    .select(
      "id, session_id, store_uuid, origin_store_uuid, category, time_minutes, price_amount, manager_payout_amount, hostess_payout_amount, status, entered_at, left_at",
    )
    .eq("membership_id", hostessMid)
    .in("session_id", sessIds)
    .is("deleted_at", null)

  const rows = (parts ?? []) as Array<{
    id: string
    session_id: string
    store_uuid: string
    origin_store_uuid: string | null
    category: string | null
    time_minutes: number | null
    price_amount: number | null
    manager_payout_amount: number | null
    hostess_payout_amount: number | null
    status: string
    entered_at: string | null
    left_at: string | null
  }>
  if (rows.length === 0) return []

  // 매장 이름 매핑
  const storeIds = new Set<string>()
  for (const r of rows) {
    storeIds.add(r.store_uuid)
    if (r.origin_store_uuid) storeIds.add(r.origin_store_uuid)
  }
  const { data: st } = await supabase
    .from("stores")
    .select("id, store_name")
    .in("id", [...storeIds])
  const nameByUuid = new Map<string, string>()
  for (const s of ((st ?? []) as Array<{ id: string; store_name: string }>)) {
    nameByUuid.set(s.id, s.store_name)
  }

  // 방 번호 매핑
  const sessMap = new Map<string, { store_uuid: string; room_uuid: string }>()
  for (const s of ((sessions ?? []) as Array<{ id: string; store_uuid: string; room_uuid: string }>)) {
    sessMap.set(s.id, { store_uuid: s.store_uuid, room_uuid: s.room_uuid })
  }
  const roomIds = [...new Set([...sessMap.values()].map((s) => s.room_uuid))]
  const { data: rooms } = await supabase
    .from("rooms")
    .select("id, room_no")
    .in("id", roomIds)
  const roomNoByUuid = new Map<string, string>()
  for (const r of ((rooms ?? []) as Array<{ id: string; room_no: string }>)) {
    roomNoByUuid.set(r.id, r.room_no)
  }

  // 종목별 예상 단가 (store_service_types) — 매장별로 다름
  const { data: srvTypes } = await supabase
    .from("store_service_types")
    .select("store_uuid, service_type, time_type, price, time_minutes")
    .in("store_uuid", [...storeIds])
  type Srv = { store_uuid: string; service_type: string; time_type: string; price: number; time_minutes: number }
  const srvMap = new Map<string, number>() // key: store_uuid|service_type|time_minutes → price
  for (const s of ((srvTypes ?? []) as Srv[])) {
    srvMap.set(`${s.store_uuid}|${s.service_type}|${s.time_minutes}`, Number(s.price))
  }

  return rows.map((r) => {
    const sess = sessMap.get(r.session_id)
    const workStoreUuid = r.store_uuid
    const originStoreUuid = r.origin_store_uuid ?? r.store_uuid
    const price = Number(r.price_amount ?? 0)
    // 예상 단가 조회
    const cat = r.category ?? ""
    const tm = r.time_minutes ?? 0
    const expected = srvMap.get(`${workStoreUuid}|${cat}|${tm}`) ?? null
    const isMismatch = expected != null && expected !== price
    return {
      participant_id: r.id,
      session_id: r.session_id,
      store_uuid: workStoreUuid,
      store_name: nameByUuid.get(workStoreUuid) ?? null,
      origin_store_uuid: originStoreUuid,
      origin_store_name: nameByUuid.get(originStoreUuid) ?? null,
      room_no: sess ? roomNoByUuid.get(sess.room_uuid) ?? null : null,
      category: r.category,
      time_minutes: r.time_minutes,
      price_amount: price,
      manager_payout_amount: Number(r.manager_payout_amount ?? 0),
      hostess_payout_amount: Number(r.hostess_payout_amount ?? 0),
      status: r.status,
      entered_at: r.entered_at,
      left_at: r.left_at,
      is_expected_price: !isMismatch,
      expected_price: expected,
    }
  })
}

function buildSummary(rows: SessionRow[]) {
  const byStore = new Map<string, { store_name: string; count: number; categories: Record<string, number> }>()
  const byCategory = new Map<string, number>()
  let totalGross = 0
  let totalManagerDeduction = 0
  let totalHostessPayout = 0
  let totalTimeMin = 0

  for (const r of rows) {
    const key = r.store_name ?? "?"
    const bs = byStore.get(key) ?? { store_name: key, count: 0, categories: {} }
    bs.count += 1
    const cat = r.category ?? "?"
    bs.categories[cat] = (bs.categories[cat] ?? 0) + 1
    byStore.set(key, bs)

    byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1)
    totalGross += r.price_amount
    totalManagerDeduction += r.manager_payout_amount
    totalHostessPayout += r.hostess_payout_amount
    totalTimeMin += r.time_minutes ?? 0
  }

  return {
    total_gross: totalGross,
    total_manager_deduction: totalManagerDeduction,
    total_hostess_payout: totalHostessPayout,
    total_time_minutes: totalTimeMin,
    total_count: rows.length,
    by_store: [...byStore.values()].map((s) => ({
      store_name: s.store_name,
      count: s.count,
      categories: s.categories,
      display: `${s.store_name} ${s.count} (${Object.entries(s.categories)
        .map(([c, n]) => `${c} ${n}`)
        .join(", ")})`,
    })),
    by_category: Object.fromEntries(byCategory),
    warnings: rows
      .filter((r) => !r.is_expected_price)
      .map((r) => ({
        participant_id: r.participant_id,
        message: `매출 불일치: 실제 ${r.price_amount.toLocaleString()}원 · 예상 ${r.expected_price?.toLocaleString() ?? "?"}원 (${r.store_name} · ${r.category} · ${r.time_minutes}분)`,
      })),
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ hostess_id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    if (!["owner", "manager"].includes(auth.role) && !auth.is_super_admin) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const { hostess_id } = await params
    if (!hostess_id || !isValidUUID(hostess_id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    const supabase = getServiceClient()
    const bid = await resolveBusinessDayId(supabase, auth.store_uuid)
    if (!bid) {
      return NextResponse.json({
        sessions: [],
        summary: buildSummary([]),
        deduction_per_hour: 10000,
      })
    }
    const rows = await loadRows(supabase, auth.store_uuid, hostess_id, bid)
    const summary = buildSummary(rows)
    // 저장된 시간당 공제 (staff_payout_states.memo 확장 사용, 오늘 영업일 scope)
    const { data: payoutState } = await supabase
      .from("staff_payout_states")
      .select("memo")
      .eq("store_uuid", auth.store_uuid)
      .eq("business_day_id", bid)
      .eq("hostess_membership_id", hostess_id)
      .is("deleted_at", null)
      .maybeSingle()
    let deductionPerHour: number | null = null
    try {
      const memo = (payoutState as { memo: string | null } | null)?.memo
      if (memo) {
        const parsed = JSON.parse(memo)
        if (typeof parsed.deduction_per_hour === "number") {
          deductionPerHour = parsed.deduction_per_hour
        }
      }
    } catch { /* memo 는 자유 텍스트 */ }
    return NextResponse.json({
      sessions: rows,
      summary,
      deduction_per_hour: deductionPerHour ?? 10000, // 기본 1만/시간
    })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ hostess_id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    if (!["owner", "manager"].includes(auth.role) && !auth.is_super_admin) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const { hostess_id } = await params
    if (!hostess_id || !isValidUUID(hostess_id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    const body = (await request.json().catch(() => ({}))) as {
      deduction_per_hour?: number
      overrides?: Array<{ participant_id: string; manager_payout_amount: number }>
    }
    const supabase = getServiceClient()
    const bid = await resolveBusinessDayId(supabase, auth.store_uuid)
    if (!bid) {
      return NextResponse.json({ error: "NO_OPERATING_DAY" }, { status: 409 })
    }

    // 1. deduction_per_hour 일괄 적용 (모든 오늘 세션)
    if (typeof body.deduction_per_hour === "number" && body.deduction_per_hour >= 0) {
      const rows = await loadRows(supabase, auth.store_uuid, hostess_id, bid)
      for (const r of rows) {
        const timeHours = (r.time_minutes ?? 0) / 60
        const mgrDeduct = Math.round(body.deduction_per_hour * timeHours)
        const hostessPay = Math.max(0, r.price_amount - mgrDeduct)
        await supabase
          .from("session_participants")
          .update({
            manager_payout_amount: mgrDeduct,
            hostess_payout_amount: hostessPay,
          })
          .eq("id", r.participant_id)
      }
      // staff_payout_states.memo 에 저장 (기존 memo 파싱 + 갱신, 오늘 영업일 scope)
      const { data: existing } = await supabase
        .from("staff_payout_states")
        .select("id, memo")
        .eq("store_uuid", auth.store_uuid)
        .eq("business_day_id", bid)
        .eq("hostess_membership_id", hostess_id)
        .is("deleted_at", null)
        .maybeSingle()
      const oldMemo = (existing as { id: string; memo: string | null } | null)?.memo
      let memoObj: Record<string, unknown> = {}
      try { memoObj = oldMemo ? JSON.parse(oldMemo) : {} } catch { memoObj = { note: oldMemo ?? "" } }
      memoObj.deduction_per_hour = body.deduction_per_hour
      const newMemo = JSON.stringify(memoObj)
      if (existing) {
        await supabase.from("staff_payout_states").update({ memo: newMemo }).eq("id", (existing as { id: string }).id)
      } else {
        await supabase.from("staff_payout_states").insert({
          store_uuid: auth.store_uuid,
          business_day_id: bid,
          hostess_membership_id: hostess_id,
          status: "pending",
          memo: newMemo,
        })
      }
    }

    // 2. 개별 override
    if (Array.isArray(body.overrides)) {
      for (const o of body.overrides) {
        if (!isValidUUID(o.participant_id) || typeof o.manager_payout_amount !== "number") continue
        const { data: part } = await supabase
          .from("session_participants")
          .select("price_amount")
          .eq("id", o.participant_id)
          .maybeSingle()
        if (!part) continue
        const price = Number((part as { price_amount: number }).price_amount ?? 0)
        const hostessPay = Math.max(0, price - o.manager_payout_amount)
        await supabase
          .from("session_participants")
          .update({
            manager_payout_amount: o.manager_payout_amount,
            hostess_payout_amount: hostessPay,
          })
          .eq("id", o.participant_id)
      }
    }

    // 재조회
    const rows = await loadRows(supabase, auth.store_uuid, hostess_id, bid)
    const summary = buildSummary(rows)
    return NextResponse.json({ sessions: rows, summary })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}
