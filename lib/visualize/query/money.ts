/**
 * Visualize layer — Phase 1 money flow query.
 *
 * READ-ONLY. Stored values only. No imports from
 * `lib/(settlement|session|orders|receipt)/services/**`.
 *
 * Steps:
 *   Q1  store_operating_days  — scope existence + business_date
 *   Q2  room_sessions         — sessionIds in scope
 *   Q3  orders                — src_orders sum
 *   Q4  session_participants  — src_time sum
 *   Q5  receipts              — latest-by-version per session, finalized/draft
 *   Q6a settlements           — header allocations (manager/hostess/store)
 *   Q6b settlement_items      — item id → role_type map (for Q7 attribution)
 *   Q7  payout_records        — per-status sums, attributed by role via Q6b
 *   Q8  cross_store_settlements — in/out totals for the store
 *   Q9  credits               — outstanding
 *   Q10 manager_prepayments   — schema-introspected (column may not exist)
 *
 * Output: `MoneyFlowResponse` from shapes.ts.
 */

import type { ReadClient } from "../readClient"
import {
  MONEY_NODE_IDS,
  type MoneyFlowResponse,
  type MoneyFlowScope,
  type MoneyFlowTotals,
  type MoneyLink,
  type MoneyNode,
  type MoneyWarning,
} from "../shapes"
// 2026-05-03: Q10 prepayments fetch 분리.
import { fetchPrepayments } from "./money.prepay"

const KNOWN_PAYOUT_STATUSES = new Set([
  "approved",
  "rejected",
  "reversed",
  "cancelled_partial",
  "completed",
  "pending",
])

const KNOWN_ROLE_TYPES = new Set(["manager", "hostess", "store"])

