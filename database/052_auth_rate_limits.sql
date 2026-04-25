-- ⚠️ APPLIED AS: 044_auth_rate_limits_and_security_logs  (via MCP)
-- 로컬 번호 052 이지만 Supabase 에는 044 slot 으로 기록됨.
-- 파일 rename 없이 이 주석으로 매핑 기록. database/README.md 참조.
--
-- Migration 052 — auth_rate_limits table + RPC wrappers.
--
-- SECURITY (R-7 backfill): the `auth_rate_limits` table and its
-- associated RPC functions were applied to the live Supabase
-- project via MCP but never committed as a migration file. This
-- migration is the written-down source of truth so a fresh
-- environment (staging / DR) can be reconstructed from git alone.
--
-- Consumers:
--   lib/security/authRateLimit.ts            (tickAttempt / recordFailure / clearBucket / checkCooldown / setCooldown / checkLock)
--   lib/security/rateLimitDurable.ts         (thin async wrapper around tickAttempt)
--   app/api/auth/login/route.ts              (IP + email+IP bucket)
--   app/api/auth/login/otp/verify/route.ts   (otp_verify lockout)
--   app/api/auth/login/mfa/route.ts          (login_mfa bucket)
--   app/api/auth/signup/route.ts             (signup bucket)
--   app/api/auth/reset-password/route.ts     (reset_password bucket)
--   app/api/auth/find-id/route.ts            (find_id bucket)
--   app/api/auth/reauth/route.ts             (reauth bucket)
--   app/api/auth/mfa/{enable,disable,verify}/route.ts (mfa_* buckets)
--   app/api/settlement/payout/route.ts       (payout bucket)
--   app/api/settlement/payout/cancel/route.ts (payout_cancel bucket)
--   lib/cross-store/services/ownerFinancialGuard.ts   (owner financial guard)

-- ─── 1. Table ─────────────────────────────────────────────────────────
-- Keyed by (bucket_key, action). bucket_key is an application-level
-- composite ("email:foo@bar", "ip:1.2.3.4", "user:<uuid>", etc.), action
-- is the namespace enum in TS (`RateLimitAction`). The table is
-- intentionally free-form `text` on the action column so application-
-- layer changes (new rate-limited endpoints) do not require a
-- migration.
CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
  bucket_key       text        NOT NULL,
  action           text        NOT NULL,
  -- Rolling-window counter. Reset when (now - window_start) exceeds
  -- the caller-supplied window duration.
  window_start     timestamptz,
  attempt_count    integer     NOT NULL DEFAULT 0,
  -- Failure-specific lockout (used by otp_verify; distinct from the
  -- rolling-window attempt counter).
  failure_count    integer     NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  -- Cooldown window (used for otp_resend).
  cooldown_until   timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_key, action)
);

-- Gaps where a very old row is never revisited get reclaimed by the
-- application calling `auth_rl_clear` on success. We also provide an
-- index for eventual TTL-style cleanup via a scheduled task.
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_updated_at
  ON public.auth_rate_limits (updated_at);

-- RLS is disabled here because the table is only ever touched by the
-- service-role client (same policy as the rest of the MVP).

-- ─── 2. auth_rl_tick_attempt ─────────────────────────────────────────
-- Rolling-window counter. FAIL-CLOSED contract: throws via SQL EXCEPTION
-- only on DB-level failure; otherwise returns a single row.
CREATE OR REPLACE FUNCTION public.auth_rl_tick_attempt(
  p_key             text,
  p_action          text,
  p_window_seconds  integer,
  p_max_attempts    integer
)
RETURNS TABLE (
  blocked              boolean,
  reason               text,
  attempt_count        integer,
  retry_after_seconds  integer,
  locked_until         timestamptz
)
LANGUAGE plpgsql
AS $$
DECLARE
  r public.auth_rate_limits%ROWTYPE;
  now_ts timestamptz := now();
  window_expires_at timestamptz;
  remaining integer;
