import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { isValidUUID } from "@/lib/validation"
import { logAuditEvent, logDeniedAudit } from "@/lib/audit/logEvent"
import { requiresReauth, hasRecentReauth } from "@/lib/security/mfaPolicy"
import { assertBusinessDayOpenBySettlementItem } from "@/lib/auth/assertBusinessDayOpen"
import {
  parseUuid,
  parsePositiveAmount,
  parseBoundedString,
  rateLimit,
  duplicateGuard,
  cheapHash,
  MEMO_MAX,
} from "@/lib/security/guards"
import { rateLimitDurable } from "@/lib/security/rateLimitDurable"

/**
 * STEP-011D: POST /api/settlement/payout
 *
 * Records a full / partial / prepayment payout against a single
 * settlement_items row. Delegates every write to the
 * `record_settlement_payout` Postgres RPC so that the payout_records
 * INSERT, settlement_items UPDATE, and conditional settlements → 'paid'
 * promotion all commit atomically in a single transaction.
 *
 * Request:
 *   {
 *     "settlement_item_id": uuid,
 *     "amount": number,
 *     "payout_type": "full" | "partial" | "prepayment",
 *     "memo"?: string
 *   }
 *
 * Locked rules (RPC-enforced):
 *   - store_uuid is always auth.store_uuid (never trusted from body).
 *   - amount must be > 0 and ≤ remaining_amount (OVERPAY rejected).
 *   - parent settlement must be in 'confirmed' or 'paid' state.
 *   - recipient_type derived from settlement_items.role_type; 'store'
 *     role is rejected (not a personal recipient).
 *   - recipient_membership_id must exist on the item.
 */

function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("SERVER_CONFIG_ERROR")
  return createClient(url, key)
}

