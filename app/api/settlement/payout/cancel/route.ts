import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { logAuditEvent, logDeniedAudit } from "@/lib/audit/logEvent"
import { requiresReauth, hasRecentReauth } from "@/lib/security/mfaPolicy"
import { assertBusinessDayOpenByPayout } from "@/lib/auth/assertBusinessDayOpen"
import {
  parseUuid,
  parseBoundedString,
  rateLimit,
  duplicateGuard,
  cheapHash,
  MEMO_MAX,
} from "@/lib/security/guards"
import { rateLimitDurable } from "@/lib/security/rateLimitDurable"

/**
 * STEP-014: POST /api/settlement/payout/cancel
 *
 * Owner-only reversal of a completed settlement payout. Delegates the
 * entire reversal (original row lock → item recalc → reversal row
 * insert → settlement demotion) to the `cancel_settlement_payout`
 * Postgres RPC so every step commits atomically under row locks.
 *
 * Request: { payout_id: uuid, reason: string }
 *
 * Locked rules (RPC-enforced):
 *   - store_uuid is always auth.store_uuid.
 *   - original row must be status='completed' and not a reversal itself.
 *   - double cancel rejected (ALREADY_CANCELLED).
 *   - settlement demotes from 'paid' → 'confirmed' when anything is
 *     again outstanding on any live item.
 *   - no negative amounts: reversal row carries a positive amount with
 *     payout_type='reversal'.
 */

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

const RPC_ERROR_MAP: Record<string, { status: number; error: string }> = {
  BAD_ARGS: { status: 400, error: "BAD_ARGS" },
  REASON_REQUIRED: { status: 400, error: "REASON_REQUIRED" },
  PAYOUT_NOT_FOUND: { status: 404, error: "PAYOUT_NOT_FOUND" },
  NOT_A_SETTLEMENT_PAYOUT: { status: 409, error: "NOT_A_SETTLEMENT_PAYOUT" },
  ALREADY_CANCELLED: { status: 409, error: "ALREADY_CANCELLED" },
  NOT_CANCELLABLE_STATE: { status: 409, error: "NOT_CANCELLABLE_STATE" },
  REVERSAL_NOT_CANCELLABLE: { status: 409, error: "REVERSAL_NOT_CANCELLABLE" },
  ITEM_NOT_FOUND: { status: 404, error: "ITEM_NOT_FOUND" },
  PAID_UNDERFLOW: { status: 409, error: "PAID_UNDERFLOW" },
}

