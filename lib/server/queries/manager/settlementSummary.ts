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
  /** R-manager-group (2026-08-25): 담당 실장 (본 매장 hostesses.manager_membership_id).
   *  owner 는 실장별 그룹 뷰 · manager 는 자동 필터. 미배정이면 null. */
  manager_membership_id?: string | null
  manager_name?: string | null
}

export type ManagerSettlementSummaryResponse = {
  store_uuid: string
  role: AuthContext["role"]
  business_day_id: string | null
  summary: SummaryRow[]
  /** R-store-totals (2026-08-23): 매장 총액 · owner 마스킹 우회.
   *  개별 hostess/manager amount 는 owner 응답에서 null 로 masked 되지만
   *  매장 총액 (사장이 볼 수 있음 = 총매출·사장마진) 은 unmasked. */
  store_totals?: {
    total_gross: number
    total_hostess_payout: number
    total_manager_jjing: number
  }
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

  // R-chunked-in (2026-08-24): hostessIds 가 수백 명 넘으면 `.in()` URL 길이
  //   초과 (~15KB) 로 fetch 실패 · 조용히 empty result 반환 → 정산 화면 값
  //   0 으로 표시되는 심각 버그. UUID 36자 × N + comma → 100개 청크 안전
  //   (~3.7KB per chunk). 각 청크 병렬 fetch 후 concat.
  const IN_CHUNK = 100
  function chunk<T>(arr: T[], n: number): T[][] {
    const out: T[][] = []
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
    return out
  }
  const idChunks = chunk(hostessIds, IN_CHUNK)

  async function chunkedFetch<Row>(build: (ids: string[]) => Promise<{ data: Row[] | null; error: unknown }>): Promise<{ data: Row[]; error: unknown | null }> {
    const results = await Promise.all(idChunks.map((c) => build(c)))
    const rows: Row[] = []
    let firstErr: unknown | null = null
    for (const r of results) {
      if (r.error && !firstErr) firstErr = r.error
      if (r.data) rows.push(...r.data)
    }
    return { data: rows, error: firstErr }
  }

  const hstsP = chunkedFetch<{ membership_id: string; name: string }>(async (ids) => {
    const { data, error } = await supabase
      .from("hostesses")
      .select("membership_id, name")
      .eq("store_uuid", auth.store_uuid)
      .in("membership_id", ids)
    return { data, error }
  })

  const membershipsP = chunkedFetch<{ id: string; default_manager_deduction: number | null }>(async (ids) => {
    const { data, error } = await supabase
      .from("store_memberships")
      .select("id, default_manager_deduction")
      .in("id", ids)
    return { data, error }
  })

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
  const participationsP = chunkedFetch<ParticipantAgg>(async (ids) => {
    const { data, error } = await supabase
      .from("session_participants")
      .select("membership_id, session_id, price_amount, manager_payout_amount, hostess_payout_amount, store_uuid, origin_store_uuid, status")
      .in("membership_id", ids)
      .is("deleted_at", null)
    return { data: data as ParticipantAgg[] | null, error }
  })

  type PayoutStateRowFetch = {
    hostess_membership_id: string
    status: "pending" | "paid" | "held" | null
    paid_at: string | null
    paid_method: "cash" | "account" | null
  }
  const payoutStatesP = chunkedFetch<PayoutStateRowFetch>(async (ids) => {
    const { data, error } = await supabase
      .from("staff_payout_states")
      .select("hostess_membership_id, status, paid_at, paid_method")
      .eq("store_uuid", auth.store_uuid)
      .eq("business_day_id", businessDayId)
      .in("hostess_membership_id", ids)
      .is("deleted_at", null)
    return { data, error }
  })

  const [hstsRes, participationsRes, membershipsRes, payoutStatesRes] = await Promise.all([
    hstsP,
    participationsP,
    membershipsP,
    payoutStatesP,
  ])
  console.log(JSON.stringify({
    tag: "perf.settlement.summary.phase.derive",
    ms: Date.now() - tPhase3,
    hostessIds_len: hostessIds.length,
    chunks: idChunks.length,
    participations_len: participationsRes.data.length,
    participations_err: participationsRes.error ? String(participationsRes.error) : null,
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

  // R-manager-group (2026-08-25): 각 hostess 의 담당 실장 (본 매장 hostesses.
  //   manager_membership_id) 조회 → 실장 profile.full_name 매핑. 클라 UI 에서
  //   실장별 그룹 렌더 · 사용자 "내 아가씨 · 내 정산 금액 분류" 요청 대응.
  const hostessManagerMap = new Map<string, string | null>()  // hostessId → manager_membership_id
  {
    const hRes = await chunkedFetch<{ membership_id: string; manager_membership_id: string | null }>(async (ids) => {
      const { data, error } = await supabase
        .from("hostesses")
        .select("membership_id, manager_membership_id")
        .eq("store_uuid", auth.store_uuid)
        .in("membership_id", ids)
      return { data, error }
    })
    for (const h of hRes.data) {
      hostessManagerMap.set(h.membership_id, h.manager_membership_id ?? null)
    }
  }
  const managerIdSet = new Set<string>()
  for (const mid of hostessManagerMap.values()) if (mid) managerIdSet.add(mid)
  const managerNameMap = new Map<string, string>()
  if (managerIdSet.size > 0) {
    const managerIds = Array.from(managerIdSet)
    // store_memberships → profile_id, then profiles.full_name (2 hops)
    const memRes = await chunkedFetch<{ id: string; profile_id: string }>(async (ids) => {
      const { data, error } = await supabase
        .from("store_memberships")
        .select("id, profile_id")
        .in("id", ids)
      return { data: data as { id: string; profile_id: string }[] | null, error }
    })
    const memToProfile = new Map<string, string>()
    const pidSet = new Set<string>()
    for (const m of memRes.data) {
      memToProfile.set(m.id, m.profile_id)
      pidSet.add(m.profile_id)
    }
    const pidArr = Array.from(pidSet)
    if (pidArr.length > 0) {
      const pRes = await chunkedFetch<{ id: string; full_name: string | null }>(async (ids) => {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", ids)
        return { data: data as { id: string; full_name: string | null }[] | null, error }
      })
      const profNameMap = new Map<string, string>()
      for (const p of pRes.data) profNameMap.set(p.id, p.full_name ?? "")
      for (const [memId, pid] of memToProfile) {
        const name = profNameMap.get(pid)
        if (name) managerNameMap.set(memId, name)
      }
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
    const mgrMid = hostessManagerMap.get(hostessId) ?? null
    const mgrName = mgrMid ? (managerNameMap.get(mgrMid) ?? null) : null
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
        manager_membership_id: mgrMid,
        manager_name: mgrName,
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
      manager_membership_id: mgrMid,
      manager_name: mgrName,
    }
  })

  console.log(JSON.stringify({
    tag: "perf.settlement.summary.total",
    ms: Date.now() - tStart,
    path: "ok",
  }))

  // R-store-totals (2026-08-23): owner 마스킹으로 개별 hostess_amount 가 null 이어도
  //   매장 총액은 표시 가능 (CLAUDE.md: 사장 볼 수 있음 = 총매출·사장마진).
  //   dashboard "식구 지급" 이 개별 sum 하니 owner 에게 0 표시되던 문제 fix.
  //   총액은 payout_status=paid+held 참여자 hostess_amount unmasked sum.
  const storeTotals = {
    total_gross: summary.reduce((a, r) => a + (r.gross_total ?? 0), 0),
    total_hostess_payout: (() => {
      // hostessParts 원본 (마스킹 전) 에서 payout paid/held 만 sum
      let s = 0
      for (const [hid, parts] of hostessParts) {
        const ps = payoutMap.get(hid)?.status
        if (ps !== "paid" && ps !== "held") continue
        for (const p of parts) s += Number(p.hostess_payout_amount ?? 0)
      }
      return s
    })(),
    total_manager_jjing: (() => {
      let s = 0
      for (const parts of hostessParts.values()) {
        for (const p of parts) s += Number(p.manager_payout_amount ?? 0)
      }
      return s
    })(),
  }

  return {
    store_uuid: auth.store_uuid,
    role: auth.role,
    business_day_id: businessDayId,
    summary,
    store_totals: storeTotals,
  }
}
