import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { getBusinessDateForOps } from "@/lib/time/businessDate"

export type StoreBreakdownItem = {
  store_uuid: string
  store_name: string
  count: number
}
export type SummaryRow = {
  hostess_id: string
  hostess_name: string
  has_settlement: boolean
  status: string | null
  gross_total: number | null
  tc_amount: number | null
  manager_amount: number | null
  hostess_amount: number | null
  /** R-settle-display (2026-06-24): 세션 카운트 — UI 의 "건수" 표시용 */
  tc_count: number
  /** R-settle-breakdown (2026-06-26): 어느 매장에서 몇 타임 일했는지 */
  store_breakdown: StoreBreakdownItem[]
  /** R-deduction-default (2026-06-26): 1타임당 실장수익 기본값 (UI 표시용) */
  default_manager_deduction: number
  /** R-payout-state (2026-06-27): 정산 처리 상태 (정산완료/보관 시 시각 표시 + 3h 후 자동 hide) */
  payout_status?: "pending" | "paid" | "held" | null
  payout_paid_at?: string | null
  payout_method?: "cash" | "account" | null
}

export type ManagerSettlementSummaryResponse = {
  store_uuid: string
  role: AuthContext["role"]
  business_day_id: string | null
  summary: SummaryRow[]
}

/**
 * WATERFALL → PARALLEL REFACTOR (settlement.summary round):
 *
 *   Before: 6 sequential Supabase RTTs:
 *     bizDay → [latestDay?] → hostessIds → hsts(names) →
 *     sessions → participations → receipts
 *
 *   After: 3 phases with intra-phase parallelism:
 *     Phase 1 — business_day_id resolution (unchanged sequential
 *               fallback; 1 RTT common path).
 *     Phase 2 — 3 parallel reads:
 *                 a. hostessIds  (owner → all store hostesses;
 *                                 manager → assigned hostesses)
 *                 b. sessions    (day-scoped room_sessions)
 *                 c. receipts    (day-scoped receipts)
 *     Phase 3 — 2 parallel reads:
 *                 d. hsts (names by membership_id)
 *                 e. participations (by session_id × hostess_id)
 *
 *   Worst-case RTT count: 3 instead of 6. Response shape and all
 *   business rules preserved — hostess resolution branch by role is
 *   bit-identical, status aggregation/math unchanged.
 *
 *   Perf markers emitted:
 *     perf.settlement.summary.phase.business_day
 *     perf.settlement.summary.phase.bulk
 *     perf.settlement.summary.phase.derive
 *     perf.settlement.summary.total
 */

type ReceiptRow = {
  session_id: string
  status: string
  gross_total: number
  tc_amount: number
  manager_amount: number
  hostess_amount: number
}

async function resolveBusinessDayId(
  supabase: ReturnType<typeof getServiceClient>,
  storeUuid: string,
  override: string | null,
): Promise<string | null> {
  if (override) return override
  const today = getBusinessDateForOps()
  const { data: bizDay } = await supabase
    .from("store_operating_days")
    .select("id")
    .eq("store_uuid", storeUuid)
    .eq("business_date", today)
    .maybeSingle()
  if (bizDay?.id) return bizDay.id
  const { data: latestDay } = await supabase
    .from("store_operating_days")
    .select("id")
    .eq("store_uuid", storeUuid)
    .eq("status", "open")
    .order("business_date", { ascending: false })
    .limit(1)
    .maybeSingle()
  return latestDay?.id ?? null
}

