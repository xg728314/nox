/**
 * In-process per-gateway rate limiter for BLE ingest.
 *
 * Max 10 requests / 1 second / gateway_id (task spec §8).
 * In-memory sliding window — acceptable for this round because:
 *   - BLE ingest endpoint is region-local; a single Node instance
 *     typically handles a venue.
 *   - Multi-instance deployments can upgrade to a shared store (Redis /
 *     Postgres) later without changing the call site.
 *
 * The keyed identifier is `x-gateway-id` (pre-auth). This protects the
 * gateway-lookup query from brute-force and amplification attacks even
 * before HMAC verification.
 */

const WINDOW_MS = 1_000
const MAX_PER_WINDOW = 10

// Map<gateway_id, Array<timestamp_ms>>
const buckets = new Map<string, number[]>()

// Lightweight periodic compaction — drop empty arrays so the map does
// not leak memory across many distinct gateway ids.
let lastCompactAt = 0
function compactIfNeeded(now: number) {
  if (now - lastCompactAt < 60_000) return
  lastCompactAt = now
  for (const [k, arr] of buckets) {
    const trimmed = arr.filter(t => now - t < WINDOW_MS)
    if (trimmed.length === 0) buckets.delete(k)
    else buckets.set(k, trimmed)
  }
}

export type RateLimitDecision = {
  allowed: boolean
  /** How many requests the caller has made in the current window (AFTER
   *  this call is counted, if allowed). */
  count: number
  limit: number
  windowMs: number
}

export function allowBleRequest(gatewayId: string): RateLimitDecision {
  const now = Date.now()
  compactIfNeeded(now)
  const prev = buckets.get(gatewayId) ?? []
  const trimmed = prev.filter(t => now - t < WINDOW_MS)
  if (trimmed.length >= MAX_PER_WINDOW) {
    buckets.set(gatewayId, trimmed)
    return { allowed: false, count: trimmed.length, limit: MAX_PER_WINDOW, windowMs: WINDOW_MS }
  }
  trimmed.push(now)
  buckets.set(gatewayId, trimmed)
  return { allowed: true, count: trimmed.length, limit: MAX_PER_WINDOW, windowMs: WINDOW_MS }
}

/** Test helper — reset limiter state. */
export function _resetBleRateLimiter(): void {
  buckets.clear()
  lastCompactAt = 0
}
