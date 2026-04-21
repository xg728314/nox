/**
 * STEP-013C: lightweight API hardening primitives.
 *
 * This module is intentionally tiny and in-memory — NOX runs as a single
 * Next.js process per store cluster in the current MVP topology, so a
 * process-local LRU is enough to stop double-clicks and crude abuse
 * without adding Redis/KV infrastructure. The helpers are safe to upgrade
 * to a shared backend later: the contracts (bool or throw) do not change.
 *
 * Helpers provided:
 *   - parseUuid(v)           → string | null
 *   - parsePositiveAmount(v) → number | null   (finite, > 0, ≤ AMOUNT_MAX)
 *   - parseBoundedString(v)  → string | null   (trimmed, ≤ max length)
 *   - rateLimit(key, {limit, windowMs})
 *       → { ok: true } | { ok: false, retryAfter: number }
 *   - duplicateGuard(key, windowMs)
 *       → { ok: true } | { ok: false, retryAfter: number }
 *   - MEMO_MAX, CROSS_STORE_MAX_ITEMS, AMOUNT_MAX constants
 *
 * None of these replace resolveAuthContext or DB-level scoping; they are
 * a front-line layer that short-circuits obviously bad inputs and abuse
 * before the request touches Supabase.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const AMOUNT_MAX = 1_000_000_000 // 10억원 — any payout above is almost certainly tampering
export const MEMO_MAX = 500
export const CROSS_STORE_MAX_ITEMS = 200

export function parseUuid(v: unknown): string | null {
  return typeof v === "string" && UUID_REGEX.test(v) ? v : null
}

export function parsePositiveAmount(v: unknown, max: number = AMOUNT_MAX): number | null {
  const n = typeof v === "number" ? v : Number(v)
  if (!Number.isFinite(n)) return null
  if (n <= 0) return null
  if (n > max) return null
  return n
}

export function parseBoundedString(v: unknown, max: number = MEMO_MAX): string | null {
  if (v == null) return null
  if (typeof v !== "string") return null
  const trimmed = v.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > max) return null
  return trimmed
}

// ── in-memory rate limiter ────────────────────────────────────────────
type Bucket = { count: number; resetAt: number }
const rlMap = new Map<string, Bucket>()
const RL_MAX_ENTRIES = 10_000

function gcRateLimit(now: number) {
  if (rlMap.size < RL_MAX_ENTRIES) return
  for (const [k, b] of rlMap) {
    if (b.resetAt <= now) rlMap.delete(k)
    if (rlMap.size < RL_MAX_ENTRIES / 2) break
  }
}

export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number }
): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now()
  gcRateLimit(now)
  const b = rlMap.get(key)
  if (!b || b.resetAt <= now) {
    rlMap.set(key, { count: 1, resetAt: now + opts.windowMs })
    return { ok: true }
  }
  if (b.count >= opts.limit) {
    return { ok: false, retryAfter: Math.max(0, b.resetAt - now) }
  }
  b.count += 1
  return { ok: true }
}

// ── duplicate-submit guard (short idempotency window) ─────────────────
const dupMap = new Map<string, number>() // key → expiresAt

export function duplicateGuard(
  key: string,
  windowMs: number
): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now()
  // piggyback GC
  if (dupMap.size > RL_MAX_ENTRIES) {
    for (const [k, exp] of dupMap) if (exp <= now) dupMap.delete(k)
  }
  const exp = dupMap.get(key)
  if (exp && exp > now) {
    return { ok: false, retryAfter: exp - now }
  }
  dupMap.set(key, now + windowMs)
  return { ok: true }
}

// ── cheap payload hash for duplicate keys (not cryptographic) ─────────
export function cheapHash(input: string): string {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}
