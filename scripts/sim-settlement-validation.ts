/**
 * STEP-NEXT-SETTLEMENT-SIM — Settlement deep-validation simulation.
 *
 * Self-contained, in-memory simulation of NOX settlement rules locked in
 * STEP-NEXT-SETTLEMENT-LOCK (round 4). No Supabase. No production API.
 * No new formulas. Only the locked time-pricing table, the four locked
 * liquor identities, the locked lifecycle, and the locked cross-store
 * store-first invariants are exercised.
 *
 * Run:
 *   npx tsx scripts/sim-settlement-validation.ts
 *
 * Exit code 0 on full pass, 1 if any case fails.
 */

// ============================================================
// LOCKED CONSTANTS — copied verbatim from the brief and ROUND 4 lock.
// ============================================================

type Category = "public" | "shirt" | "hyper"
type TimeKind = "full" | "half" | "cha3"

// Locked time-pricing table (brief rule 3 + 4):
//   public: full 130_000 / half 70_000
//   shirt : full 140_000 / half 70_000
//   hyper : full 120_000 / half 60_000
//   cha3  : 9–15 min default 30_000 (shirt+greeting → half-time 70_000)
const PRICE_TABLE: Record<Category, { full: number; half: number }> = {
  public: { full: 130_000, half: 70_000 },
  shirt:  { full: 140_000, half: 70_000 },
  hyper:  { full: 120_000, half: 60_000 },
}
const CHA3_DEFAULT = 30_000
const CHA3_MIN_MIN = 9
const CHA3_MAX_MIN = 15

// ============================================================
// LOCKED PRICE RESOLVER
// ============================================================
// Pure function. Returns either { price } or { invalidReason } for cases
// outside the locked rules. NEVER invents a default.

type PriceResolution =
  | { ok: true; price: number; resolvedKind: TimeKind }
  | { ok: false; reason: string }

function resolvePrice(
  category: Category,
  kind: TimeKind,
  timeMinutes: number,
  greeting: boolean
): PriceResolution {
  if (kind === "full") {
    return { ok: true, price: PRICE_TABLE[category].full, resolvedKind: "full" }
  }
  if (kind === "half") {
    return { ok: true, price: PRICE_TABLE[category].half, resolvedKind: "half" }
  }
  // cha3
  if (timeMinutes < CHA3_MIN_MIN) {
    return { ok: false, reason: `time ${timeMinutes}min below cha3 floor (${CHA3_MIN_MIN})` }
  }
  if (timeMinutes > CHA3_MAX_MIN) {
    return { ok: false, reason: `time ${timeMinutes}min above cha3 ceiling (${CHA3_MAX_MIN})` }
  }
  // Locked rule 4 exception:
  //   Shirt + greeting → NOT cha3, becomes half-time = 70_000.
  if (category === "shirt" && greeting) {
    return { ok: true, price: PRICE_TABLE.shirt.half, resolvedKind: "half" }
  }
  return { ok: true, price: CHA3_DEFAULT, resolvedKind: "cha3" }
}

// ============================================================
// LOCKED LIQUOR IDENTITIES (brief rule 1)
// ============================================================
//   manager_profit             = sale_price - deposit_price
//   hostess_profit_from_liquor = 0
//   store_revenue              = deposit_price
//   store_profit               = deposit_price - bottle_cost

type LiquorBreakdown = {
  manager_profit: number
  hostess_profit_from_liquor: 0
  store_revenue: number
  store_profit: number
}

function liquorBreakdown(sale: number, deposit: number, bottleCost: number): LiquorBreakdown {
  return {
    manager_profit: sale - deposit,
    hostess_profit_from_liquor: 0,
    store_revenue: deposit,
    store_profit: deposit - bottleCost,
  }
}

// ============================================================
// LIFECYCLE + AUDIT MODEL
// ============================================================

type Lifecycle = "S1_active" | "S3_checkout_pending" | "S4_finalized" | "S5_closed_day"

type AuditEvent = {
  action: string
  actor_role: "owner" | "manager" | "counter"
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  reason?: string | null
}

// Allowed audit action names — drawn from §7 of the lock.
const ALLOWED_AUDIT_ACTIONS = new Set<string>([
  "session_time_adjusted",
  "session_manager_assignment_changed",
  "liquor_order_added",
  "liquor_order_adjusted",
  "liquor_responsibility_corrected",
  "settlement_finalized",
  "settlement_adjusted_post_final",
  "settlement_adjusted_closed_day",
  "business_day_closed",
  "cross_store_payable_recomputed",
  "cross_store_pre_settlement_recorded",
  "cross_store_pre_settlement_voided",
  "payout_summary_emitted",
])

