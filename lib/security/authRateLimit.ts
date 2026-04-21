import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * STEP-SEC-1: durable auth rate-limit / lockout / cooldown helpers.
 *
 * Backed by `auth_rate_limits` (table) + 3 atomic RPCs:
 *   - auth_rl_tick_attempt   : rolling-window request counter (login)
 *   - auth_rl_record_failure : failure counter + lockout (otp_verify)
 *   - auth_rl_clear          : reset counters+lock+cooldown on success
 *
 * Cooldown state (otp_resend) is read/written directly via table ops.
 *
 * FAIL-CLOSED CONTRACT: every function THROWS on DB error. Callers MUST
 * catch and reject the request with 5xx — NEVER bypass to permissive
 * behavior when security state is unreadable.
 */

/**
 * Allowed `action` strings stored in `auth_rate_limits.action`.
 *
 * SECURITY (R-7 remediation): expanded from the original 4-value
 * auth-only union so EVERY sensitive endpoint can enforce
 * distributed, durable rate limits via the same table — not just
 * login/OTP. The `action` column is plain `text` in the DB, so
 * widening this union is a code-only change.
 */
export type RateLimitAction =
  | "login"
  | "login_email"
  | "login_mfa"
  | "otp_verify"
  | "otp_resend"
  | "signup"
  | "reset_password"
  | "find_id"
  | "reauth"
  | "mfa_enable"
  | "mfa_disable"
  | "mfa_verify"
  | "payout"
  | "payout_cancel"

export type TickResult = {
  blocked: boolean
  reason: "window_exceeded" | "locked" | null
  attemptCount: number
  retryAfterSeconds: number
  lockedUntil: Date | null
}

export type RecordFailureResult = {
  failureCount: number
  locked: boolean
  lockedUntil: Date | null
}

export type CooldownState = {
  active: boolean
  retryAfterSeconds: number
  cooldownUntil: Date | null
}

/** Rolling-window attempt counter. Throws on DB error. */
export async function tickAttempt(
  supabase: SupabaseClient,
  params: {
    key: string
    action: RateLimitAction
    windowSeconds: number
    maxAttempts: number
  }
): Promise<TickResult> {
  const { data, error } = await supabase.rpc("auth_rl_tick_attempt", {
    p_key: params.key,
    p_action: params.action,
    p_window_seconds: params.windowSeconds,
    p_max_attempts: params.maxAttempts,
  })
  if (error) {
    throw new Error(`auth_rl_tick_attempt failed: ${error.message}`)
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        blocked: boolean
        reason: "window_exceeded" | "locked" | null
        attempt_count: number
        retry_after_seconds: number
        locked_until: string | null
      }
    | null
  if (!row) throw new Error("auth_rl_tick_attempt: empty result")
  return {
    blocked: !!row.blocked,
    reason: row.reason ?? null,
    attemptCount: row.attempt_count ?? 0,
    retryAfterSeconds: row.retry_after_seconds ?? 0,
    lockedUntil: row.locked_until ? new Date(row.locked_until) : null,
  }
}

/** Read-only lock probe — reads `locked_until` for a bucket. */
export async function checkLock(
  supabase: SupabaseClient,
  params: { key: string; action: RateLimitAction }
): Promise<{ locked: boolean; lockedUntil: Date | null; retryAfterSeconds: number }> {
  const { data, error } = await supabase
    .from("auth_rate_limits")
    .select("locked_until")
    .eq("bucket_key", params.key)
    .eq("action", params.action)
    .maybeSingle()
  if (error) {
    throw new Error(`auth_rl checkLock failed: ${error.message}`)
  }
  const raw = (data as { locked_until: string | null } | null)?.locked_until ?? null
  if (!raw) return { locked: false, lockedUntil: null, retryAfterSeconds: 0 }
  const until = new Date(raw)
  const remaining = Math.ceil((until.getTime() - Date.now()) / 1000)
  if (remaining <= 0) return { locked: false, lockedUntil: null, retryAfterSeconds: 0 }
  return { locked: true, lockedUntil: until, retryAfterSeconds: remaining }
}

/** Increment failure counter; lock at threshold. Throws on DB error. */
export async function recordFailure(
  supabase: SupabaseClient,
  params: {
    key: string
    action: RateLimitAction
    threshold: number
    lockoutSeconds: number
  }
): Promise<RecordFailureResult> {
  const { data, error } = await supabase.rpc("auth_rl_record_failure", {
    p_key: params.key,
    p_action: params.action,
    p_threshold: params.threshold,
    p_lockout_seconds: params.lockoutSeconds,
  })
  if (error) {
    throw new Error(`auth_rl_record_failure failed: ${error.message}`)
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { failure_count: number; locked: boolean; locked_until: string | null }
    | null
  if (!row) throw new Error("auth_rl_record_failure: empty result")
  return {
    failureCount: row.failure_count ?? 0,
    locked: !!row.locked,
    lockedUntil: row.locked_until ? new Date(row.locked_until) : null,
  }
}

/** Reset all counters, lock, and cooldown for a bucket. Throws on DB error. */
export async function clearBucket(
  supabase: SupabaseClient,
  params: { key: string; action: RateLimitAction }
): Promise<void> {
  const { error } = await supabase.rpc("auth_rl_clear", {
    p_key: params.key,
    p_action: params.action,
  })
  if (error) {
    throw new Error(`auth_rl_clear failed: ${error.message}`)
  }
}

/** Check if a bucket is currently in cooldown (otp_resend). Throws on DB error. */
export async function checkCooldown(
  supabase: SupabaseClient,
  params: { key: string; action: RateLimitAction }
): Promise<CooldownState> {
  const { data, error } = await supabase
    .from("auth_rate_limits")
    .select("cooldown_until")
    .eq("bucket_key", params.key)
    .eq("action", params.action)
    .maybeSingle()
  if (error) {
    throw new Error(`auth_rl checkCooldown failed: ${error.message}`)
  }
  const raw = (data as { cooldown_until: string | null } | null)?.cooldown_until ?? null
  if (!raw) return { active: false, retryAfterSeconds: 0, cooldownUntil: null }
  const until = new Date(raw)
  const remaining = Math.ceil((until.getTime() - Date.now()) / 1000)
  if (remaining <= 0) return { active: false, retryAfterSeconds: 0, cooldownUntil: null }
  return { active: true, retryAfterSeconds: remaining, cooldownUntil: until }
}

/** Start or extend a cooldown. Upserts; does NOT reduce an existing cooldown. */
export async function setCooldown(
  supabase: SupabaseClient,
  params: { key: string; action: RateLimitAction; cooldownSeconds: number }
): Promise<void> {
  const until = new Date(Date.now() + params.cooldownSeconds * 1000).toISOString()
  const { error } = await supabase
    .from("auth_rate_limits")
    .upsert(
      {
        bucket_key: params.key,
        action: params.action,
        cooldown_until: until,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "bucket_key,action" }
    )
  if (error) {
    throw new Error(`auth_rl setCooldown failed: ${error.message}`)
  }
}

/** Normalized bucket key for (email, ip). */
export function keyEmailIp(email: string, ip: string): string {
  return `email:${email.toLowerCase()}|ip:${ip}`
}

/** Normalized bucket key for IP only. */
export function keyIp(ip: string): string {
  return `ip:${ip}`
}

/** Normalized bucket key for email only. */
export function keyEmail(email: string): string {
  return `email:${email.toLowerCase()}`
}
