import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export type SummaryRow = {
  hostess_id: string
  hostess_name: string
  has_settlement: boolean
  status: string | null
  gross_total: number | null
  tc_amount: number | null
  manager_amount: number | null
  hostess_amount: number | null
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
  const today = new Date().toISOString().split("T")[0]
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

  const participationsP = sessionIds.length === 0
    ? Promise.resolve({ data: [] as { membership_id: string; session_id: string }[] })
    : supabase
        .from("session_participants")
        .select("membership_id, session_id")
        .eq("store_uuid", auth.store_uuid)
        .in("session_id", sessionIds)
        .in("membership_id", hostessIds)
        .is("deleted_at", null)

  const [hstsRes, participationsRes] = await Promise.all([
    hstsP,
    participationsP,
  ])
  console.log(JSON.stringify({
    tag: "perf.settlement.summary.phase.derive",
    ms: Date.now() - tPhase3,
  }))

  const nameMap = new Map<string, string>()
  for (const h of (hstsRes.data ?? []) as { membership_id: string; name: string }[]) {
    nameMap.set(h.membership_id, h.name)
  }

  if (sessionIds.length === 0) {
    console.log(JSON.stringify({
      tag: "perf.settlement.summary.total",
      ms: Date.now() - tStart,
      path: "empty_sessions",
    }))
    return {
      store_uuid: auth.store_uuid,
      role: auth.role,
      business_day_id: businessDayId,
      summary: hostessIds.map((id) => ({
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

  const summary: SummaryRow[] = hostessIds.map((hostessId) => {
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

    return {
      hostess_id: hostessId,
      hostess_name: nameMap.get(hostessId) || "",
      has_settlement: hasSettlement,
      status: aggregateStatus,
      gross_total: hasSettlement ? totalGross : null,
      tc_amount: hasSettlement ? totalTc : null,
      manager_amount: hasSettlement ? totalManager : null,
      hostess_amount: hasSettlement ? totalHostess : null,
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