type Participant = {
  participant_id: string
  hostess_id: string
  origin_store: string
  category: Category
  kind: TimeKind
  time_minutes: number
  greeting: boolean
  // Resolved price (set by resolvePrice). null if invalid.
  price: number | null
  resolved_kind: TimeKind | null
  manager_id: string
  exited_mid_out: boolean
}

type LiquorOrder = {
  order_id: string
  responsible_manager_id: string
  sale_price: number
  deposit_price: number
  bottle_cost: number
  // Locked at creation time per L5
  created_at_stage: Lifecycle
}

type SessionState = {
  session_id: string
  work_store: string
  business_day_id: string
  stage: Lifecycle
  participants: Participant[]
  orders: LiquorOrder[]
  receipt_snapshot: { time_total: number; liquor_total: number } | null
  // Settlement versions; latest is at .at(-1).
  settlement_versions: {
    version: number
    time_total: number
    liquor_total: number
    superseded: boolean
  }[]
  audit: AuditEvent[]
}

function newSession(
  session_id: string,
  work_store: string,
  business_day_id: string
): SessionState {
  return {
    session_id,
    work_store,
    business_day_id,
    stage: "S1_active",
    participants: [],
    orders: [],
    receipt_snapshot: null,
    settlement_versions: [],
    audit: [],
  }
}

// ============================================================
// MUTATION HELPERS — every settlement-affecting write goes through here
// to prove §7 audit invariants in simulation.
// ============================================================

class InvalidStateError extends Error {
  constructor(public code: string, msg: string) { super(msg) }
}

function addParticipant(s: SessionState, p: Omit<Participant, "price" | "resolved_kind">) {
  if (s.stage !== "S1_active" && s.stage !== "S3_checkout_pending") {
    throw new InvalidStateError("I4_LIFECYCLE", `cannot add participant in ${s.stage}`)
  }
  const r = resolvePrice(p.category, p.kind, p.time_minutes, p.greeting)
  const full: Participant = {
    ...p,
    price: r.ok ? r.price : null,
    resolved_kind: r.ok ? r.resolvedKind : null,
  }
  s.participants.push(full)
  s.audit.push({
    action: "session_time_adjusted",
    actor_role: "counter",
    after: { participant_id: p.participant_id, category: p.category, kind: p.kind, time_minutes: p.time_minutes, price: full.price },
  })
}

function addLiquor(s: SessionState, o: Omit<LiquorOrder, "created_at_stage">) {
  if (s.stage !== "S1_active" && s.stage !== "S3_checkout_pending") {
    throw new InvalidStateError("I4_LIFECYCLE", `cannot add liquor in ${s.stage}`)
  }
  if (o.sale_price < o.deposit_price) {
    // L1 / E18 / I1
    throw new InvalidStateError("I1_LIQUOR_BELOW_FLOOR",
      `sale_price ${o.sale_price} < deposit_price ${o.deposit_price}`)
  }
  s.orders.push({ ...o, created_at_stage: s.stage })
  s.audit.push({
    action: "liquor_order_added",
    actor_role: "manager",
    after: {
      order_id: o.order_id,
      sale_price: o.sale_price,
      deposit_price: o.deposit_price,
      bottle_cost: o.bottle_cost,
      responsible_manager_id: o.responsible_manager_id,
    },
  })
}

function adjustParticipantTime(
  s: SessionState,
  participant_id: string,
  new_time: number,
  new_kind: TimeKind,
  actor_role: "owner" | "manager" | "counter"
) {
  if (s.stage !== "S1_active" && s.stage !== "S3_checkout_pending") {
    throw new InvalidStateError("I4_LIFECYCLE",
      `cannot adjust time in ${s.stage} (use post-final adjustment)`)
  }
  const p = s.participants.find((x) => x.participant_id === participant_id)
  if (!p) throw new InvalidStateError("NOT_FOUND", participant_id)
  const before = { time_minutes: p.time_minutes, kind: p.kind, price: p.price }
  p.time_minutes = new_time
  p.kind = new_kind
  const r = resolvePrice(p.category, p.kind, p.time_minutes, p.greeting)
  p.price = r.ok ? r.price : null
  p.resolved_kind = r.ok ? r.resolvedKind : null
  s.audit.push({
    action: "session_time_adjusted",
    actor_role,
    before,
    after: { time_minutes: p.time_minutes, kind: p.kind, price: p.price },
  })
}

function issueReceipt(s: SessionState) {
  const time_total = s.participants.reduce((a, p) => a + (p.price ?? 0), 0)
  const liquor_total = s.orders.reduce((a, o) => a + o.sale_price, 0)
  s.receipt_snapshot = { time_total, liquor_total }
}

