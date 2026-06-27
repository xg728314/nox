/**
 * GET /api/manager/incoming-staff
 *
 * 본 매장 (auth.store_uuid) 으로 들어와 일하는/일한 타매장 식구 목록.
 *   기준: session_participants.store_uuid = 본 매장 AND
 *         origin_store_uuid != 본 매장 AND
 *         business_day_id = 오늘 (room_sessions JOIN)
 *
 * 응답 — origin_store + origin_manager 별 그룹:
 *   {
 *     business_day_id,
 *     groups: [
 *       {
 *         origin_store_uuid, origin_store_name,
 *         origin_manager_membership_id, origin_manager_name,
 *         total_price, total_hostess_payout, total_manager_payout,
 *         active_count, finished_count,
 *         participants: [
 *           { participant_id, membership_id, hostess_name, category,
 *             time_minutes, price_amount, hostess_payout_amount,
 *             manager_payout_amount, status, entered_at, left_at }
 *         ]
 *       }
 *     ],
 *     grand_total_price, grand_total_hostess_payout, grand_total_manager_payout
 *   }
 *
 * 권한: owner/manager — 본 매장 단위. super_admin 은 active context 매장 단위.
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { getBusinessDateForOps } from "@/lib/time/businessDate"

type ParticipantRow = {
  id: string
  session_id: string
  membership_id: string
  store_uuid: string
  origin_store_uuid: string | null
  category: string | null
  time_minutes: number | null
  price_amount: number | null
  hostess_payout_amount: number | null
  manager_payout_amount: number | null
  status: string
  entered_at: string | null
  left_at: string | null
  payout_settled_at: string | null
}

export async function GET(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const supabase = getServiceClient()

    // 1. 영업일 — settlementSummary 와 동일한 fallback 로직 사용
    //   R-incoming-bizday-fallback (2026-06-28): 사용자 보고 — 본 매장 식구는
    //   정산 화면에 나오는데 외부 식구는 0건. 원인: settlement summary 는
    //   today 영업일 없으면 latest open 으로 fallback 하지만, incoming-staff
    //   는 today 만 보고 null 반환 → 두 API 의 영업일이 어긋남.
    //   해결: 동일 fallback (latest open day) 적용.
    const today = getBusinessDateForOps()
    const { data: bizDayToday } = await supabase
      .from("store_operating_days")
      .select("id")
      .eq("store_uuid", auth.store_uuid)
      .eq("business_date", today)
      .maybeSingle()
    let businessDayId: string | null = bizDayToday?.id ?? null
    if (!businessDayId) {
      const { data: latestDay } = await supabase
        .from("store_operating_days")
        .select("id")
        .eq("store_uuid", auth.store_uuid)
        .eq("status", "open")
        .order("business_date", { ascending: false })
        .limit(1)
        .maybeSingle()
      businessDayId = latestDay?.id ?? null
    }
    if (!businessDayId) {
      return NextResponse.json({
        business_day_id: null,
        groups: [],
        grand_total_price: 0,
        grand_total_hostess_payout: 0,
        grand_total_manager_payout: 0,
      })
    }

    // 2. 오늘 본 매장 active/closed 세션 모두 (참여자 필터링 위해)
    const { data: sessions } = await supabase
      .from("room_sessions")
      .select("id")
      .eq("store_uuid", auth.store_uuid)
      .eq("business_day_id", businessDayId)
    const sessionIds = ((sessions ?? []) as { id: string }[]).map((s) => s.id)
    if (sessionIds.length === 0) {
      return NextResponse.json({
        business_day_id: businessDayId,
        groups: [],
        grand_total_price: 0,
        grand_total_hostess_payout: 0,
        grand_total_manager_payout: 0,
      })
    }

    // 3. 타매장 origin 참여자 (cross-store incoming)
    const { data: partsRaw } = await supabase
      .from("session_participants")
      .select("id, session_id, membership_id, store_uuid, origin_store_uuid, category, time_minutes, price_amount, hostess_payout_amount, manager_payout_amount, status, entered_at, left_at, payout_settled_at")
      .eq("store_uuid", auth.store_uuid)
      .in("session_id", sessionIds)
      .not("origin_store_uuid", "is", null)
      .neq("origin_store_uuid", auth.store_uuid)
      .is("deleted_at", null)
    const parts = (partsRaw ?? []) as ParticipantRow[]
    if (parts.length === 0) {
      return NextResponse.json({
        business_day_id: businessDayId,
        groups: [],
        grand_total_price: 0,
        grand_total_hostess_payout: 0,
        grand_total_manager_payout: 0,
      })
    }

    // 4. 보조 데이터 (이름 매핑)
    const hostessMids = Array.from(new Set(parts.map((p) => p.membership_id)))
    const originStores = Array.from(new Set(parts.map((p) => p.origin_store_uuid).filter(Boolean) as string[]))

    // hostesses → name + 원소속 manager_membership_id
    const { data: hRows } = await supabase
      .from("hostesses")
      .select("membership_id, name, manager_membership_id")
      .in("membership_id", hostessMids)
    type HostessRow = { membership_id: string; name: string | null; manager_membership_id: string | null }
    const hostessByMid = new Map<string, HostessRow>()
    for (const h of ((hRows ?? []) as HostessRow[])) hostessByMid.set(h.membership_id, h)

    // origin store names
    const { data: storeRows } = await supabase
      .from("stores")
      .select("id, store_name")
      .in("id", originStores)
    const storeNameByUuid = new Map<string, string>()
    for (const s of ((storeRows ?? []) as { id: string; store_name: string }[])) {
      storeNameByUuid.set(s.id, s.store_name)
    }

    // origin manager names — store_memberships.id → profiles.full_name
    const originMgrMids = Array.from(new Set(
      [...hostessByMid.values()].map((h) => h.manager_membership_id).filter(Boolean) as string[],
    ))
    const managerNameByMid = new Map<string, string>()
    if (originMgrMids.length > 0) {
      const { data: memRows } = await supabase
        .from("store_memberships")
        .select("id, profile_id, profiles!store_memberships_profile_id_fkey(full_name)")
        .in("id", originMgrMids)
      type MemEmbed = { id: string; profile_id: string | null; profiles: { full_name: string } | { full_name: string }[] | null }
      for (const m of ((memRows ?? []) as MemEmbed[])) {
        const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
        if (p?.full_name) managerNameByMid.set(m.id, p.full_name)
      }
    }

    // 5. 그룹핑 — (origin_store, origin_manager) 별
    type Group = {
      origin_store_uuid: string
      origin_store_name: string
      origin_manager_membership_id: string | null
      origin_manager_name: string | null
      total_price: number
      total_hostess_payout: number
      total_manager_payout: number
      active_count: number
      finished_count: number
      /** R-cross-payout-settle (2026-06-26): 그룹 정산 상태 */
      settlement_status: "all_settled" | "partial" | "none"
      settled_count: number
      unsettled_count: number
      participants: Array<{
        participant_id: string
        membership_id: string
        hostess_name: string
        category: string | null
        time_minutes: number | null
        price_amount: number
        hostess_payout_amount: number
        manager_payout_amount: number
        status: string
        entered_at: string | null
        left_at: string | null
        /** R-extend-end (2026-06-25): 외부 식구 카드 클릭 → ExtendEndSheet 용 */
        session_id: string
        /** R-cross-payout-settle (2026-06-26): 개별 정산 완료 시점 */
        payout_settled_at: string | null
      }>
    }
    const groups = new Map<string, Group>() // key = origin_store + ":" + origin_manager

    for (const p of parts) {
      const originStoreUuid = p.origin_store_uuid!
      const hostess = hostessByMid.get(p.membership_id)
      const originMgrMid = hostess?.manager_membership_id ?? null
      const key = `${originStoreUuid}:${originMgrMid ?? "unassigned"}`
      let g = groups.get(key)
      if (!g) {
        g = {
          origin_store_uuid: originStoreUuid,
          origin_store_name: storeNameByUuid.get(originStoreUuid) ?? "?",
          origin_manager_membership_id: originMgrMid,
          origin_manager_name: originMgrMid ? (managerNameByMid.get(originMgrMid) ?? "?") : "미배정",
          total_price: 0,
          total_hostess_payout: 0,
          total_manager_payout: 0,
          active_count: 0,
          finished_count: 0,
          settlement_status: "none",
          settled_count: 0,
          unsettled_count: 0,
          participants: [],
        }
        groups.set(key, g)
      }
      const price = Number(p.price_amount ?? 0)
      const hpay = Number(p.hostess_payout_amount ?? 0)
      const mpay = Number(p.manager_payout_amount ?? 0)
      g.total_price += price
      g.total_hostess_payout += hpay
      g.total_manager_payout += mpay
      if (p.status === "active") g.active_count++
      else g.finished_count++
      if (p.payout_settled_at) g.settled_count++
      else g.unsettled_count++
      g.participants.push({
        participant_id: p.id,
        membership_id: p.membership_id,
        hostess_name: hostess?.name ?? "?",
        category: p.category,
        time_minutes: p.time_minutes,
        price_amount: price,
        hostess_payout_amount: hpay,
        manager_payout_amount: mpay,
        status: p.status,
        entered_at: p.entered_at,
        left_at: p.left_at,
        session_id: p.session_id,
        payout_settled_at: p.payout_settled_at,
      })
    }
    // settlement_status 계산
    for (const g of groups.values()) {
      if (g.settled_count > 0 && g.unsettled_count === 0) g.settlement_status = "all_settled"
      else if (g.settled_count > 0) g.settlement_status = "partial"
      else g.settlement_status = "none"
    }

    const groupsArr = [...groups.values()].sort((a, b) =>
      a.origin_store_name.localeCompare(b.origin_store_name) ||
      (a.origin_manager_name ?? "").localeCompare(b.origin_manager_name ?? ""),
    )
    // 각 그룹 내 참여자도 정렬 — active 먼저, 그 다음 entered_at 내림차순
    for (const g of groupsArr) {
      g.participants.sort((a, b) => {
        if (a.status === b.status) return (b.entered_at ?? "").localeCompare(a.entered_at ?? "")
        return a.status === "active" ? -1 : 1
      })
    }

    const grand = groupsArr.reduce(
      (acc, g) => ({
        price: acc.price + g.total_price,
        host: acc.host + g.total_hostess_payout,
        mgr: acc.mgr + g.total_manager_payout,
      }),
      { price: 0, host: 0, mgr: 0 },
    )

    return NextResponse.json({
      business_day_id: businessDayId,
      groups: groupsArr,
      grand_total_price: grand.price,
      grand_total_hostess_payout: grand.host,
      grand_total_manager_payout: grand.mgr,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "err" }, { status: 500 })
  }
}