const RPC_ERROR_MAP: Record<string, { status: number; error: string }> = {
  AMOUNT_INVALID: { status: 400, error: "AMOUNT_INVALID" },
  PAYOUT_TYPE_INVALID: { status: 400, error: "PAYOUT_TYPE_INVALID" },
  STORE_UUID_NULL: { status: 400, error: "STORE_UUID_NULL" },
  ITEM_NOT_FOUND: { status: 404, error: "ITEM_NOT_FOUND" },
  SETTLEMENT_NOT_FOUND: { status: 404, error: "SETTLEMENT_NOT_FOUND" },
  SETTLEMENT_NOT_CONFIRMED: { status: 409, error: "SETTLEMENT_NOT_CONFIRMED" },
  RECIPIENT_ROLE_INVALID: { status: 409, error: "RECIPIENT_ROLE_INVALID" },
  RECIPIENT_MEMBERSHIP_NULL: { status: 409, error: "RECIPIENT_MEMBERSHIP_NULL" },
  OVERPAY: { status: 409, error: "OVERPAY" },
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
    // STEP-013A: role gate — payout execution is restricted to owner/manager.
    if (auth.role !== "owner" && auth.role !== "manager") {
      const supabaseDeny = supa()
      await logDeniedAudit(supabaseDeny, {
        auth,
        action: "settlement_payout_forbidden",
        entity_table: "payout_records",
        reason: "ROLE_NOT_ALLOWED",
        metadata: { route: "POST /api/settlement/payout" },
      })
      return NextResponse.json({ error: "FORBIDDEN", message: "payout execution not allowed for this role." }, { status: 403 })
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
          metadata: { route: "POST /api/settlement/payout" },
        })
        return NextResponse.json(
          { error: "REAUTH_REQUIRED", message: "Recent re-authentication required." },
          { status: 401 }
        )
      }
    }

    // Fast-path in-memory burst guard.
    const rlLocal = rateLimit(`payout:${auth.user_id}`, { limit: 40, windowMs: 60_000 })
    if (!rlLocal.ok) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many payout attempts. Retry shortly." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rlLocal.retryAfter / 1000)) } }
      )
    }
    // SECURITY (R-7): durable distributed rate-limit. Payout writes
    // real money; a multi-instance bypass could amplify impact of any
    // upstream validation bug before the RPC lock catches it.
    const rl = await rateLimitDurable(supa(), {
      key: `payout:user:${auth.user_id}`,
      action: "payout",
      limit: 20,
      windowSeconds: 60,
    })
    if (!rl.ok) {
      const status = rl.reason === "db_error" ? 503 : 429
      return NextResponse.json(
        { error: rl.reason === "db_error" ? "SECURITY_STATE_UNAVAILABLE" : "RATE_LIMITED",
          message: "Too many payout attempts. Retry shortly." },
        { status, headers: { "Retry-After": String(Math.max(1, rl.retryAfter)) } }
      )
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    // STEP-013C: strict parsing via shared helpers.
    const settlement_item_id = parseUuid(body.settlement_item_id)
    if (!settlement_item_id) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "settlement_item_id must be a valid uuid." }, { status: 400 })
    }

    const amountNum = parsePositiveAmount(body.amount)
    if (amountNum == null) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "amount must be a finite positive number within bounds." }, { status: 400 })
    }

    const payout_type = typeof body.payout_type === "string" ? body.payout_type : ""
    if (!["full", "partial", "prepayment"].includes(payout_type)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "payout_type must be one of full | partial | prepayment." },
        { status: 400 }
      )
    }

    const memo = body.memo == null ? null : parseBoundedString(body.memo, MEMO_MAX)
    if (body.memo != null && memo === null) {
      return NextResponse.json({ error: "BAD_REQUEST", message: `memo must be non-empty and ≤ ${MEMO_MAX} chars.` }, { status: 400 })
    }

    // STEP-013C: 3-second duplicate-submit guard keyed by actor+payload.
    const dup = duplicateGuard(
      `payout-dup:${auth.user_id}:${cheapHash(`${settlement_item_id}|${amountNum}|${payout_type}`)}`,
      3000
    )
    if (!dup.ok) {
      return NextResponse.json(
        { error: "DUPLICATE_SUBMIT", message: "Duplicate payout submission detected." },
        { status: 409, headers: { "Retry-After": String(Math.ceil(dup.retryAfter / 1000)) } }
      )
    }

    const supabase = supa()

    // STEP-017: closing write-lock — reject if the originating business day is closed.
    const dayGuard = await assertBusinessDayOpenBySettlementItem(supabase, auth.store_uuid, settlement_item_id)
    if (dayGuard) {
      await logDeniedAudit(supabase, {
        auth,
        action: "settlement_payout_blocked_day_closed",
        entity_table: "settlement_items",
        entity_id: settlement_item_id,
        reason: "BUSINESS_DAY_CLOSED",
        metadata: { payout_type, amount: amountNum },
      })
      return dayGuard
    }

    const { data, error } = await supabase.rpc("record_settlement_payout", {
      p_store_uuid: auth.store_uuid,
      p_settlement_item_id: settlement_item_id,
      p_amount: amountNum,
      p_payout_type: payout_type,
      p_memo: memo,
      p_created_by: auth.user_id,
    })

    if (error) {
      const mapped = mapRpcError(error.message ?? "")
      // STEP-013B: log load-bearing RPC rejections so operators can trace
      // attempted overpays, state violations, and recipient/role misuse.
      if (["OVERPAY", "SETTLEMENT_NOT_CONFIRMED", "RECIPIENT_ROLE_INVALID", "RECIPIENT_MEMBERSHIP_NULL"].includes(mapped.error)) {
        await logAuditEvent(supabase, {
          auth,
          action: "settlement_payout_failed",
          entity_table: "settlement_items",
          entity_id: settlement_item_id,
          status: "failed",
          reason: mapped.error,
          metadata: { payout_type, amount: amountNum, rpc_error: mapped.error },
        })
      }
      return NextResponse.json({ error: mapped.error, message: mapped.message }, { status: mapped.status })
    }

    const result = (data ?? {}) as Record<string, unknown>
    const payoutId = typeof result.payout_id === "string" ? result.payout_id : null

    // STEP-013B: success audit via shared helper.
    await logAuditEvent(supabase, {
      auth,
      action: "settlement_payout_created",
      entity_table: "payout_records",
      entity_id: payoutId ?? settlement_item_id,
      status: "success",
      metadata: {
        settlement_item_id,
        payout_id: payoutId,
        payout_type,
        amount: amountNum,
        new_item_status: (result as { item?: { status?: string } }).item?.status ?? null,
        new_settlement_status: (result as { settlement?: { status?: string } }).settlement?.status ?? null,
      },
      reason: memo,
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
