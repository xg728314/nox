import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { logDeniedAudit, type AuditEntityTable } from "@/lib/audit/logEvent"
import { requiresReauth, hasRecentReauth } from "@/lib/security/mfaPolicy"
import { assertStoreHasOpenDay } from "@/lib/auth/assertBusinessDayOpen"
import { rateLimit, duplicateGuard } from "@/lib/security/guards"
import { rateLimitDurable } from "@/lib/security/rateLimitDurable"

type OwnerGuardInput = {
  auth: AuthContext
  supabase: SupabaseClient
  routeLabel: string
  entityTable: AuditEntityTable
  rateLimitKey: string
  rateLimitPerMin: number
  dupKey: string
  dupWindowMs: number
}

type GuardResult =
  | { ok: true; error?: never }
  | { ok?: never; error: NextResponse }

/**
 * Shared owner-only financial guard: role gate, reauth, rate limit,
 * duplicate guard, business day check.
 *
 * Extracts the ~40-line block repeated in route.ts POST, payout/route.ts,
 * and payout/cancel/route.ts.
 */
export async function ownerFinancialGuard(
  input: OwnerGuardInput
): Promise<GuardResult> {
  const { auth, supabase, routeLabel, entityTable } = input

  // 1. Owner role gate
  if (auth.role !== "owner") {
    await logDeniedAudit(supabase, {
      auth,
      action: `${routeLabel}_forbidden`,
      entity_table: entityTable,
      reason: "ROLE_NOT_ALLOWED",
      metadata: { route: routeLabel },
    })
    return {
      error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }),
    }
  }

  // 2. Reauth check
  if (requiresReauth("financial_write", auth.role)) {
    const ok = await hasRecentReauth(supabase, auth.user_id, "financial_write")
    if (!ok) {
      await logDeniedAudit(supabase, {
        auth,
        action: "sensitive_action_blocked_due_to_missing_reauth",
        entity_table: entityTable,
        reason: "REAUTH_REQUIRED",
        metadata: { route: routeLabel },
      })
      return {
        error: NextResponse.json(
          { error: "REAUTH_REQUIRED", message: "Recent re-authentication required." },
          { status: 401 }
        ),
      }
    }
  }

  // 3. Rate limit (fast-path in-memory).
  const rlLocal = rateLimit(input.rateLimitKey, { limit: input.rateLimitPerMin * 2, windowMs: 60_000 })
  if (!rlLocal.ok) {
    return {
      error: NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many requests. Retry shortly." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rlLocal.retryAfter / 1000)) } }
      ),
    }
  }
  // SECURITY (R-7): durable distributed rate-limit on cross-store
  // financial writes. Same ceiling as the caller-specified limit;
  // multi-instance bypass would amplify the blast radius of any
  // validation bug before the RPC lock catches it.
  const rlDurable = await rateLimitDurable(supabase, {
    key: input.rateLimitKey,
    action: "payout",
    limit: input.rateLimitPerMin,
    windowSeconds: 60,
  })
  if (!rlDurable.ok) {
    const status = rlDurable.reason === "db_error" ? 503 : 429
    return {
      error: NextResponse.json(
        { error: rlDurable.reason === "db_error" ? "SECURITY_STATE_UNAVAILABLE" : "RATE_LIMITED",
          message: "Too many requests. Retry shortly." },
        { status, headers: { "Retry-After": String(Math.max(1, rlDurable.retryAfter)) } }
      ),
    }
  }

  // 4. Duplicate guard
  const dup = duplicateGuard(input.dupKey, input.dupWindowMs)
  if (!dup.ok) {
    return {
      error: NextResponse.json(
        { error: "DUPLICATE_SUBMIT", message: "Duplicate submission detected." },
        { status: 409, headers: { "Retry-After": String(Math.ceil(dup.retryAfter / 1000)) } }
      ),
    }
  }

  // 5. Business day open assertion
  const dayGuard = await assertStoreHasOpenDay(supabase, auth.store_uuid)
  if (dayGuard) {
    await logDeniedAudit(supabase, {
      auth,
      action: `${routeLabel}_blocked_day_closed`,
      entity_table: entityTable,
      reason: "BUSINESS_DAY_CLOSED",
      metadata: {},
    })
    return { error: dayGuard }
  }

  return { ok: true }
}