function toNum(v: unknown): number {
  if (v == null) return 0
  if (typeof v === "number") return Number.isFinite(v) ? v : 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export type MoneyQueryInput = {
  client: ReadClient
  store_uuid: string
  business_day_id: string
}

export type MoneyQueryError = {
  ok: false
  status: number
  error: string
  message: string
}

export type MoneyQueryOk = { ok: true; data: MoneyFlowResponse }

export async function queryMoneyFlow(
  input: MoneyQueryInput,
): Promise<MoneyQueryOk | MoneyQueryError> {
  const { client, store_uuid, business_day_id } = input
  const sourceTables: string[] = []
  const warnings: MoneyWarning[] = []

  // ── Q1 operating day meta ────────────────────────────────────────────
  const q1 = await client
    .from("store_operating_days")
    .select("id, store_uuid, business_date, status")
    .eq("id", business_day_id)
    .eq("store_uuid", store_uuid)
    .is("deleted_at", null)
    .maybeSingle()
  sourceTables.push("store_operating_days")
  if (q1.error) {
    return { ok: false, status: 500, error: "QUERY_FAILED", message: `Q1 failed: ${q1.error.message}` }
  }
  if (!q1.data) {
    return {
      ok: false,
      status: 404,
      error: "OPERATING_DAY_NOT_FOUND",
      message: "business_day_id does not belong to store_uuid or has been deleted.",
    }
  }
  const scope: MoneyFlowScope = {
    store_uuid,
    business_day_id,
    business_date: (q1.data.business_date as string | null) ?? null,
    operating_day_status: (q1.data.status as string | null) ?? null,
  }

  // ── Q2 session ids ───────────────────────────────────────────────────
  const q2 = await client
    .from("room_sessions")
    .select("id, status")
    .eq("store_uuid", store_uuid)
    .eq("business_day_id", business_day_id)
    .is("deleted_at", null)
  sourceTables.push("room_sessions")
  if (q2.error) {
    return { ok: false, status: 500, error: "QUERY_FAILED", message: `Q2 failed: ${q2.error.message}` }
  }
  const sessionIds: string[] = ((q2.data ?? []) as { id: string }[]).map((r) => r.id)
  const closedSessionIds = new Set(
    ((q2.data ?? []) as { id: string; status: string }[])
      .filter((r) => r.status === "closed")
      .map((r) => r.id),
  )

  // ── Run remaining queries in parallel where independent ──────────────
  const [
    ordersRes,
    participantsRes,
    receiptsRes,
    settlementsRes,
    creditsRes,
    crossStoreRes,
    prepayBlock,
  ] = await Promise.all([
    // Q3 orders
    client
      .from("orders")
      .select("qty, unit_price, order_type")
      .eq("store_uuid", store_uuid)
      .eq("business_day_id", business_day_id)
      .is("deleted_at", null),
    // Q4 participants — needs sessionIds; if empty, skip
    sessionIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : client
          .from("session_participants")
          .select("price_amount, session_id")
          .eq("store_uuid", store_uuid)
          .in("session_id", sessionIds)
          .is("deleted_at", null),
    // Q5 receipts
    client
      .from("receipts")
      .select(
        "session_id, version, status, gross_total, manager_amount, hostess_amount, margin_amount, finalized_at",
      )
      .eq("store_uuid", store_uuid)
      .eq("business_day_id", business_day_id)
      .order("session_id", { ascending: true })
      .order("version", { ascending: false }),
    // Q6a settlements
    sessionIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : client
          .from("settlements")
          .select("id, session_id, status, total_amount, manager_amount, hostess_amount, store_amount")
          .eq("store_uuid", store_uuid)
          .in("session_id", sessionIds)
          .is("deleted_at", null),
    // Q9 credits
    client
      .from("credits")
      .select("status, amount")
      .eq("store_uuid", store_uuid)
      .eq("business_day_id", business_day_id)
      .is("deleted_at", null),
    // Q8 cross-store. Migration 038 dropped the legacy
    // `store_uuid`/`target_store_uuid` columns from this table; the
    // current source-of-truth columns are `from_store_uuid` (debtor)
    // and `to_store_uuid` (creditor).
    client
      .from("cross_store_settlements")
      .select("from_store_uuid, to_store_uuid, total_amount, prepaid_amount, remaining_amount, status")
      .or(`from_store_uuid.eq.${store_uuid},to_store_uuid.eq.${store_uuid}`)
      .is("deleted_at", null),
    // Q10 manager_prepayments — column-existence guarded
    fetchPrepayments(client, store_uuid, business_day_id),
  ])

  sourceTables.push(
    "orders",
    "session_participants",
    "receipts",
    "settlements",
    "credits",
    "cross_store_settlements",
  )

  if (ordersRes.error) {
    return { ok: false, status: 500, error: "QUERY_FAILED", message: `Q3 failed: ${ordersRes.error.message}` }
  }
  if (participantsRes.error) {
    return {
      ok: false, status: 500, error: "QUERY_FAILED",
      message: `Q4 failed: ${participantsRes.error.message}`,
    }
  }
  if (receiptsRes.error) {
    return {
      ok: false, status: 500, error: "QUERY_FAILED",
      message: `Q5 failed: ${receiptsRes.error.message}`,
    }
  }
  if (settlementsRes.error) {
    return {
      ok: false, status: 500, error: "QUERY_FAILED",
      message: `Q6 failed: ${settlementsRes.error.message}`,
    }
  }
  if (creditsRes.error) {
    return {
      ok: false, status: 500, error: "QUERY_FAILED",
      message: `Q9 failed: ${creditsRes.error.message}`,
    }
  }
  if (crossStoreRes.error) {
    return {
      ok: false, status: 500, error: "QUERY_FAILED",
      message: `Q8 failed: ${crossStoreRes.error.message}`,
    }
  }

  // ── Q3 src_orders aggregation ────────────────────────────────────────
  let ordersSum = 0
  let ordersRows = 0
  for (const r of (ordersRes.data ?? []) as { qty: unknown; unit_price: unknown }[]) {
    ordersSum += toNum(r.qty) * toNum(r.unit_price)
    ordersRows++
  }

  // ── Q4 src_time aggregation ──────────────────────────────────────────
  let timeSum = 0
  let timeRows = 0
  for (const r of (participantsRes.data ?? []) as { price_amount: unknown }[]) {
    timeSum += toNum(r.price_amount)
    timeRows++
  }

  // ── Q5 receipts latest-by-version dedupe ─────────────────────────────
  type RcptRow = {
    session_id: string
    version: number
    status: string
    gross_total: unknown
    manager_amount: unknown
    hostess_amount: unknown
    margin_amount: unknown
    finalized_at: string | null
  }
  const seenSession = new Set<string>()
  const latestReceipts: RcptRow[] = []
  for (const r of (receiptsRes.data ?? []) as RcptRow[]) {
    if (seenSession.has(r.session_id)) continue
    seenSession.add(r.session_id)
    latestReceipts.push(r)
  }
  let receiptsFinalized = 0
  let receiptsDraft = 0
  let receiptsCount = 0
  let receiptsGrossTotal = 0
  for (const r of latestReceipts) {
    receiptsCount++
    const gross = toNum(r.gross_total)
    receiptsGrossTotal += gross
    if (r.status === "finalized") receiptsFinalized += gross
    else receiptsDraft += gross
  }
  // Sessions that closed but produced no receipt → warning
  for (const sid of closedSessionIds) {
    if (!seenSession.has(sid)) {
      warnings.push({
        type: "missing_receipt",
        session_id: sid,
        note: "Session is closed but has no receipt.",
      })
    }
  }

  // ── Q6 settlements aggregation ───────────────────────────────────────
  type SettlementRow = {
    id: string
    session_id: string
    status: string
    total_amount: unknown
    manager_amount: unknown
    hostess_amount: unknown
    store_amount: unknown
  }
  const settlements = (settlementsRes.data ?? []) as SettlementRow[]
  let allocManager = 0
  let allocHostess = 0
  let allocStore = 0
  let settlementsTotal = 0
  let settlementsDraft = 0
  let settlementsConfirmed = 0
  const sessionToSettlementCount = new Map<string, number>()
  const settlementIds: string[] = []
  for (const s of settlements) {
    settlementIds.push(s.id)
    settlementsTotal += toNum(s.total_amount)
    allocManager += toNum(s.manager_amount)
    allocHostess += toNum(s.hostess_amount)
    allocStore += toNum(s.store_amount)
    if (s.status === "draft") settlementsDraft += toNum(s.total_amount)
    else if (s.status === "confirmed" || s.status === "finalized") {
      settlementsConfirmed += toNum(s.total_amount)
    }
    sessionToSettlementCount.set(
      s.session_id,
      (sessionToSettlementCount.get(s.session_id) ?? 0) + 1,
    )
    if (!seenSession.has(s.session_id)) {
      warnings.push({
        type: "orphan_settlement",
        settlement_id: s.id,
        session_id: s.session_id,
        note: "Settlement exists for a session with no receipt in this scope.",
      })
    }
  }
  for (const [sid, n] of sessionToSettlementCount) {
    if (n > 1) {
      warnings.push({
        type: "duplicate_settlement",
        session_id: sid,
        actual: n,
        expected: 1,
        note: "Multiple live settlements for one session — partial unique index violated.",
      })
    }
  }

  // ── Q6b settlement_items: id → role_type map (for Q7 attribution) ────
  const itemRoleMap = new Map<string, string>()
  let allocOther = 0
  if (settlementIds.length > 0) {
    const itemsRes = await client
      .from("settlement_items")
      .select("id, role_type, amount")
      .in("settlement_id", settlementIds)
      .is("deleted_at", null)
    sourceTables.push("settlement_items")
    if (itemsRes.error) {
      return {
        ok: false, status: 500, error: "QUERY_FAILED",
        message: `Q6b failed: ${itemsRes.error.message}`,
      }
    }
    for (const it of (itemsRes.data ?? []) as { id: string; role_type: string; amount: unknown }[]) {
      itemRoleMap.set(it.id, it.role_type)
      if (!KNOWN_ROLE_TYPES.has(it.role_type)) {
        allocOther += toNum(it.amount)
        warnings.push({
          type: "unknown_role_type",
          settlement_id: it.id,
          note: `Unknown settlement_items.role_type='${it.role_type}'.`,
        })
      }
    }
  }

  // ── Q7 payouts ───────────────────────────────────────────────────────
  let payoutApproved = 0
  let payoutRejected = 0
  let payoutReversed = 0
  let payoutCancelledPartial = 0
  // Per-role attribution: amount paid OUT of each allocation bucket.
  const paidByRoleApproved: Record<string, number> = {
    manager: 0, hostess: 0, store: 0, other: 0,
  }
  let payoutsRows = 0
  if (settlementIds.length > 0) {
    const payoutsRes = await client
      .from("payout_records")
      .select("settlement_id, settlement_item_id, status, amount, target_store_uuid")
      .in("settlement_id", settlementIds)
      .is("deleted_at", null)
    sourceTables.push("payout_records")
    if (payoutsRes.error) {
      return {
        ok: false, status: 500, error: "QUERY_FAILED",
        message: `Q7 failed: ${payoutsRes.error.message}`,
      }
    }
    for (const p of (payoutsRes.data ?? []) as {
      settlement_id: string | null
      settlement_item_id: string | null
      status: string
      amount: unknown
      target_store_uuid: string | null
    }[]) {
      payoutsRows++
      const amt = toNum(p.amount)
      if (!KNOWN_PAYOUT_STATUSES.has(p.status)) {
        warnings.push({
          type: "unknown_status",
          settlement_id: p.settlement_id ?? undefined,
          note: `Unknown payout_records.status='${p.status}'.`,
        })
        continue
      }
      if (p.status === "approved" || p.status === "completed") {
        payoutApproved += amt
        // Attribute to role only when item link exists.
        if (p.settlement_item_id) {
          const role = itemRoleMap.get(p.settlement_item_id)
          if (role && KNOWN_ROLE_TYPES.has(role)) {
            paidByRoleApproved[role] = (paidByRoleApproved[role] ?? 0) + amt
          } else {
            paidByRoleApproved.other += amt
          }
        } else {
          paidByRoleApproved.other += amt
        }
      } else if (p.status === "rejected") {
        payoutRejected += amt
      } else if (p.status === "reversed") {
        payoutReversed += amt
      } else if (p.status === "cancelled_partial") {
        payoutCancelledPartial += amt
      }
    }
  }

  // ── Q8 cross-store totals ────────────────────────────────────────────
  // Schema migration 038 renamed legacy columns:
  //   store_uuid       → from_store_uuid (debtor side)
  //   target_store_uuid → to_store_uuid  (creditor side)
  // Direction unchanged: outgoing = my store is the `from` (paying).
  type XStoreRow = {
    from_store_uuid: string
    to_store_uuid: string
    total_amount: unknown
    prepaid_amount: unknown
    remaining_amount: unknown
    status: string
  }
  const xstoreRows = (crossStoreRes.data ?? []) as XStoreRow[]
  let xstoreInPending = 0
  let xstoreInSettled = 0
  let xstoreOutPending = 0
  let xstoreOutSettled = 0
  for (const r of xstoreRows) {
    const total = toNum(r.total_amount)
    const prepaid = toNum(r.prepaid_amount)
    const remaining = toNum(r.remaining_amount)
    const isOutgoing = r.from_store_uuid === store_uuid
    const closed = r.status === "closed" || r.status === "settled"
    if (isOutgoing) {
      if (closed) xstoreOutSettled += total
      else xstoreOutPending += remaining > 0 ? remaining : Math.max(0, total - prepaid)
    } else {
      if (closed) xstoreInSettled += total
      else xstoreInPending += remaining > 0 ? remaining : Math.max(0, total - prepaid)
    }
  }

  // ── Q9 credits aggregation ───────────────────────────────────────────
  let creditsOutstanding = 0
  for (const r of (creditsRes.data ?? []) as { status: string; amount: unknown }[]) {
    if (r.status === "pending") creditsOutstanding += toNum(r.amount)
  }

  // ── Q10 prepayments (already fetched above) ──────────────────────────
  const prepayDeduction = prepayBlock.amount
  if (prepayBlock.warning) warnings.push(prepayBlock.warning)
  if (prepayBlock.tableUsed) sourceTables.push(prepayBlock.tableUsed)

  // ── Derived: payout_pending per allocation ───────────────────────────
  // These are clamped to 0; UI labels them as derived (not stored).
  const reversalManager = 0 // (rejected/reversed/cancelled aren't role-attributed in Phase 1)
  const reversalHostess = 0
  const reversalStore = 0
  const pendingManager = Math.max(
    0,
    allocManager - paidByRoleApproved.manager - prepayDeduction - reversalManager,
  )
  const pendingHostess = Math.max(
    0,
    allocHostess - paidByRoleApproved.hostess - xstoreOutPending - reversalHostess,
  )
  const pendingStore = Math.max(
    0,
    allocStore - paidByRoleApproved.store - creditsOutstanding - reversalStore,
  )
  const payoutPending = pendingManager + pendingHostess + pendingStore
  if (
    pendingManager === 0 && pendingHostess === 0 && pendingStore === 0 &&
    (allocManager + allocHostess + allocStore) > 0 &&
    payoutApproved + payoutRejected + payoutReversed + payoutCancelledPartial +
      xstoreOutPending + creditsOutstanding + prepayDeduction <
      allocManager + allocHostess + allocStore - 1000
  ) {
    warnings.push({
      type: "partial_payout",
      expected: allocManager + allocHostess + allocStore,
      actual: payoutApproved + xstoreOutPending + creditsOutstanding + prepayDeduction,
      note: "Allocations exceed accounted outflows; check for missing payouts or reversed records.",
    })
  }

  // ── sum_mismatch sanity check ────────────────────────────────────────
  // receipts.gross_total ≈ alloc_manager + alloc_hostess + alloc_store + tc + service - discount
  // We only compare the slice we have (no tc/service/discount in Phase 1
  // alloc nodes), so tolerance is loose.
  if (settlements.length > 0 && receiptsCount > 0) {
    const allocSum = allocManager + allocHostess + allocStore
    const diff = Math.abs(receiptsFinalized + receiptsDraft - settlementsTotal)
    if (diff > 1000 && allocSum > 0) {
      warnings.push({
        type: "sum_mismatch",
        expected: receiptsFinalized + receiptsDraft,
        actual: settlementsTotal,
        note: "Receipts gross_total differs from settlements.total_amount by more than 1,000.",
      })
    }
  }

  // ── Build totals ─────────────────────────────────────────────────────
  const totals: MoneyFlowTotals = {
    receipts: {
      count: receiptsCount,
      gross_total: receiptsGrossTotal,
      finalized: receiptsFinalized,
      draft: receiptsDraft,
    },
    settlements: {
      count: settlements.length,
      total: settlementsTotal,
      draft: settlementsDraft,
      confirmed: settlementsConfirmed,
    },
    payouts: {
      approved: payoutApproved,
      rejected: payoutRejected,
      reversed: payoutReversed,
      cancelled_partial: payoutCancelledPartial,
    },
    cross_store: {
      in_pending: xstoreInPending,
      in_settled: xstoreInSettled,
      out_pending: xstoreOutPending,
      out_settled: xstoreOutSettled,
    },
    credits_outstanding: creditsOutstanding,
    prepay_deduction: prepayDeduction,
  }

  // ── Build nodes ──────────────────────────────────────────────────────
  const nodes: MoneyNode[] = [
    {
      id: MONEY_NODE_IDS.SRC_ORDERS,
      label: "주문 매출",
      group: "source",
      amount: ordersSum,
      meta: { row_count: ordersRows, table: "orders" },
    },
    {
      id: MONEY_NODE_IDS.SRC_TIME,
      label: "타임 매출",
      group: "source",
      amount: timeSum,
      meta: { row_count: timeRows, table: "session_participants" },
    },
    {
      id: MONEY_NODE_IDS.RECEIPTS_FINALIZED,
      label: "영수증 (확정)",
      group: "aggregate",
      amount: receiptsFinalized,
      meta: { table: "receipts" },
    },
    {
      id: MONEY_NODE_IDS.RECEIPTS_DRAFT,
      label: "영수증 (임시)",
      group: "aggregate",
      amount: receiptsDraft,
      meta: { table: "receipts" },
    },
    {
      id: MONEY_NODE_IDS.ALLOC_MANAGER,
      label: "실장 분배",
      group: "allocation",
      amount: allocManager,
      meta: { table: "settlements" },
    },
    {
      id: MONEY_NODE_IDS.ALLOC_HOSTESS,
      label: "아가씨 분배",
      group: "allocation",
      amount: allocHostess,
      meta: { table: "settlements" },
    },
    {
      id: MONEY_NODE_IDS.ALLOC_STORE,
      label: "매장 마진",
      group: "allocation",
      amount: allocStore,
      meta: { table: "settlements" },
    },
    {
      id: MONEY_NODE_IDS.ALLOC_OTHER,
      label: "기타 분배",
      group: "allocation",
      amount: allocOther,
      meta: { table: "settlement_items" },
    },
    {
      id: MONEY_NODE_IDS.PAYOUT_APPROVED,
      label: "지급 완료",
      group: "sink",
      amount: payoutApproved,
      meta: { table: "payout_records", row_count: payoutsRows },
    },
    {
      id: MONEY_NODE_IDS.PAYOUT_PENDING,
      label: "미지급 (계산값)",
      group: "sink",
      amount: payoutPending,
      derived: true,
    },
    {
      id: MONEY_NODE_IDS.XSTORE_OUT,
      label: "타매장 송금",
      group: "sink",
      amount: xstoreOutPending,
      meta: { table: "cross_store_settlements" },
    },
    {
      id: MONEY_NODE_IDS.CREDIT_OUTSTANDING,
      label: "외상 잔액",
      group: "sink",
      amount: creditsOutstanding,
      meta: { table: "credits" },
    },
    {
      id: MONEY_NODE_IDS.PREPAY_DEDUCTION,
      label: "선정산 차감",
      group: "sink",
      amount: prepayDeduction,
      meta: { table: prepayBlock.tableUsed ?? "manager_prepayments" },
    },
    {
      id: MONEY_NODE_IDS.PAYOUT_REJECTED,
      label: "지급 거부",
      group: "reversal",
      amount: payoutRejected,
      meta: { table: "payout_records" },
    },
    {
      id: MONEY_NODE_IDS.PAYOUT_REVERSED,
      label: "지급 반환",
      group: "reversal",
      amount: payoutReversed,
      meta: { table: "payout_records" },
    },
    {
      id: MONEY_NODE_IDS.PAYOUT_CANCELLED_PARTIAL,
      label: "부분 취소",
      group: "reversal",
      amount: payoutCancelledPartial,
      meta: { table: "payout_records" },
    },
  ]

  // ── Build links ──────────────────────────────────────────────────────
  // Source → aggregate split: distribute ordersSum + timeSum into
  // finalized/draft proportional to their share of total receipts.
  const totalReceipts = receiptsFinalized + receiptsDraft
  const finalizedShare = totalReceipts > 0 ? receiptsFinalized / totalReceipts : 1
  const draftShare = totalReceipts > 0 ? receiptsDraft / totalReceipts : 0

  const links: MoneyLink[] = []
  if (ordersSum > 0) {
    if (finalizedShare > 0) {
      links.push({
        source: MONEY_NODE_IDS.SRC_ORDERS,
        target: MONEY_NODE_IDS.RECEIPTS_FINALIZED,
        amount: ordersSum * finalizedShare,
        kind: "primary",
        source_table: "orders",
      })
    }
    if (draftShare > 0) {
      links.push({
        source: MONEY_NODE_IDS.SRC_ORDERS,
        target: MONEY_NODE_IDS.RECEIPTS_DRAFT,
        amount: ordersSum * draftShare,
        kind: "primary",
        source_table: "orders",
      })
    }
  }
  if (timeSum > 0) {
    if (finalizedShare > 0) {
      links.push({
        source: MONEY_NODE_IDS.SRC_TIME,
        target: MONEY_NODE_IDS.RECEIPTS_FINALIZED,
        amount: timeSum * finalizedShare,
        kind: "primary",
        source_table: "session_participants",
      })
    }
    if (draftShare > 0) {
      links.push({
        source: MONEY_NODE_IDS.SRC_TIME,
        target: MONEY_NODE_IDS.RECEIPTS_DRAFT,
        amount: timeSum * draftShare,
        kind: "primary",
        source_table: "session_participants",
      })
    }
  }
  // Aggregate → allocation
  if (allocManager > 0) {
    links.push({
      source: MONEY_NODE_IDS.RECEIPTS_FINALIZED,
      target: MONEY_NODE_IDS.ALLOC_MANAGER,
      amount: allocManager,
      kind: "primary",
      source_table: "settlements",
    })
  }
  if (allocHostess > 0) {
    links.push({
      source: MONEY_NODE_IDS.RECEIPTS_FINALIZED,
      target: MONEY_NODE_IDS.ALLOC_HOSTESS,
      amount: allocHostess,
      kind: "primary",
      source_table: "settlements",
    })
  }
  if (allocStore > 0) {
    links.push({
      source: MONEY_NODE_IDS.RECEIPTS_FINALIZED,
      target: MONEY_NODE_IDS.ALLOC_STORE,
      amount: allocStore,
      kind: "primary",
      source_table: "settlements",
    })
  }
  if (allocOther > 0) {
    links.push({
      source: MONEY_NODE_IDS.RECEIPTS_FINALIZED,
      target: MONEY_NODE_IDS.ALLOC_OTHER,
      amount: allocOther,
      kind: "primary",
      source_table: "settlement_items",
    })
  }
  // Allocation → sink (per role, stored only)
  if (paidByRoleApproved.manager > 0) {
    links.push({
      source: MONEY_NODE_IDS.ALLOC_MANAGER,
      target: MONEY_NODE_IDS.PAYOUT_APPROVED,
      amount: paidByRoleApproved.manager,
      kind: "primary",
      source_table: "payout_records",
    })
  }
  if (paidByRoleApproved.hostess > 0) {
    links.push({
      source: MONEY_NODE_IDS.ALLOC_HOSTESS,
      target: MONEY_NODE_IDS.PAYOUT_APPROVED,
      amount: paidByRoleApproved.hostess,
      kind: "primary",
      source_table: "payout_records",
    })
  }
  if (paidByRoleApproved.store > 0) {
    links.push({
      source: MONEY_NODE_IDS.ALLOC_STORE,
      target: MONEY_NODE_IDS.PAYOUT_APPROVED,
      amount: paidByRoleApproved.store,
      kind: "primary",
      source_table: "payout_records",
    })
  }
  if (paidByRoleApproved.other > 0) {
    links.push({
      source: MONEY_NODE_IDS.ALLOC_OTHER,
      target: MONEY_NODE_IDS.PAYOUT_APPROVED,
      amount: paidByRoleApproved.other,
      kind: "primary",
      source_table: "payout_records",
    })
  }
  if (prepayDeduction > 0) {
    links.push({
      source: MONEY_NODE_IDS.ALLOC_MANAGER,
      target: MONEY_NODE_IDS.PREPAY_DEDUCTION,
      amount: prepayDeduction,
      kind: "deduction",
      source_table: prepayBlock.tableUsed ?? "manager_prepayments",
    })
  }
  if (xstoreOutPending > 0) {
    links.push({
      source: MONEY_NODE_IDS.ALLOC_HOSTESS,
      target: MONEY_NODE_IDS.XSTORE_OUT,
      amount: xstoreOutPending,
      kind: "cross_store",
      source_table: "cross_store_settlements",
    })
  }
  if (creditsOutstanding > 0) {
    links.push({
      source: MONEY_NODE_IDS.ALLOC_STORE,
      target: MONEY_NODE_IDS.CREDIT_OUTSTANDING,
      amount: creditsOutstanding,
      kind: "outstanding",
      source_table: "credits",
    })
  }
  // Derived pending links
  if (pendingManager > 0) {
    links.push({
      source: MONEY_NODE_IDS.ALLOC_MANAGER,
      target: MONEY_NODE_IDS.PAYOUT_PENDING,
      amount: pendingManager,
      kind: "primary",
      source_table: "(derived)",
    })
  }
  if (pendingHostess > 0) {
    links.push({
      source: MONEY_NODE_IDS.ALLOC_HOSTESS,
      target: MONEY_NODE_IDS.PAYOUT_PENDING,
      amount: pendingHostess,
      kind: "primary",
      source_table: "(derived)",
    })
  }
  if (pendingStore > 0) {
    links.push({
      source: MONEY_NODE_IDS.ALLOC_STORE,
      target: MONEY_NODE_IDS.PAYOUT_PENDING,
      amount: pendingStore,
      kind: "primary",
      source_table: "(derived)",
    })
  }
  // Reversal lane
  if (payoutRejected > 0) {
    links.push({
      source: MONEY_NODE_IDS.PAYOUT_APPROVED,
      target: MONEY_NODE_IDS.PAYOUT_REJECTED,
      amount: payoutRejected,
      kind: "reversal",
      source_table: "payout_records",
    })
  }
  if (payoutReversed > 0) {
    links.push({
      source: MONEY_NODE_IDS.PAYOUT_APPROVED,
      target: MONEY_NODE_IDS.PAYOUT_REVERSED,
      amount: payoutReversed,
      kind: "reversal",
      source_table: "payout_records",
    })
  }
  if (payoutCancelledPartial > 0) {
    links.push({
      source: MONEY_NODE_IDS.PAYOUT_APPROVED,
      target: MONEY_NODE_IDS.PAYOUT_CANCELLED_PARTIAL,
      amount: payoutCancelledPartial,
      kind: "reversal",
      source_table: "payout_records",
    })
  }

  const response: MoneyFlowResponse = {
    as_of: new Date().toISOString(),
    scope,
    source_tables: Array.from(new Set(sourceTables)),
    totals,
    nodes,
    links,
    warnings,
  }

  return { ok: true, data: response }
}

// 2026-05-03: Q10 prepayment helpers 는 ./money.prepay.ts 로 분리.
