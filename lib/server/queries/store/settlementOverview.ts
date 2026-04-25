import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { getBusinessDateForOps } from "@/lib/time/businessDate"

export type OverviewRow = {
  hostess_id: string
  hostess_name: string
  has_settlement: boolean
  status: string | null
  gross_total: number | null
  tc_amount: number | null
  manager_amount: number | null
  hostess_amount: number | null
}

export type StoreSettlementOverviewResponse = {
  store_uuid: string
  role: AuthContext["role"]
  business_day_id: string | null
  overview: OverviewRow[]
}

/**
 * WATERFALL → PARALLEL REFACTOR (settlement.overview round):
 *
 *   Before: 7-8 sequential Supabase RTTs:
 *     bizDay → [latestDay?] → hostesses → [managers?] → hstNames →
 *     sessions → participations → receipts
 *
 *   After: 3 phases, dependency-accurate, max parallelism within each:
 *     Phase 1  — business_day_id resolution (today → fallback open day).
 *                Sequential because `latestDay` only runs when today is
 *                missing. Most common path fires 1 RTT.
 *     Phase 2  — 4 parallel queries (all depend only on
 *                `store_uuid` + `business_day_id`, not on each other):
 *                  a. hostesses  (store_memberships, role filter)
 *                  b. managers   (only if auth.role === "owner")
 *                  c. sessions   (room_sessions for the day)
 *                  d. receipts   (receipts for the day)
 *     Phase 3  — 2 parallel queries (depend on Phase 2 ids):
 *                  e. hstNames       (by membership_ids)
 *                  f. participations (by session_ids × membership_ids)
 *
 *   Worst-case RTT count: 3 instead of 7-8. Tail latency is bounded
 *   by the slowest query in each phase, not by the serialized sum.
 *
 *   Response shape and every business rule below (status aggregation,
 *   visibility gating, early-return on empty hostesses / empty sessions)
 *   are preserved verbatim — only the ordering of the DB reads changed.
 *
 *   Perf markers emitted:
 *     perf.settlement.overview.phase.business_day
 *     perf.settlement.overview.phase.bulk      (Phase 2)
 *     perf.settlement.overview.phase.derive    (Phase 3)
 *     perf.settlement.overview.total
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

export async function getStoreSettlementOverview(
  auth: AuthContext,
  params: { business_day_id?: string | null } = {},
): Promise<StoreSettlementOverviewResponse> {
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
    tag: "perf.settlement.overview.phase.business_day",
    ms: Date.now() - tPhase1,
  }))

  if (!businessDayId) {
    console.log(JSON.stringify({
      tag: "perf.settlement.overview.total",
      ms: Date.now() - tStart,
      path: "no_business_day",
    }))
    return {
      store_uuid: auth.store_uuid,
      role: auth.role,
      business_day_id: null,
      overview: [],
    }
  }

  // ── Phase 2: 4 parallel reads ────────────────────────────────
  // All independent of each other; all gated only on auth + businessDayId.
  const tPhase2 = Date.now()
  const isOwner = auth.role === "owner"
  const hostessesP = (() => {
    let q = supabase
      .from("store_memberships")
      .select("id")
      .eq("store_uuid", auth.store_uuid)
      .eq("role", "hostess")
      .eq("status", "approved")
    if (auth.role === "hostess") {
      q = q.eq("id", auth.membership_id)
    }
    return q
  })()
  const managersP = isOwner
    ? supabase
        .from("managers")
        .select("membership_id, show_profit_to_owner, show_hostess_profit_to_owner")
        .eq("store_uuid", auth.store_uuid)
    : Promise.resolve({ data: null as null | { membership_id: string; show_profit_to_owner: boolean; show_hostess_profit_to_owner: boolean }[] })
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

  const [hostessesRes, managersRes, sessionsRes, receiptsRes] = await Promise.all([
    hostessesP,
    managersP,
    sessionsP,
    receiptsP,
  ])
  console.log(JSON.stringify({
    tag: "perf.settlement.overview.phase.bulk",
    ms: Date.now() - tPhase2,
  }))

  if (hostessesRes.error) throw new Error("Failed to query hostess memberships.")
  const hostesses = hostessesRes.data as { id: string }[] | null

  if (!hostesses || hostesses.length === 0) {
    console.log(JSON.stringify({
      tag: "perf.settlement.overview.total",
      ms: Date.now() - tStart,
      path: "empty_hostesses",
    }))
    return {
      store_uuid: auth.store_uuid,
      role: auth.role,
      business_day_id: businessDayId,
      overview: [],
    }
  }

  const membershipIds = hostesses.map((h) => h.id)

  const visibleManagerIds = new Set<string>()
  const visibleHostessManagerIds = new Set<string>()
  if (isOwner && managersRes.data) {
    for (const m of managersRes.data as { membership_id: string; show_profit_to_owner: boolean; show_hostess_profit_to_owner: boolean }[]) {
      if (m.show_profit_to_owner) visibleManagerIds.add(m.membership_id)
      if (m.show_hostess_profit_to_owner) visibleHostessManagerIds.add(m.membership_id)
    }
  }

  const sessions = (sessionsRes.data ?? []) as { id: string }[]
  const sessionIds = sessions.map((s) => s.id)

  const receiptMap = new Map<string, ReceiptRow>()
  for (const r of (receiptsRes.data ?? []) as ReceiptRow[]) {
    receiptMap.set(r.session_id, r)
  }

  // ── Phase 3: 2 parallel reads (depend on Phase 2 ids) ───────
  // hstNames depends on membershipIds. participations depends on both
  // sessionIds and membershipIds. Both cross-independent → parallel.
  const tPhase3 = Date.now()

  const hstNamesP = supabase
    .from("hostesses")
    .select("membership_id, name")
    .eq("store_uuid", auth.store_uuid)
    .in("membership_id", membershipIds)

  // If no sessions for the day, participations query is pointless and
  // would fail the `in("session_id", [])` guard. Short-circuit it.
  const participationsP = sessionIds.length === 0
    ? Promise.resolve({ data: [] as { membership_id: string; session_id: string }[] })
    : supabase
        .from("session_participants")
        .select("membership_id, session_id")
        .eq("store_uuid", auth.store_uuid)
        .in("session_id", sessionIds)
        .in("membership_id", membershipIds)
        .is("deleted_at", null)

  const [hstNamesRes, participationsRes] = await Promise.all([
    hstNamesP,
    participationsP,
  ])
  console.log(JSON.stringify({
    tag: "perf.settlement.overview.phase.derive",
    ms: Date.now() - tPhase3,
  }))

  const nameMap = new Map<string, string>()
  for (const h of (hstNamesRes.data ?? []) as { membership_id: string; name: string }[]) {
    nameMap.set(h.membership_id, h.name)
  }

  // Early-return when the business day has no sessions: every hostess
  // row is rendered as "no settlement". Identical shape/behavior as
  // before the refactor.
  if (sessionIds.length === 0) {
    console.log(JSON.stringify({
      tag: "perf.settlement.overview.total",
      ms: Date.now() - tStart,
      path: "empty_sessions",
    }))
    return {
      store_uuid: auth.store_uuid,
      role: auth.role,
      business_day_id: businessDayId,
      overview: membershipIds.map((id) => ({
        hostess_id: id,
        hostess_name: nameMap.get(id) || "",
        has_settlement: false,
        status: null,
        gross_total: null,
        tc_amount: null,
        manager_amount: null,
        hostess_amount: null,
      })),
    }
  }

  const hostessSessionMap = new Map<string, Set<string>>()
  for (const p of (participationsRes.data ?? []) as { membership_id: string; session_id: string }[]) {
    if (!hostessSessionMap.has(p.membership_id)) {
      hostessSessionMap.set(p.membership_id, new Set())
    }
    hostessSessionMap.get(p.membership_id)!.add(p.session_id)
  }

  const overview: OverviewRow[] = membershipIds.map((hostessId) => {
    const hostessSessions = hostessSessionMap.get(hostessId)

    if (!hostessSessions || hostessSessions.size === 0) {
      return {
        hostess_id: hostessId,
        hostess_name: nameMap.get(hostessId) || "",
        has_settlement: false,
        status: null,
        gross_total: null,
        tc_amount: null,
        manager_amount: null,
        hostess_amount: null,
      }
    }

    let totalGross = 0
    let totalTc = 0
    let totalManager = 0
    let totalHostess = 0
    let settledCount = 0
    let finalizedCount = 0
    let draftCount = 0

    for (const sid of hostessSessions) {
      const receipt = receiptMap.get(sid)
      if (receipt) {
        settledCount++
        totalGross += receipt.gross_total ?? 0
        totalTc += receipt.tc_amount ?? 0
        totalManager += receipt.manager_amount ?? 0
        totalHostess += receipt.hostess_amount ?? 0
        if (receipt.status === "finalized") finalizedCount++
        if (receipt.status === "draft") draftCount++
      }
    }

    const hasSettlement = settledCount > 0
    let aggregateStatus: string | null = null
    if (finalizedCount === settledCount && settledCount > 0) {
      aggregateStatus = "finalized"
    } else if (settledCount > 0) {
      aggregateStatus = "draft"
    }

    const showManagerAmt = auth.role !== "owner" || visibleManagerIds.size > 0
    const showHostessAmt = auth.role !== "owner" || visibleHostessManagerIds.size > 0

    return {
      hostess_id: hostessId,
      hostess_name: nameMap.get(hostessId) || "",
      has_settlement: hasSettlement,
      status: aggregateStatus,
      gross_total: hasSettlement ? totalGross : null,
      tc_amount: hasSettlement ? totalTc : null,
      manager_amount: showManagerAmt && hasSettlement ? totalManager : null,
      hostess_amount: showHostessAmt && hasSettlement ? totalHostess : null,
    }
  })

  console.log(JSON.stringify({
    tag: "perf.settlement.overview.total",
    ms: Date.now() - tStart,
    path: "ok",
  }))

  return {
    store_uuid: auth.store_uuid,
    role: auth.role,
    business_day_id: businessDayId,
    overview,
  }
}