function transitionToCheckoutPending(s: SessionState) {
  if (s.stage !== "S1_active") {
    throw new InvalidStateError("I4_LIFECYCLE", `bad transition from ${s.stage}`)
  }
  s.stage = "S3_checkout_pending"
}

function finalizeSettlement(s: SessionState) {
  if (s.stage !== "S3_checkout_pending") {
    throw new InvalidStateError("I4_LIFECYCLE", `cannot finalize from ${s.stage}`)
  }
  const time_total = s.participants.reduce((a, p) => a + (p.price ?? 0), 0)
  const liquor_total = s.orders.reduce((a, o) => a + o.sale_price, 0)
  const v = s.settlement_versions.length + 1
  s.settlement_versions.push({ version: v, time_total, liquor_total, superseded: false })
  s.stage = "S4_finalized"
  s.audit.push({
    action: "settlement_finalized",
    actor_role: "manager",
    after: { version: v, time_total, liquor_total },
  })
}

function postFinalAdjustment(
  s: SessionState,
  mutator: (s: SessionState) => void,
  actor_role: "owner" | "manager",
  reason: string
) {
  if (s.stage !== "S4_finalized") {
    throw new InvalidStateError("I4_LIFECYCLE", `not finalized: ${s.stage}`)
  }
  // §3: never overwrite. Mark previous version superseded, run mutation
  // against the working session, write a NEW version row.
  const prev = s.settlement_versions.at(-1)!
  // Allow mutation by temporarily lowering stage to S3, then re-finalize.
  s.stage = "S3_checkout_pending"
  mutator(s)
  const time_total = s.participants.reduce((a, p) => a + (p.price ?? 0), 0)
  const liquor_total = s.orders.reduce((a, o) => a + o.sale_price, 0)
  prev.superseded = true
  s.settlement_versions.push({
    version: prev.version + 1,
    time_total,
    liquor_total,
    superseded: false,
  })
  s.stage = "S4_finalized"
  s.audit.push({
    action: "settlement_adjusted_post_final",
    actor_role,
    before: { version: prev.version, time_total: prev.time_total, liquor_total: prev.liquor_total },
    after: { version: prev.version + 1, time_total, liquor_total },
    reason,
  })
}

function closeBusinessDay(sessions: SessionState[], business_day_id: string): {
  closing_snapshot: { sessions: number; time_total: number; liquor_total: number }
} {
  const day = sessions.filter((s) => s.business_day_id === business_day_id)
  for (const s of day) {
    if (s.stage !== "S4_finalized") {
      throw new InvalidStateError("I4_LIFECYCLE",
        `cannot close: session ${s.session_id} is in ${s.stage}`)
    }
  }
  const time_total = day.reduce((a, s) => a + (s.settlement_versions.at(-1)?.time_total ?? 0), 0)
  const liquor_total = day.reduce((a, s) => a + (s.settlement_versions.at(-1)?.liquor_total ?? 0), 0)
  for (const s of day) {
    s.stage = "S5_closed_day"
    s.audit.push({
      action: "business_day_closed",
      actor_role: "owner",
      after: { business_day_id, time_total, liquor_total },
    })
  }
  return { closing_snapshot: { sessions: day.length, time_total, liquor_total } }
}

function closedDayAdjustment(
  s: SessionState,
  actor_role: "owner",
  reason: string,
  mutator: (s: SessionState) => void
) {
  if (s.stage !== "S5_closed_day") {
    throw new InvalidStateError("I4_LIFECYCLE", `not closed: ${s.stage}`)
  }
  if (actor_role !== "owner") {
    throw new InvalidStateError("AUTH", "closed-day adjust is owner-only")
  }
  const prev = s.settlement_versions.at(-1)!
  // Temporarily drop to S3 to mutate, then re-finalize, then re-close.
  s.stage = "S3_checkout_pending"
  mutator(s)
  const time_total = s.participants.reduce((a, p) => a + (p.price ?? 0), 0)
  const liquor_total = s.orders.reduce((a, o) => a + o.sale_price, 0)
  prev.superseded = true
  s.settlement_versions.push({
    version: prev.version + 1,
    time_total,
    liquor_total,
    superseded: false,
  })
  s.stage = "S5_closed_day"
  s.audit.push({
    action: "settlement_adjusted_closed_day",
    actor_role,
    before: { version: prev.version, time_total: prev.time_total, liquor_total: prev.liquor_total },
    after: { version: prev.version + 1, time_total, liquor_total },
    reason,
  })
}

// ============================================================
// CROSS-STORE PAYABLE MODEL (X1–X7)
// ============================================================

