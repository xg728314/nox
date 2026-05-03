/**
 * Shared in-memory auth resolution cache.
 *
 * P0-1 (perf recovery round):
 *   Before: every protected page hit made **2 Supabase round-trips**
 *   inside `middleware.ts` (auth.getUser + store_memberships), and every
 *   API call additionally made **3 Supabase round-trips** inside
 *   `resolveAuthContext` (auth.getUser + store_memberships +
 *   user_global_roles). With cross-region (Vercel iad1 ↔ Supabase icn1)
 *   each RTT was ~200 ms, so a single bootstrap with 7 upstream loopbacks
 *   accumulated **21 auth-only RTTs ≈ 4 seconds** before doing any real
 *   work.
 *
 *   After: token → resolved auth bundle cached for {@link TTL_MS} within
 *   a warm function instance. On hit, zero Supabase round-trips; the
 *   caller uses the cached fields as-is. Same behavioural outcome
 *   (identical AuthContext shape), only the network path is skipped.
 *
 *   Scope:
 *     - Process-scoped: a module-level `Map` lives in the function
 *       instance. Cold starts naturally empty the cache; that is fine.
 *     - Not shared between middleware and API routes (they run in
 *       different processes on Vercel), but each process caches its
 *       own repeated calls. Within a bootstrap's Promise.all (7 upstream
 *       loopbacks), if they land in the same warm API-route instance
 *       (high probability), the later six hit the cache set by the first.
 *     - Cache key = raw access token. Two clients with the same token
 *       resolve to the same bundle, which is the correct semantics.
 *
 *   Safety:
 *     - TTL capped at {@link TTL_MS}. ROUND-CLEANUP-002: tightened from
 *       60 s → 15 s so revocation / role change / must_change_password
 *       flips are visible within seconds instead of a minute.
 *     - Explicit invalidation hooks (`invalidateAuthCache`,
 *       `invalidateAuthCacheByUserId`) are called by logout + change-password
 *       paths so the stale window collapses to 0 for those events.
 *     - Entries are evicted eagerly on TTL expiry and passively when
 *       the cache exceeds a hard cap (prevents unbounded growth on
 *       token-rotation misuse).
 *     - Never caches error outcomes — on failure, the caller throws and
 *       the next call re-attempts auth (no denial-of-service amplification).
 *
 *   CRITICAL: the cache stores only AUTHORIZED identities. An attacker
 *   who somehow obtains a valid cookie still has to produce the exact
 *   token string that originally authenticated; there is no
 *   privilege-escalation surface here.
 */

export type CachedAuth = {
  user_id: string
  membership_id: string
  store_uuid: string
  role: "owner" | "manager" | "waiter" | "staff" | "hostess"
  membership_status: "approved" | "pending" | "rejected" | "suspended"
  global_roles: string[]
  is_super_admin: boolean
  /**
   * Forced-password-change gate mirrored from `profiles.must_change_password`.
   * Added in the invite-flow round (057). Cached so middleware does not
   * need to re-query profiles on warm hits.
   */
  must_change_password: boolean
}

type Entry = CachedAuth & { expiresAt: number }

// ROUND-CLEANUP-002: 60_000 → 15_000. Revocation latency 를 15s 로 축소.
// 2026-05-03 R-Speed-x10: 15_000 → 60_000.
//   사용자 호소 "사용 안 할 때 40분만에 로그아웃 + 응답 너무 느림".
//   auth cache miss = 3 RTT (auth.getUser + memberships + global_roles).
//   카운터 5s 폴링 패턴에서 15s 마다 cache miss → 매분 4번 cold path.
//   60s TTL 로 늘리면 매분 1번만 cold path → 75% 감소.
//   Logout / change-password 가 explicit invalidate 호출하므로 revocation
//   latency 도 사실상 0s 유지 (TTL 은 idle 만료 fallback).
const TTL_MS = 60_000
const MAX_ENTRIES = 500

const cache = new Map<string, Entry>()

/**
 * Look up a token. Returns the cached auth bundle if fresh, else null.
 * Expired entries are deleted on access (lazy eviction).
 */
export function getCachedAuth(token: string): CachedAuth | null {
  const entry = cache.get(token)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    cache.delete(token)
    return null
  }
  // Do not mutate LRU position — insertion order is sufficient for the
  // simple size-cap eviction below, and touching Map on hit wastes cycles.
  const { expiresAt: _ignored, ...payload } = entry
  void _ignored
  return payload
}

/**
 * Populate the cache for a verified token. Callers invoke this ONLY
 * after a successful Supabase auth+membership resolution, so only
 * valid identities are ever cached.
 */
export function setCachedAuth(token: string, data: CachedAuth): void {
  cache.set(token, { ...data, expiresAt: Date.now() + TTL_MS })
  // Oldest-first eviction when the cap is exceeded. Map iteration order
  // is insertion order in JS, so `keys().next().value` is the oldest.
  if (cache.size > MAX_ENTRIES) {
    const first = cache.keys().next().value
    if (typeof first === "string") cache.delete(first)
  }
}

/**
 * ROUND-CLEANUP-002: explicit invalidation for a single token.
 * Called by `/api/auth/logout` before clearing the cookie so a stolen
 * warm-instance cache can't outlive the logout action.
 * Safe to call when the token isn't cached (no-op).
 */
export function invalidateAuthCache(token: string): void {
  if (!token) return
  cache.delete(token)
}

/**
 * ROUND-CLEANUP-002: invalidate every entry belonging to a user.
 * Called by `/api/auth/change-password` after a successful password update
 * + must_change_password flip, so later requests re-resolve fresh auth.
 * Linear scan of the cache — acceptable given MAX_ENTRIES=500 cap.
 */
export function invalidateAuthCacheByUserId(userId: string): void {
  if (!userId) return
  for (const [token, entry] of cache) {
    if (entry.user_id === userId) cache.delete(token)
  }
}

/** Test-only utility. Not called by production code. */
export function _clearAuthCacheForTests(): void {
  cache.clear()
}
