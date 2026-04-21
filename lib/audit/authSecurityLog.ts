import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * STEP-SEC-1: security event logger for unauthenticated auth paths.
 *
 * Writes to `auth_security_logs` (migration 044). This table is SEPARATE
 * from `audit_events` because audit_events requires `store_uuid /
 * actor_profile_id / actor_role` NOT NULL — all three are unknown for
 * pre-authentication events like rate-limit hits, OTP lockouts, and
 * failed verify attempts.
 *
 * Best-effort write: logger failures are swallowed (logged to console)
 * and never block the triggering request.
 *
 * NEVER log plaintext OTP codes, passwords, refresh tokens, or raw
 * trusted-device secrets. Callers pre-sanitize before passing metadata.
 */

export type AuthSecurityEventType =
  | "login_rate_limited"
  | "login_email_otp_verify_failed"
  | "login_email_otp_locked"
  | "login_email_otp_verify_success"
  | "login_email_otp_resend_rate_limited"
  | "login_email_otp_sent"
  | "login_security_state_unavailable"

export async function logAuthSecurityEvent(
  supabase: SupabaseClient,
  args: {
    event_type: AuthSecurityEventType
    email?: string | null
    ip?: string | null
    device_id?: string | null
    user_id?: string | null
    metadata?: Record<string, unknown>
  }
): Promise<void> {
  try {
    const { error } = await supabase.from("auth_security_logs").insert({
      event_type: args.event_type,
      email: args.email ?? null,
      ip: args.ip ?? null,
      device_id: args.device_id ?? null,
      user_id: args.user_id ?? null,
      metadata: args.metadata ?? null,
    })
    if (error) {
      console.warn(`[auth-sec] ${args.event_type} insert failed:`, error.message)
    }
  } catch (e) {
    console.warn(`[auth-sec] ${args.event_type} threw:`, e)
  }
}

/**
 * Extract the caller IP.
 *
 * SECURITY (R-3 remediation): this is now a thin re-export of the
 * hardened `getClientIp()` helper. The legacy implementation
 * unconditionally trusted `X-Forwarded-For`, which allowed trivial
 * bypass of every IP-based rate limit by sending a different spoofed
 * IP on each request. The new implementation ONLY trusts
 * platform-signed headers (Vercel / Cloudflare) or self-hosted
 * forwarded-for headers when the operator has explicitly declared the
 * deployment as proxied via `TRUSTED_PROXY=true`.
 *
 * The old export name is kept so every caller site continues to work
 * without per-file edits.
 */
export { getClientIp as extractIp } from "@/lib/security/clientIp"