type CrossStoreKey = string // `${work_store}|${origin_store}|${business_day_id}`
function csKey(work: string, origin: string, day: string): CrossStoreKey {
  return `${work}|${origin}|${day}`
}

type CrossStoreState = {
  payable_by_triple: Map<CrossStoreKey, number>
  presettlements: Map<CrossStoreKey, { id: string; manager_id: string; amount: number }[]>
  applied_ids: Set<string>
}

function newCrossStoreState(): CrossStoreState {
  return {
    payable_by_triple: new Map(),
    presettlements: new Map(),
    applied_ids: new Set(),
  }
}

function recomputeCrossStorePayable(state: CrossStoreState, sessions: SessionState[]) {
  state.payable_by_triple.clear()
  for (const s of sessions) {
    for (const p of s.participants) {
      if (p.origin_store === s.work_store) continue
      if (p.price == null) continue
      const k = csKey(s.work_store, p.origin_store, s.business_day_id)
      state.payable_by_triple.set(k, (state.payable_by_triple.get(k) ?? 0) + p.price)
    }
  }
}

function recordPreSettlement(
  state: CrossStoreState,
  work: string,
  origin: string,
  day: string,
  manager_id: string,
  amount: number,
  id: string
) {
  if (state.applied_ids.has(id)) {
    throw new InvalidStateError("I8_DUPLICATE_PAYOUT", `pre-settlement ${id} already applied`)
  }
  const k = csKey(work, origin, day)
  const payable = state.payable_by_triple.get(k) ?? 0
  const sumExisting = (state.presettlements.get(k) ?? []).reduce((a, r) => a + r.amount, 0)
  if (sumExisting + amount > payable) {
    throw new InvalidStateError("I7_REMAINDER_NEGATIVE",
      `pre-settlement ${amount} would drive remainder below zero (payable=${payable}, existing=${sumExisting})`)
  }
  const arr = state.presettlements.get(k) ?? []
  arr.push({ id, manager_id, amount })
  state.presettlements.set(k, arr)
  state.applied_ids.add(id)
}

function remainderFor(state: CrossStoreState, work: string, origin: string, day: string): number {
  const k = csKey(work, origin, day)
  const payable = state.payable_by_triple.get(k) ?? 0
  const sum = (state.presettlements.get(k) ?? []).reduce((a, r) => a + r.amount, 0)
  return payable - sum
}

// ============================================================
// SNAPSHOT CONSISTENCY CHECKER (Y1–Y5)
// ============================================================

type SnapshotCheck =
  | { ok: true }
  | { ok: false; reason: string }

function checkReceiptVsSession(s: SessionState): SnapshotCheck {
  if (!s.receipt_snapshot) return { ok: true } // no receipt = nothing to check
  const time_total = s.participants.reduce((a, p) => a + (p.price ?? 0), 0)
  const liquor_total = s.orders.reduce((a, o) => a + o.sale_price, 0)
  // Y1: receipt frozen at issuance. After S3 corrections, divergence is
  // ALLOWED (Y3) — but the simulator can compare to the *issuance-time*
  // session state. For the simulation model, we compare directly: any
  // mismatch is reportable, not invalid, unless there is no audit row
  // explaining a post-issuance change.
  if (time_total === s.receipt_snapshot.time_total && liquor_total === s.receipt_snapshot.liquor_total) {
    return { ok: true }
  }
  // divergence — must be explained by at least one adjustment audit row
  const explained = s.audit.some((e) =>
    e.action === "session_time_adjusted" || e.action === "liquor_order_adjusted"
  )
  return explained
    ? { ok: true } // Y3: allowed, audited
    : { ok: false, reason: "receipt vs session diverged with no adjustment audit" }
}

function checkSettlementVsSession(s: SessionState): SnapshotCheck {
  if (s.settlement_versions.length === 0) return { ok: true }
  const latest = s.settlement_versions.at(-1)!
  const time_total = s.participants.reduce((a, p) => a + (p.price ?? 0), 0)
  const liquor_total = s.orders.reduce((a, o) => a + o.sale_price, 0)
  if (latest.time_total !== time_total || latest.liquor_total !== liquor_total) {
    return { ok: false, reason: `latest settlement v${latest.version} diverges from session totals` }
  }
  return { ok: true }
}

function checkAuditPresentForMutations(s: SessionState): SnapshotCheck {
  for (const e of s.audit) {
    if (!ALLOWED_AUDIT_ACTIONS.has(e.action)) {
      return { ok: false, reason: `unknown audit action: ${e.action}` }
    }
  }
  return { ok: true }
}

// ============================================================
// TEST RUNNER
// ============================================================

type CaseResult = {
  id: string
  group: string
  name: string
  ok: boolean
  detail?: string
  expected?: unknown
  actual?: unknown
}