function mapRpcError(msg: string): { status: number; error: string; message: string } {
  for (const key of Object.keys(RPC_ERROR_MAP)) {
    if (msg.includes(key)) return { ...RPC_ERROR_MAP[key], message: msg }
  }
  return { status: 500, error: "RPC_FAILED", message: msg }
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)

    // STEP-014: cancel is owner-only — manager and hostess forbidden.
    if (auth.role !== "owner") {
      const supabaseDeny = supa()
      await logDeniedAudit(supabaseDeny, {
        auth,
        action: "payout_cancel_forbidden",
        entity_table: "payout_records",
        reason: "ROLE_NOT_ALLOWED",
        metadata: { route: "POST /api/settlement/payout/cancel" },
      })
      return NextResponse.json(
        { error: "FORBIDDEN", message: "payout cancel not allowed for this role." },
        { status: 403 }
      )
    }

    // STEP-013D: financial write reauth gate.
    if (requiresReauth("financial_write", auth.role)) {
      const supabaseCheck = supa()
      const ok = await hasRecentReauth(supabaseCheck, auth.user_id, "financial_write")
      if (!ok) {
        await logDeniedAudit(supabaseCheck, {
          auth,
          action: "sensitive_action_blocked_due_to_missing_reauth",
          entity_table: "payout_records",
          reason: "REAUTH_REQUIRED",
          metadata: { route: "POST /api/settlement/payout/cancel" },
        })
        return NextResponse.json(
          { error: "REAUTH_REQUIRED", message: "Recent re-authentication required." },
          { status: 401 }
        )
      }
    }

    const rlLocal = rateLimit(`payout-cancel:${auth.user_id}`, { limit: 40, windowMs: 60_000 })
    if (!rlLocal.ok) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many cancel attempts. Retry shortly." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rlLocal.retryAfter / 1000)) } }
      )
    }
    // SECURITY (R-7): durable distributed rate-limit.
    const rl = await rateLimitDurable(supa(), {
      key: `payout-cancel:user:${auth.user_id}`,
      action: "payout_cancel",
      limit: 20,
      windowSeconds: 60,
    })
    if (!rl.ok) {
      const status = rl.reason === "db_error" ? 503 : 429
      return NextResponse.json(
        { error: rl.reason === "db_error" ? "SECURITY_STATE_UNAVAILABLE" : "RATE_LIMITED",
          message: "Too many cancel attempts. Retry shortly." },
        { status, headers: { "Retry-After": String(Math.max(1, rl.retryAfter)) } }
      )
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const payout_id = parseUuid(body.payout_id)
    if (!payout_id) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "payout_id must be a valid uuid." },
        { status: 400 }
      )
    }
    const reason = parseBoundedString(body.reason, MEMO_MAX)
    if (!reason) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: `reason must be non-empty and ≤ ${MEMO_MAX} chars.` },
        { status: 400 }
      )
    }

    const dup = duplicateGuard(
      `payout-cancel-dup:${auth.user_id}:${cheapHash(payout_id)}`,
      5000
    )
    if (!dup.ok) {
      return NextResponse.json(
        { error: "DUPLICATE_SUBMIT", message: "Duplicate cancel submission detected." },
        { status: 409, headers: { "Retry-After": String(Math.ceil(dup.retryAfter / 1000)) } }
      )
    }

    const supabase = supa()

    // STEP-017: closing write-lock.
    const dayGuard = await assertBusinessDayOpenByPayout(supabase, auth.store_uuid, payout_id)
    if (dayGuard) {
      await logDeniedAudit(supabase, {
        auth,
        action: "settlement_payout_cancel_blocked_day_closed",
        entity_table: "payout_records",
        entity_id: payout_id,
        reason: "BUSINESS_DAY_CLOSED",
        metadata: {},
      })
      return dayGuard
    }

    const { data, error } = await supabase.rpc("cancel_settlement_payout", {
      p_store_uuid: auth.store_uuid,
      p_payout_id: payout_id,
      p_reason: reason,
      p_actor: auth.user_id,
    })

    if (error) {
      const mapped = mapRpcError(error.message ?? "")
      await logAuditEvent(supabase, {
        auth,
        action: "settlement_payout_cancel_failed",
        entity_table: "payout_records",
        entity_id: payout_id,
        status: "failed",
        reason: mapped.error,
        metadata: { rpc_error: mapped.error },
      })
      return NextResponse.json({ error: mapped.error, message: mapped.message }, { status: mapped.status })
    }

    const result = (data ?? {}) as Record<string, unknown>
    const reversalId = typeof result.reversal_payout_id === "string" ? result.reversal_payout_id : null

    await logAuditEvent(supabase, {
      auth,
      action: "settlement_payout_cancelled",
      entity_table: "payout_records",
      entity_id: payout_id,
      status: "success",
      metadata: {
        original_payout_id: payout_id,
        reversal_payout_id: reversalId,
        amount: result.amount ?? null,
        new_paid_amount: result.new_paid_amount ?? null,
        new_remaining_amount: result.new_remaining_amount ?? null,
        previous_status: result.previous_status ?? null,
        new_status: result.new_status ?? null,
      },
      reason,
    })

    return NextResponse.json(result, { status: 201 })
  } catch (e) {
    if (e instanceof AuthError) {
      const status = e.type === "AUTH_MISSING" || e.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: e.type, message: e.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
