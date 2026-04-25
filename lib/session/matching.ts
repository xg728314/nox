/**
 * Name matching utilities for participant ↔ hostess matching.
 *
 * Rules:
 *  - Exact match → "matched" (auto-confirm)
 *  - Similar names (Levenshtein ≤ threshold) → "review_needed" (manual review)
 *  - No match → "unmatched"
 */

/** Levenshtein edit distance between two strings */
export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m

  // Use single-row DP for memory efficiency
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const curr = [i]
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1])
    }
    prev = curr
  }
  return prev[n]
}

/**
 * Find similar names from a set, sorted by edit distance.
 * Threshold: ≤1 for names up to 3 chars, ≤2 for longer names.
 * Returns up to `maxResults` candidate names.
 */
export function findSimilarNames(
  input: string,
  nameSet: Set<string>,
  maxResults = 3
): string[] {
  if (!input || input.length === 0) return []
  const threshold = input.length <= 3 ? 1 : 2
  const candidates: { name: string; dist: number }[] = []

  for (const name of nameSet) {
    if (name === input) continue // exact match handled separately
    // Early exit: if length difference exceeds threshold, skip
    if (Math.abs(name.length - input.length) > threshold) continue
    const dist = levenshtein(input, name)
    if (dist <= threshold) {
      candidates.push({ name, dist })
    }
  }

  return candidates
    .sort((a, b) => a.dist - b.dist)
    .slice(0, maxResults)
    .map((c) => c.name)
}

/**
 * Determine match status and candidates for a given name against a hostess name set.
 *
 * Returns: { status, candidates }
 *  - "matched" + [] if exact match
 *  - "review_needed" + [similar names] if similar found
 *  - "unmatched" + [] if no match at all
 */
export function resolveMatchStatus(
  name: string | null | undefined,
  hostessNameSet: Set<string>
): { status: "matched" | "review_needed" | "unmatched"; candidates: string[] } {
  if (!name || name.length === 0) {
    return { status: "unmatched", candidates: [] }
  }
  if (hostessNameSet.has(name)) {
    return { status: "matched", candidates: [] }
  }
  const similar = findSimilarNames(name, hostessNameSet)
  if (similar.length > 0) {
    return { status: "review_needed", candidates: similar }
  }
  return { status: "unmatched", candidates: [] }
}
