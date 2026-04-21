/**
 * Context-aware hostess match helper — PURE function.
 *
 * Successor to nameMatcher.ts. Consumes structured candidate rows from
 * /api/store/staff?role=hostess (enriched branch) and combines name
 * similarity with same-store / same-manager / activity signals.
 *
 * SAFETY CONTRACT (LOCKED):
 *   - Pure, no React, no network, no side effects.
 *   - NEVER mutates the participant or replaces external_name.
 *   - NEVER auto-promotes a suggestion to real membership.
 *   - Output is metadata-only overlay; server truth always wins.
 *   - If structured fetch fails or candidate list is empty/mis-shaped,
 *     caller should fall back to nameMatcher.ts (plain name-only).
 *
 * SCORING (LOCKED):
 *   base:  exact=100, fuzzy(d=1)=70, d>=2 → REJECT
 *   + same_store      +25
 *   + same_manager    +15
 *   + active_today    +10
 *   + recent_score    +0..10 (clamped)
 *
 * CLASSIFICATION RULES:
 *   1. If any candidate has distance=0 (exact name), ONLY exact candidates
 *      compete. Context ranks among them. Fuzzy never beats exact.
 *   2. If no exact, candidates at distance=1 compete. Context breaks ties.
 *   3. Distance ≥ 2 is rejected regardless of context — context never
 *      upgrades a far-away name into a suggestion.
 *   4. Top-scoring tie (materially equal totals) → CONFLICT.
 *   5. No candidate qualifies → NONE.
 *
 * CROSS-STORE VISIBILITY:
 *   - A candidate may have store_uuid !== currentStoreUuid. It MAY still
 *     score (so a transferred hostess can match), but the returned
 *     `cross_store` flag signals the UI to suppress store / manager /
 *     activity details for that candidate.
 */

import { computeNameMatch, matchStateLabel, type MatchState } from "./nameMatcher"

export type HostessMatchCandidate = {
  membership_id: string
  name: string
  normalized_name: string
  store_uuid: string | null
  store_name: string | null
  manager_membership_id: string | null
  manager_name: string | null
  is_active_today: boolean | null
  recent_assignment_score: number | null
}

export type HostessMatchContext = {
  currentStoreUuid: string | null
  currentManagerMembershipId: string | null
}

export type ScoredCandidate = {
  candidate: HostessMatchCandidate
  distance: number
  base: number
  bonuses: {
    same_store: number
    same_manager: number
    active_today: number
    recent: number
  }
  total: number
  cross_store: boolean
}

export type HostessMatchResult = {
  state: MatchState
  /** Best-ranked scored candidate (first of tied when CONFLICT). */
  best?: ScoredCandidate
  /** All tied top-scored candidates. Length ≥ 2 only when CONFLICT. */
  top: ScoredCandidate[]
  /** All non-rejected scored candidates, ranked high → low. */
  ranked: ScoredCandidate[]
}

// ── Helpers ────────────────────────────────────────────────────────

function normalize(s: string): string {
  return (s ?? "").replace(/\s+/g, "").trim()
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const m = a.length, n = b.length
  let prev: number[] = new Array(n + 1)
  let curr: number[] = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    const ai = a.charCodeAt(i - 1)
    for (let j = 1; j <= n; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    const tmp = prev; prev = curr; curr = tmp
  }
  return prev[n]
}

function looksStructured(c: unknown): c is HostessMatchCandidate {
  if (!c || typeof c !== "object") return false
  const r = c as Record<string, unknown>
  return typeof r.membership_id === "string" && typeof r.name === "string"
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Compute context-aware match for `name` against a structured candidate
 * pool. If the pool is not structured (plain strings or invalid), falls
 * back to name-only matching from nameMatcher.ts.
 */
export function computeHostessMatch(
  name: string,
  pool: readonly HostessMatchCandidate[] | readonly string[],
  ctx: HostessMatchContext,
  maxDistance = 1
): HostessMatchResult {
  const target = normalize(name)
  if (!target || !pool || pool.length === 0) {
    return { state: "NONE", top: [], ranked: [] }
  }

  // Fallback — if the pool is not structured, delegate to plain matcher
  // and project into this shape with empty context info.
  const structured = pool.every((p) => looksStructured(p)) as boolean
  if (!structured) {
    const plainNames = (pool as readonly string[]).map((s) => String(s))
    const r = computeNameMatch(name, plainNames, maxDistance)
    return {
      state: r.state,
      top: [],
      ranked: [],
      best: r.suggested
        ? {
            candidate: {
              membership_id: "",
              name: r.suggested,
              normalized_name: normalize(r.suggested),
              store_uuid: null,
              store_name: null,
              manager_membership_id: null,
              manager_name: null,
              is_active_today: null,
              recent_assignment_score: null,
            },
            distance: r.distance,
            base: r.distance === 0 ? 100 : 70,
            bonuses: { same_store: 0, same_manager: 0, active_today: 0, recent: 0 },
            total: r.distance === 0 ? 100 : 70,
            cross_store: false,
          }
        : undefined,
    }
  }

  const cands = pool as readonly HostessMatchCandidate[]
  const scored: ScoredCandidate[] = []

  for (const c of cands) {
    const cn = normalize(c.normalized_name || c.name)
    if (!cn) continue
    // Length gate (optimization; distance >= |Δlen|).
    if (Math.abs(cn.length - target.length) > maxDistance) continue
    const d = editDistance(target, cn)
    // Distance ≥ 2 rejected outright — context NEVER upgrades.
    if (d > maxDistance) continue

    const base = d === 0 ? 100 : 70
    const same_store =
      ctx.currentStoreUuid && c.store_uuid && c.store_uuid === ctx.currentStoreUuid
        ? 25
        : 0
    const same_manager =
      ctx.currentManagerMembershipId &&
      c.manager_membership_id &&
      c.manager_membership_id === ctx.currentManagerMembershipId
        ? 15
        : 0
    const active_today = c.is_active_today ? 10 : 0
    const recent = Math.max(0, Math.min(10, c.recent_assignment_score ?? 0))
    const total = base + same_store + same_manager + active_today + recent
    const cross_store =
      !!ctx.currentStoreUuid && !!c.store_uuid && c.store_uuid !== ctx.currentStoreUuid

    scored.push({
      candidate: c,
      distance: d,
      base,
      bonuses: { same_store, same_manager, active_today, recent },
      total,
      cross_store,
    })
  }

  if (scored.length === 0) return { state: "NONE", top: [], ranked: [] }

  // Exact-precedence gate: fuzzy NEVER beats exact.
  const hasExact = scored.some((s) => s.distance === 0)
  const pool2 = hasExact ? scored.filter((s) => s.distance === 0) : scored

  // Rank high → low on total, break ties by lower distance first.
  pool2.sort((a, b) => (b.total - a.total) || (a.distance - b.distance))

  const topScore = pool2[0].total
  const top = pool2.filter((s) => s.total === topScore)

  let state: MatchState
  if (top.length === 1) {
    state = hasExact && top[0].distance === 0 ? "EXACT" : "POSSIBLE"
  } else {
    // Material tie at the top → require manager confirmation.
    state = "CONFLICT"
  }

  return { state, best: top[0], top, ranked: pool2 }
}

// Re-export label helper for UI convenience.
export { matchStateLabel }
export type { MatchState }