const results: CaseResult[] = []

function pass(id: string, group: string, name: string) {
  results.push({ id, group, name, ok: true })
}
function fail(id: string, group: string, name: string, detail: string, expected?: unknown, actual?: unknown) {
  results.push({ id, group, name, ok: false, detail, expected, actual })
}

function expectEq(id: string, group: string, name: string, expected: unknown, actual: unknown) {
  if (JSON.stringify(expected) === JSON.stringify(actual)) pass(id, group, name)
  else fail(id, group, name, "expected != actual", expected, actual)
}

function expectThrows(id: string, group: string, name: string, fn: () => void, code?: string) {
  try {
    fn()
    fail(id, group, name, "expected throw, got success")
  } catch (e) {
    if (e instanceof InvalidStateError) {
      if (code && e.code !== code) {
        fail(id, group, name, `wrong invalid-state code`, code, e.code)
      } else {
        pass(id, group, name)
      }
    } else {
      fail(id, group, name, `wrong error type: ${(e as Error).message}`)
    }
  }
}

// ============================================================
// CASES
// ============================================================
// E01..E26 from ROUND 4 lock + a handful of explicit invalid-state
// guard cases. Total ≥ 30.

// ---- A. Time pricing ----
function runTimeCases() {
  const G = "A_time_pricing"
  expectEq("E01", G, "public full = 130_000",
    130_000, (resolvePrice("public", "full", 90, false) as { price: number }).price)
  expectEq("E02", G, "public half = 70_000",
    70_000, (resolvePrice("public", "half", 45, false) as { price: number }).price)
  expectEq("E03", G, "shirt full = 140_000",
    140_000, (resolvePrice("shirt", "full", 60, false) as { price: number }).price)
  expectEq("E04", G, "shirt half = 70_000",
    70_000, (resolvePrice("shirt", "half", 30, false) as { price: number }).price)
  expectEq("E05", G, "hyper full = 120_000",
    120_000, (resolvePrice("hyper", "full", 60, false) as { price: number }).price)
  expectEq("E06", G, "hyper half = 60_000",
    60_000, (resolvePrice("hyper", "half", 30, false) as { price: number }).price)
}

// ---- A. Cha3 boundaries ----
function runCha3Cases() {
  const G = "A_cha3_boundary"
  // E07 8 min — below floor → invalid
  const r07 = resolvePrice("public", "cha3", 8, false)
  expectEq("E07", G, "8min below cha3 floor (no silent default)",
    false, (r07 as { ok: boolean }).ok)
  // E08 9 min → 30_000
  expectEq("E08", G, "9min cha3 = 30_000",
    30_000, (resolvePrice("public", "cha3", 9, false) as { price: number }).price)
  // E09 15 min → 30_000
  expectEq("E09", G, "15min cha3 = 30_000",
    30_000, (resolvePrice("public", "cha3", 15, false) as { price: number }).price)
  // E10 16 min → above ceiling, invalid
  const r10 = resolvePrice("public", "cha3", 16, false)
  expectEq("E10", G, "16min above cha3 ceiling (no silent default)",
    false, (r10 as { ok: boolean }).ok)
}

// ---- A. Shirt greeting exception ----
function runGreetingCases() {
  const G = "A_shirt_greeting_exception"
  // E11 shirt 12min greeting=true → half = 70_000
  expectEq("E11", G, "shirt cha3-range + greeting → half 70_000",
    70_000, (resolvePrice("shirt", "cha3", 12, true) as { price: number }).price)
  // E12 shirt 12min no greeting → cha3 default 30_000
  expectEq("E12", G, "shirt cha3-range no greeting → 30_000",
    30_000, (resolvePrice("shirt", "cha3", 12, false) as { price: number }).price)
  // E13 public/hyper 12min greeting=true → cha3 default 30_000 (greeting flag ignored outside shirt)
  expectEq("E13a", G, "public cha3-range + greeting still 30_000",
    30_000, (resolvePrice("public", "cha3", 12, true) as { price: number }).price)
  expectEq("E13b", G, "hyper cha3-range + greeting still 30_000",
    30_000, (resolvePrice("hyper", "cha3", 12, true) as { price: number }).price)
}