BEGIN
  INSERT INTO public.auth_rate_limits (bucket_key, action, window_start, attempt_count, updated_at)
  VALUES (p_key, p_action, now_ts, 1, now_ts)
  ON CONFLICT (bucket_key, action) DO UPDATE
    SET
      window_start = CASE
        WHEN public.auth_rate_limits.window_start IS NULL
          OR (now() - public.auth_rate_limits.window_start) > make_interval(secs => p_window_seconds)
        THEN now()
        ELSE public.auth_rate_limits.window_start
      END,
      attempt_count = CASE
        WHEN public.auth_rate_limits.window_start IS NULL
          OR (now() - public.auth_rate_limits.window_start) > make_interval(secs => p_window_seconds)
        THEN 1
        ELSE public.auth_rate_limits.attempt_count + 1
      END,
      updated_at = now()
  RETURNING * INTO r;

  -- Active lockout short-circuit (set by auth_rl_record_failure).
  IF r.locked_until IS NOT NULL AND r.locked_until > now_ts THEN
    blocked := true;
    reason  := 'locked';
    attempt_count := r.attempt_count;
    retry_after_seconds := GREATEST(1, EXTRACT(EPOCH FROM (r.locked_until - now_ts))::integer);
    locked_until := r.locked_until;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Rolling-window cap.
  IF r.attempt_count > p_max_attempts THEN
    window_expires_at := r.window_start + make_interval(secs => p_window_seconds);
    remaining := GREATEST(1, EXTRACT(EPOCH FROM (window_expires_at - now_ts))::integer);
    blocked := true;
    reason  := 'window_exceeded';
    attempt_count := r.attempt_count;
    retry_after_seconds := remaining;
    locked_until := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  blocked := false;
  reason  := NULL;
  attempt_count := r.attempt_count;
  retry_after_seconds := 0;
  locked_until := r.locked_until;
  RETURN NEXT;
END;
$$;

-- ─── 3. auth_rl_record_failure ───────────────────────────────────────
-- Increments failure_count; locks when threshold is reached. Used by
-- OTP verify to convert "bad code" attempts into a short lockout.
CREATE OR REPLACE FUNCTION public.auth_rl_record_failure(
  p_key              text,
  p_action           text,
  p_threshold        integer,
  p_lockout_seconds  integer
)
RETURNS TABLE (
  failure_count  integer,
  locked         boolean,
  locked_until   timestamptz
)
LANGUAGE plpgsql
AS $$
DECLARE
  r public.auth_rate_limits%ROWTYPE;
  new_locked_until timestamptz;
BEGIN
  INSERT INTO public.auth_rate_limits (bucket_key, action, failure_count, updated_at)
  VALUES (p_key, p_action, 1, now())
  ON CONFLICT (bucket_key, action) DO UPDATE
    SET
      failure_count = public.auth_rate_limits.failure_count + 1,
      updated_at = now()
  RETURNING * INTO r;

  IF r.failure_count >= p_threshold THEN
    new_locked_until := now() + make_interval(secs => p_lockout_seconds);
    UPDATE public.auth_rate_limits
      SET locked_until = new_locked_until,
          updated_at   = now()
      WHERE bucket_key = p_key AND action = p_action;
    failure_count := r.failure_count;
    locked        := true;
    locked_until  := new_locked_until;
  ELSE
    failure_count := r.failure_count;
    locked        := false;
    locked_until  := r.locked_until;
  END IF;
  RETURN NEXT;
END;
$$;

-- ─── 4. auth_rl_clear ────────────────────────────────────────────────
-- Reset bucket on success (clears attempt_count, failure_count,
-- locked_until, cooldown_until). Caller: tickAttempt consumers that
-- have confirmed a successful login / verification and want to wipe
-- the slate.
CREATE OR REPLACE FUNCTION public.auth_rl_clear(
  p_key     text,
  p_action  text
)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.auth_rate_limits
    SET attempt_count  = 0,
        failure_count  = 0,
        locked_until   = NULL,
        cooldown_until = NULL,
        updated_at     = now()
    WHERE bucket_key = p_key AND action = p_action;
$$;
