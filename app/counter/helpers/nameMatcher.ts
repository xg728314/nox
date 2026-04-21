/**
 * Staff name match helper — PURE function, no React, no network.
 *
 * Returns one of four states for a parsed/entered Korean name compared
 * against a pool of known hostess names from the same store.
 *
 * State semantics (LOCKED by spec):
 *   EXACT     — exact normalized match against exactly one pool name.
 *   POSSIBLE  — fuzzy match suggests a single likely name.
 *   CONFLICT  — fuzzy match suggests multiple equally-likely names.
 *   NONE      — nothing close enough.
 *
 * Safety contract:
 *   - This helper NEVER mutates the participant. It returns metadata
 *     only. The caller (UI) renders an indicator and offers existing
 *     correction paths (inline name input, setup sheet). The original
 *     entered name is the source of truth.
 *
 * Distance metric:
 *   - Levenshtein (edit) distance over Korean syllables (codepoints).
 *   - Threshold tuned for short Korean names (2–3 syllables): a single
 *     character substitution (예: "미자" ↔ "미지") qualifies as POSSIBLE
 *     but not EXACT.
 */

export type MatchState = "EXACT" | "POSSIBLE" | "CONFLICT" | "NONE"

export type MatchResult = {
  state: MatchState
  /** Best candidate (POSSIBLE / EXACT / CONFLICT — first of tied). */
  suggested?: string
  /** All equally-best candidates. Length ≥ 2 only when state = CONFLICT. */
  candidates: string[]
  /** Edit distance to suggested (0 for EXACT, 1+ for POSSIBLE/CONFLICT). */
  distance: number
}

/** Normalize for comparison: trim, drop spaces. */
function normalize(s: string): string {
  return (s ?? "").replace(/\s+/g, "").trim()
}

/** Standard Levenshtein over UTF-16 code units (sufficient for hangul syllables). */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const m = a.length
  const n = b.length
  // Rolling row optimization.
  let prev: number[] = new Array(n + 1)
  let curr: number[] = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    const ai = a.charCodeAt(i - 1)
    for (let j = 1; j <= n; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(
        prev[j] + 1,        // deletion
        curr[j - 1] + 1,    // insertion
        prev[j - 1] + cost  // substitution
      )
    }
    const tmp = prev; prev = curr; curr = tmp
  }
  return prev[n]
}

/**
 * Compute match state of `name` against a pool of known hostess names.
 *
 * @param name      Newly entered / parsed name.
 * @param pool      Known hostess names (same store; deduplicated by caller).
 * @param maxDistance  Threshold above which candidates are ignored.
 *                     Defaults to 1 — appropriate for 2–3 syllable Korean
 *                     names where "미자/미지" or "은지/은저" should still
 *                     surface as POSSIBLE candidates.
 */
export function computeNameMatch(
  name: string,
  pool: readonly string[],
  maxDistance = 1
): MatchResult {
  const target = normalize(name)
  if (!target) return { state: "NONE", candidates: [], distance: 0 }
  const cleanPool: string[] = []
  for (const p of pool) {
    const np = normalize(p)
    if (np) cleanPool.push(np)
  }
  if (cleanPool.length === 0) return { state: "NONE", candidates: [], distance: 0 }

  // First pass — exact normalized match.
  const exactMatches = cleanPool.filter((p) => p === target)
  if (exactMatches.length === 1) {
    return { state: "EXACT", suggested: exactMatches[0], candidates: [exactMatches[0]], distance: 0 }
  }
  if (exactMatches.length > 1) {
    // Multiple identical normalized names → ambiguous, treat as CONFLICT.
    return { state: "CONFLICT", suggested: exactMatches[0], candidates: exactMatches, distance: 0 }
  }

  // Fuzzy pass — keep only the minimum-distance candidates within the threshold.
  let bestDistance = Infinity
  const distances: Array<{ name: string; d: number }> = []
  for (const p of cleanPool) {
    // Skip wildly different lengths early — distance >= |Δlen|.
    if (Math.abs(p.length - target.length) > maxDistance) continue
    const d = editDistance(target, p)
    if (d < bestDistance) bestDistance = d
    distances.push({ name: p, d })
  }
  if (!Number.isFinite(bestDistance) || bestDistance > maxDistance) {
    return { state: "NONE", candidates: [], distance: 0 }
  }
  const candidates = distances.filter((x) => x.d === bestDistance).map((x) => x.name)
  if (candidates.length === 1) {
    return { state: "POSSIBLE", suggested: candidates[0], candidates, distance: bestDistance }
  }
  return { state: "CONFLICT", suggested: candidates[0], candidates, distance: bestDistance }
}

/** Korean UI label per state. */
export function matchStateLabel(state: MatchState): string {
  switch (state) {
    case "EXACT":    return "이름 일치"
    case "POSSIBLE": return "후보 있음"
    case "CONFLICT": return "확정 필요"
    case "NONE":     return "매칭 없음"
  }
}