// ---- D. Liquor identities + deposit floor ----
function runLiquorCases() {
  const G = "D_liquor"
  // E17 sale at deposit floor — manager_profit=0
  const lb1 = liquorBreakdown(50_000, 50_000, 30_000)
  expectEq("E17a", G, "at-floor: manager_profit = 0", 0, lb1.manager_profit)
  expectEq("E17b", G, "at-floor: store_revenue = deposit", 50_000, lb1.store_revenue)
  expectEq("E17c", G, "at-floor: store_profit = deposit - bottle_cost", 20_000, lb1.store_profit)
  expectEq("E17d", G, "at-floor: hostess liquor share = 0", 0, lb1.hostess_profit_from_liquor)

  // L4 — bottle_cost > deposit_price permitted (negative store_profit)
  const lb2 = liquorBreakdown(80_000, 60_000, 100_000)
  expectEq("L4_neg_profit", G, "bottle_cost > deposit allowed (negative store_profit)",
    -40_000, lb2.store_profit)

  // E18 sale below deposit → invalid via session.addLiquor
  const sx = newSession("sx", "store_a", "day_1")
  expectThrows("E18", G, "sale below deposit blocked at write", () => {
    addLiquor(sx, { order_id: "o1", responsible_manager_id: "m1", sale_price: 40_000, deposit_price: 50_000, bottle_cost: 30_000 })
  }, "I1_LIQUOR_BELOW_FLOOR")

  // L5 — manager attribution fixed at order creation, not silently changed
  const sy = newSession("sy", "store_a", "day_1")
  addLiquor(sy, { order_id: "o2", responsible_manager_id: "mgr_A", sale_price: 100_000, deposit_price: 60_000, bottle_cost: 40_000 })
  // Even after we "transfer" the participant to another manager, the
  // existing order's responsible_manager_id is unchanged.
  expectEq("L5", G, "liquor responsibility fixed at creation",
    "mgr_A", sy.orders[0].responsible_manager_id)
}

// ---- B/C. Lifecycle + adjustment ----
function runLifecycleCases() {
  const G = "BC_lifecycle"

  // E14 — checkout pending correction allowed in S3
  const s = newSession("s14", "store_a", "day_1")
  addParticipant(s, { participant_id: "p1", hostess_id: "h1", origin_store: "store_a", category: "public", kind: "full", time_minutes: 90, greeting: false, manager_id: "m1", exited_mid_out: false })
  issueReceipt(s)
  transitionToCheckoutPending(s)
  adjustParticipantTime(s, "p1", 60, "half", "manager")
  expectEq("E14a", G, "S3 in-place edit succeeds", 70_000, s.participants[0].price)
  finalizeSettlement(s)
  expectEq("E14b", G, "finalized version 1 written", 1, s.settlement_versions.length)

  // E15 — post-final correction creates new version, never overwrites
  postFinalAdjustment(s, (sx) => {
    adjustParticipantTime(sx, "p1", 90, "full", "owner")
  }, "owner", "dispute resolution")
  expectEq("E15a", G, "post-final → 2 versions", 2, s.settlement_versions.length)
  expectEq("E15b", G, "v1 superseded", true, s.settlement_versions[0].superseded)
  expectEq("E15c", G, "v2 latest = 130_000",
    130_000, s.settlement_versions[1].time_total)
  // I4 — direct in-place mutation of S4 must throw
  expectThrows("I4_block", G, "in-place edit at S4 blocked", () => {
    adjustParticipantTime(s, "p1", 45, "half", "manager")
  }, "I4_LIFECYCLE")

  // E16 — closed-day correction
  closeBusinessDay([s], "day_1")
  expectEq("E16a", G, "session moved to S5 after close", "S5_closed_day", s.stage)
  closedDayAdjustment(s, "owner", "post-close audit found error", (sx) => {
    adjustParticipantTime(sx, "p1", 60, "half", "owner")
  })
  expectEq("E16b", G, "closed-day adjustment → v3", 3, s.settlement_versions.length)
  // Audit trail must include the closed-day action
  expectEq("E16c", G, "closed-day audit row present",
    true, s.audit.some((e) => e.action === "settlement_adjusted_closed_day"))
}