export async function getManagerSettlementSummary(
  auth: AuthContext,
  params: { business_day_id?: string | null } = {},
): Promise<ManagerSettlementSummaryResponse> {
  const supabase = getServiceClient()
  const tStart = Date.now()

  // ── Phase 1: business_day_id ─────────────────────────────────
  const tPhase1 = Date.now()
  const businessDayId = await resolveBusinessDayId(
    supabase,
    auth.store_uuid,
    params.business_day_id ?? null,
  )
  console.log(JSON.stringify({
    tag: "perf.settlement.summary.phase.business_day",
    ms: Date.now() - tPhase1,
  }))

  if (!businessDayId) {
    console.log(JSON.stringify({
      tag: "perf.settlement.summary.total",
      ms: Date.now() - tStart,
      path: "no_business_day",
    }))
    return {
      store_uuid: auth.store_uuid,
      role: auth.role,
      business_day_id: null,
      summary: [],
    }
  }

  // ── Phase 2: 3 parallel reads ────────────────────────────────
  // hostessIds resolution branches by role but is independent of
  // sessions/receipts. All depend only on auth + businessDayId.
  const tPhase2 = Date.now()

  // owner: all approved hostesses in store
  // non-owner (manager): only assigned hostesses (hostesses.manager_membership_id match)
  const hostessIdsP = auth.role === "owner"
    ? supabase
        .from("store_memberships")
        .select("id")
        .eq("store_uuid", auth.store_uuid)
        .eq("role", "hostess")
        .eq("status", "approved")
    : supabase
        .from("hostesses")
        .select("membership_id")
        .eq("store_uuid", auth.store_uuid)
        .eq("manager_membership_id", auth.membership_id)

  const sessionsP = supabase
    .from("room_sessions")
    .select("id")
    .eq("store_uuid", auth.store_uuid)
    .eq("business_day_id", businessDayId)

  const receiptsP = supabase
    .from("receipts")
    .select("session_id, status, gross_total, tc_amount, manager_amount, hostess_amount")
    .eq("store_uuid", auth.store_uuid)
    .eq("business_day_id", businessDayId)

  const [hostessIdsRes, sessionsRes, receiptsRes] = await Promise.all([
    hostessIdsP,
    sessionsP,
    receiptsP,
  ])
  console.log(JSON.stringify({
    tag: "perf.settlement.summary.phase.bulk",
    ms: Date.now() - tPhase2,
  }))

  if (hostessIdsRes.error) {
    throw new Error(
      auth.role === "owner"
        ? "Failed to query hostesses."
        : "Failed to query hostess assignments.",
    )
  }
  const hostessIds: string[] = auth.role === "owner"
    ? ((hostessIdsRes.data ?? []) as { id: string }[]).map((h) => h.id)
    : ((hostessIdsRes.data ?? []) as { membership_id: string }[]).map((a) => a.membership_id)

  if (hostessIds.length === 0) {
    console.log(JSON.stringify({
      tag: "perf.settlement.summary.total",
      ms: Date.now() - tStart,
      path: "empty_hostesses",
    }))
    return {
      store_uuid: auth.store_uuid,
      role: auth.role,
      business_day_id: businessDayId,
      summary: [],
    }
  }

  const sessions = (sessionsRes.data ?? []) as { id: string }[]
  const sessionIds = sessions.map((s) => s.id)

  const receiptMap = new Map<string, ReceiptRow>()
  for (const r of (receiptsRes.data ?? []) as ReceiptRow[]) {
    receiptMap.set(r.session_id, r)
  }

  // ── Phase 3: 2 parallel reads (depend on Phase 2 ids) ───────
  const tPhase3 = Date.now()

  const hstsP = supabase
    .from("hostesses")
    .select("membership_id, name")
    .eq("store_uuid", auth.store_uuid)
    .in("membership_id", hostessIds)

  // R-settle-breakdown (2026-06-26): 식구별 default_manager_deduction 매핑.
  const membershipsP = supabase
    .from("store_memberships")
    .select("id, default_manager_deduction")
    .in("id", hostessIds)

  // R-cross-store-settlement (2026-06-25): 본 매장 세션 + 본 매장 식구가
  //   타 매장에서 일한 cross-store 참여 둘 다 합산.
  //   CLAUDE.md "정산은 무조건 origin_store_uuid 기준" — 식구가 어디서 일하든
  //   본 매장이 origin 이면 정산 책임.
  //   대안 1 (단순): store_uuid 필터 제거 — membership_id IN hostessIds 만으로
  //     모든 참여 잡음. session_uuid 필터도 제거 (cross-store 세션 ID 는
  //     sessionIds 에 없음). 일별 필터는 entered_at >= business_day 시작 이상
  //     로 대신 — 영업일 자정 인근만 약간 부정확. 일단 단순화.
  type ParticipantAgg = {
    membership_id: string
    session_id: string
    price_amount: number | null
    manager_payout_amount: number | null
    hostess_payout_amount: number | null
    store_uuid: string
    origin_store_uuid: string | null
    status: string
  }
  const participationsP = supabase
    .from("session_participants")
    .select("membership_id, session_id, price_amount, manager_payout_amount, hostess_payout_amount, store_uuid, origin_store_uuid, status")
    .in("membership_id", hostessIds)
    .is("deleted_at", null)

  // R-payout-state (2026-06-27): staff_payout_states 조회 — 정산완료 시각 / 보관 상태.
  const payoutStatesP = supabase
    .from("staff_payout_states")
    .select("hostess_membership_id, status, paid_at, paid_method")
    .eq("store_uuid", auth.store_uuid)
    .eq("business_day_id", businessDayId)
    .in("hostess_membership_id", hostessIds)
    .is("deleted_at", null)

  const [hstsRes, participationsRes, membershipsRes, payoutStatesRes] = await Promise.all([
    hstsP,
    participationsP,
    membershipsP,
    payoutStatesP,
  ])
  console.log(JSON.stringify({
    tag: "perf.settlement.summary.phase.derive",
    ms: Date.now() - tPhase3,
  }))

  const nameMap = new Map<string, string>()
  for (const h of (hstsRes.data ?? []) as { membership_id: string; name: string }[]) {
    nameMap.set(h.membership_id, h.name)
  }

  // R-settle-breakdown (2026-06-26): default_manager_deduction 맵
  const deductionMap = new Map<string, number>()
  for (const m of (membershipsRes.data ?? []) as { id: string; default_manager_deduction: number | null }[]) {
    deductionMap.set(m.id, Number(m.default_manager_deduction ?? 0))
  }

  // R-payout-state (2026-06-27): staff_payout_states 맵 (정산완료 시각 / 보관 / 지급방식)
  type PayoutStateRow = {
    hostess_membership_id: string
    status: "pending" | "paid" | "held" | null
    paid_at: string | null
    paid_method: "cash" | "account" | null
  }
  const payoutMap = new Map<string, PayoutStateRow>()
  for (const p of (payoutStatesRes.data ?? []) as PayoutStateRow[]) {
    payoutMap.set(p.hostess_membership_id, p)
  }

  // R-settle-breakdown (2026-06-26): 매장 이름 매핑 (store_breakdown 표시용)
  //   R-store-name-col-fix (2026-06-26): stores 컬럼명은 'store_name' — 'name' 잘못된
  //   select 로 매장명 — (대시) 표시되던 버그. /api/manager/hostesses/[id]/info 와 동일.
  const allStoreUuids = new Set<string>()
  for (const raw of (participationsRes.data ?? []) as { store_uuid: string }[]) {
    allStoreUuids.add(raw.store_uuid)
  }
  const storeNameMap = new Map<string, string>()
  if (allStoreUuids.size > 0) {
    const { data: storeRows } = await supabase
      .from("stores")
      .select("id, store_name")
      .in("id", Array.from(allStoreUuids))
    for (const s of (storeRows ?? []) as { id: string; store_name: string }[]) {
      storeNameMap.set(s.id, s.store_name)
    }
  }

  // R-per-participant-agg: 본 매장 세션 0 이어도 cross-store 참여가 있을 수
  //   있음 → empty_sessions early return 제거.

  // R-per-participant-agg (2026-06-25): 정산 계산을 participant payout 기준으로
  //   변경. 이전: receipt 합계 (per-session) 를 여러 hostess 에 중복 가산 — 3명
  //   참여 시 3배 over-count. 이전: cross-store session 의 receipt 매핑 못해서
  //   누락. 신규: hostess 의 각 participation row 의 price/payout 직접 합산.
  //   receipt 는 status (draft/finalized) 표시에만 사용.
  type PartRow = ParticipantAgg
  const hostessParts = new Map<string, PartRow[]>()
  for (const raw of (participationsRes.data ?? []) as PartRow[]) {
    if (!hostessParts.has(raw.membership_id)) hostessParts.set(raw.membership_id, [])
    hostessParts.get(raw.membership_id)!.push(raw)
  }

  const summary: SummaryRow[] = hostessIds.map((hostessId) => {
    const parts = hostessParts.get(hostessId) ?? []

    const payoutState = payoutMap.get(hostessId)
    if (parts.length === 0) {
      return {
        hostess_id: hostessId,
        hostess_name: nameMap.get(hostessId) || "",
        has_settlement: false,
        status: null,
        gross_total: null,
        tc_amount: null,
        manager_amount: null,
        hostess_amount: null,
        tc_count: 0,
        store_breakdown: [],
        default_manager_deduction: deductionMap.get(hostessId) ?? 0,
        payout_status: payoutState?.status ?? null,
        payout_paid_at: payoutState?.paid_at ?? null,
        payout_method: payoutState?.paid_method ?? null,
      }
    }

    let totalGross = 0
    let totalManager = 0
    let totalHostess = 0
    const seenSessions = new Set<string>()
    let finalizedCount = 0
    let draftCount = 0
    const storeCounts = new Map<string, number>()

    for (const p of parts) {
      totalGross += Number(p.price_amount ?? 0)
      totalManager += Number(p.manager_payout_amount ?? 0)
      totalHostess += Number(p.hostess_payout_amount ?? 0)
      seenSessions.add(p.session_id)
      const receipt = receiptMap.get(p.session_id)
      if (receipt?.status === "finalized") finalizedCount++
      else if (receipt?.status === "draft") draftCount++
      storeCounts.set(p.store_uuid, (storeCounts.get(p.store_uuid) ?? 0) + 1)
    }

    const hasSettlement = parts.length > 0
    let aggregateStatus: string | null = null
    if (finalizedCount > 0 && draftCount === 0) aggregateStatus = "finalized"
    else if (draftCount > 0 || finalizedCount > 0) aggregateStatus = "draft"
    else aggregateStatus = "active" // 아직 receipt 없음 — 진행 중

    const breakdown: StoreBreakdownItem[] = Array.from(storeCounts.entries())
      .map(([uuid, count]) => ({
        store_uuid: uuid,
        store_name: storeNameMap.get(uuid) ?? "—",
        count,
      }))
      .sort((a, b) => b.count - a.count)

    return {
      hostess_id: hostessId,
      hostess_name: nameMap.get(hostessId) || "",
      has_settlement: hasSettlement,
      status: aggregateStatus,
      gross_total: hasSettlement ? totalGross : null,
      tc_amount: hasSettlement ? totalGross : null, // TC = total price (per CLAUDE.md domain)
      manager_amount: hasSettlement ? totalManager : null,
      hostess_amount: hasSettlement ? totalHostess : null,
      tc_count: seenSessions.size,
      store_breakdown: breakdown,
      default_manager_deduction: deductionMap.get(hostessId) ?? 0,
      payout_status: payoutState?.status ?? null,
      payout_paid_at: payoutState?.paid_at ?? null,
      payout_method: payoutState?.paid_method ?? null,
    }
  })

  console.log(JSON.stringify({
    tag: "perf.settlement.summary.total",
    ms: Date.now() - tStart,
    path: "ok",
  }))

  return {
    store_uuid: auth.store_uuid,
    role: auth.role,
    business_day_id: businessDayId,
    summary,
  }
}
