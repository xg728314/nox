/**
 * Durable (DB-backed) rate limiter — SECURITY (R-7 remediation).
 *
 * The legacy `rateLimit()` in `lib/security/guards.ts` is process-
 * local only. On Vercel / any multi-instance deployment each
 * invocation can land on a fresh container that has never seen the
 * user before, so the in-memory counter resets to 0 and the limit
 * is trivially bypassed by an attacker who keeps spinning up
 * parallel requests.
 *
 * This helper wraps the existing `tickAttempt()` / `auth_rate_limits`
 * table pipeline with a call-site-friendly return shape that matches
 * the legacy `rateLimit()` API. Callers can drop it in as the
 * PRIMARY (durable) check and keep `rateLimit()` as a fast-path
 * pre-filter if they want.
 *
 * FAIL-CLOSED: when the DB tick call throws we return
 * `{ ok: false, retryAfter: 0, reason: "db_error" }` so callers
 * surface a 5xx instead of silently allowing the request. This
 * matches the behaviour of the existing login / OTP verify paths.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { tickAttempt, type RateLimitAction } from "@/lib/security/authRateLimit"

export type DurableRateLimitResult =
  | { ok: true;  attemptCount: number }
  | { ok: false; retryAfter: number; reason: "window_exceeded" | "locked" | "db_error" }

export async function rateLimitDurable(
  supabase: SupabaseClient,
  args: {
    key: string
    action: RateLimitAction
    limit: number
    windowSeconds: number
  },
): Promise<DurableRateLimitResult> {
  try {
    const result = await tickAttempt(supabase, {
      key: args.key,
      action: args.action,
      windowSeconds: args.windowSeconds,
      maxAttempts: args.limit,
    })
    if (result.blocked) {
      return {
        ok: false,
        retryAfter: result.retryAfterSeconds,
        reason: result.reason ?? "window_exceeded",
      }
    }
    return { ok: true, attemptCount: result.attemptCount }
  } catch {
    // FAIL CLOSED. Every caller handles !ok as "return 429" or "return
    // 503 security state unavailable" depending on the endpoint.
    return { ok: false, retryAfter: 1, reason: "db_error" }
  }
}