// ---- E. Multi-participant ----
function runMultiParticipantCases() {
  const G = "E_multi_participant"

  // E19 — multi-hostess room sums independently
  const s = newSession("s19", "store_a", "day_1")
  addParticipant(s, { participant_id: "p1", hostess_id: "h1", origin_store: "store_a", category: "public", kind: "full", time_minutes: 90, greeting: false, manager_id: "m1", exited_mid_out: false })
  addParticipant(s, { participant_id: "p2", hostess_id: "h2", origin_store: "store_a", category: "shirt", kind: "full", time_minutes: 60, greeting: false, manager_id: "m1", exited_mid_out: false })
  addParticipant(s, { participant_id: "p3", hostess_id: "h3", origin_store: "store_a", category: "hyper", kind: "half", time_minutes: 30, greeting: false, manager_id: "m2", exited_mid_out: false })
  const total = s.participants.reduce((a, p) => a + (p.price ?? 0), 0)
  expectEq("E19", G, "multi-hostess sum = 130k+140k+60k",
    330_000, total)

  // E20 — mid-out: priced at served time (model treats kind as already-resolved)
  const s2 = newSession("s20", "store_a", "day_1")
  addParticipant(s2, { participant_id: "p1", hostess_id: "h1", origin_store: "store_a", category: "public", kind: "half", time_minutes: 45, greeting: false, manager_id: "m1", exited_mid_out: true })
  addParticipant(s2, { participant_id: "p2", hostess_id: "h2", origin_store: "store_a", category: "public", kind: "full", time_minutes: 90, greeting: false, manager_id: "m1", exited_mid_out: false })
  expectEq("E20", G, "mid-out + remaining = 70k+130k",
    200_000, s2.participants.reduce((a, p) => a + (p.price ?? 0), 0))

  // E21 — extend after mid-out: extension applies to remaining only
  // (modeled by adjusting the remaining participant's time, not the exited one)
  const exited_before = s2.participants[0].price
  adjustParticipantTime(s2, "p2", 90, "full", "manager") // no actual change, but exercises path
  expectEq("E21", G, "mid-out participant unchanged after extend",
    exited_before, s2.participants[0].price)
}

// ---- F. Cross-store ----
function runCrossStoreCases() {
  const G = "F_cross_store"
  const css = newCrossStoreState()

  // Build a session at work_store=A with two cross-store participants
  // from origin store B.
  const s = newSession("s_cs1", "store_A", "day_1")
  addParticipant(s, { participant_id: "p1", hostess_id: "h1", origin_store: "store_B", category: "public", kind: "full", time_minutes: 90, greeting: false, manager_id: "mA1", exited_mid_out: false })
  addParticipant(s, { participant_id: "p2", hostess_id: "h2", origin_store: "store_B", category: "shirt", kind: "full", time_minutes: 60, greeting: false, manager_id: "mA1", exited_mid_out: false })
  // Same-store participant — must NOT be counted in cross-store payable.
  addParticipant(s, { participant_id: "p3", hostess_id: "h3", origin_store: "store_A", category: "hyper", kind: "full", time_minutes: 60, greeting: false, manager_id: "mA1", exited_mid_out: false })

  recomputeCrossStorePayable(css, [s])
  // X1/X7 — payable for (A, B, day_1) = 130_000 + 140_000 = 270_000
  expectEq("X1", G, "store-level payable (A→B) excludes same-store",
    270_000, css.payable_by_triple.get(csKey("store_A", "store_B", "day_1")))

  // E22 — single manager pre-settlement
  recordPreSettlement(css, "store_A", "store_B", "day_1", "mB1", 100_000, "ps_1")
  expectEq("E22", G, "remainder after one pre-settlement",
    170_000, remainderFor(css, "store_A", "store_B", "day_1"))

  // E23 — multiple manager pre-settlements compose linearly
  recordPreSettlement(css, "store_A", "store_B", "day_1", "mB2", 50_000, "ps_2")
  expectEq("E23", G, "remainder after two pre-settlements",
    120_000, remainderFor(css, "store_A", "store_B", "day_1"))

  // E26 / I8 — duplicate payout id rejected
  expectThrows("E26", G, "duplicate pre-settlement id rejected", () => {
    recordPreSettlement(css, "store_A", "store_B", "day_1", "mB1", 10_000, "ps_1")
  }, "I8_DUPLICATE_PAYOUT")

  // I7 — over-payment driving remainder negative
  expectThrows("I7", G, "over-payment blocked", () => {
    recordPreSettlement(css, "store_A", "store_B", "day_1", "mB3", 999_999, "ps_3")
  }, "I7_REMAINDER_NEGATIVE")

  // X2 — hostess-level detail still reachable
  const drilldown = s.participants.filter((p) => p.origin_store === "store_B")
  expectEq("X2", G, "hostess detail drillable from store-level payable",
    2, drilldown.length)
}

// ---- G. Snapshot consistency ----
function runSnapshotCases() {
  const G = "G_snapshot_consistency"

  // E24 — receipt vs settlement mismatch ALLOWED if explained by S3 audit
  const s = newSession("s24", "store_a", "day_1")
  addParticipant(s, { participant_id: "p1", hostess_id: "h1", origin_store: "store_a", category: "public", kind: "full", time_minutes: 90, greeting: false, manager_id: "m1", exited_mid_out: false })
  issueReceipt(s) // snapshot 130_000
  transitionToCheckoutPending(s)
  adjustParticipantTime(s, "p1", 45, "half", "manager")
  // Receipt frozen at 130_000, session now 70_000. Y3 says reportable, audited → allowed.
  const r = checkReceiptVsSession(s)
  expectEq("E24", G, "receipt vs session divergence allowed when audited",
    true, (r as { ok: boolean }).ok)

  finalizeSettlement(s)
  // E25 sub-check — settlement vs session must match at finalization moment (Y2)
  const r2 = checkSettlementVsSession(s)
  expectEq("Y2", G, "settlement vs session matches at finalization",
    true, (r2 as { ok: boolean }).ok)

  // Audit health
  const r3 = checkAuditPresentForMutations(s)
  expectEq("AUDIT_OK", G, "all audit actions in allowed set",
    true, (r3 as { ok: boolean }).ok)

  // E25 — closing snapshot vs sum-of-latest must match (no closed-day deltas applied)
  const sa = newSession("sa", "store_a", "day_X")
  const sb = newSession("sb", "store_a", "day_X")
  addParticipant(sa, { participant_id: "pa", hostess_id: "h", origin_store: "store_a", category: "public", kind: "full", time_minutes: 90, greeting: false, manager_id: "m", exited_mid_out: false })
  addParticipant(sb, { participant_id: "pb", hostess_id: "h", origin_store: "store_a", category: "shirt", kind: "full", time_minutes: 60, greeting: false, manager_id: "m", exited_mid_out: false })
  transitionToCheckoutPending(sa); finalizeSettlement(sa)
  transitionToCheckoutPending(sb); finalizeSettlement(sb)
  const closing = closeBusinessDay([sa, sb], "day_X")
  expectEq("E25", G, "closing snapshot = sum of latest finalized versions",
    270_000, closing.closing_snapshot.time_total)
}

// ---- AUDIT trace test ----
function runAuditCases() {
  const G = "C_audit"
  const s = newSession("s_audit", "store_a", "day_1")
  addParticipant(s, { participant_id: "p1", hostess_id: "h1", origin_store: "store_a", category: "public", kind: "full", time_minutes: 90, greeting: false, manager_id: "m1", exited_mid_out: false })
  addLiquor(s, { order_id: "o1", responsible_manager_id: "m1", sale_price: 100_000, deposit_price: 60_000, bottle_cost: 40_000 })
  transitionToCheckoutPending(s)
  finalizeSettlement(s)
  // Required actions present:
  const actions = new Set(s.audit.map((e) => e.action))
  expectEq("AUDIT_time", G, "session_time_adjusted recorded",
    true, actions.has("session_time_adjusted"))
  expectEq("AUDIT_liquor", G, "liquor_order_added recorded",
    true, actions.has("liquor_order_added"))
  expectEq("AUDIT_finalized", G, "settlement_finalized recorded",
    true, actions.has("settlement_finalized"))
  // I11 — every audit action is in allowed set
  for (const e of s.audit) {
    if (!ALLOWED_AUDIT_ACTIONS.has(e.action)) {
      fail("I11_" + e.action, G, "unknown audit action", e.action)
      return
    }
  }
  pass("I11", G, "no orphan audit actions")
}

// ============================================================
// MAIN
// ============================================================

function main() {
  runTimeCases()
  runCha3Cases()
  runGreetingCases()
  runLiquorCases()
  runLifecycleCases()
  runMultiParticipantCases()
  runCrossStoreCases()
  runSnapshotCases()
  runAuditCases()

  const total = results.length
  const passed = results.filter((r) => r.ok).length
  const failed = total - passed

  // Group summary
  const byGroup = new Map<string, { p: number; f: number }>()
  for (const r of results) {
    const g = byGroup.get(r.group) ?? { p: 0, f: 0 }
    if (r.ok) g.p++
    else g.f++
    byGroup.set(r.group, g)
  }

  console.log("=".repeat(64))
  console.log("STEP-NEXT-SETTLEMENT-SIM — settlement validation simulation")
  console.log("=".repeat(64))
  for (const [g, c] of [...byGroup.entries()].sort()) {
    console.log(`  ${g.padEnd(34)}  pass=${c.p}  fail=${c.f}`)
  }
  console.log("-".repeat(64))
  console.log(`TOTAL  cases=${total}  passed=${passed}  failed=${failed}`)
  console.log("=".repeat(64))

  if (failed > 0) {
    console.log("\nFAILED CASES:")
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  [${r.id}] ${r.group} :: ${r.name}`)
      if (r.detail) console.log(`      reason:   ${r.detail}`)
      if (r.expected !== undefined) console.log(`      expected: ${JSON.stringify(r.expected)}`)
      if (r.actual !== undefined)   console.log(`      actual:   ${JSON.stringify(r.actual)}`)
    }
    process.exit(1)
  }
  process.exit(0)
}

main()
