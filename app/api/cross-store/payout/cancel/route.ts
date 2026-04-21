import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { logAuditEvent } from "@/lib/audit/logEvent"
import {
  parseUuid,
  parseBoundedString,
  cheapHash,
  MEMO_MAX,
} from "@/lib/security/guards"
import { ownerFinancialGuard } from "@/lib/cross-store/services/ownerFinancialGuard"
import { mapRpcError, type RpcErrorEntry } from "@/lib/cross-store/validators/validateCrossStoreInput"

const RPC_ERROR_MAP: Record<string, RpcErrorEntry> = {
  BAD_ARGS: { status: 400, error: "BAD_ARGS" },
  REASON_REQUIRED: { status: 400, error: "REASON_REQUIRED" },
  PAYOUT_NOT_FOUND: { status: 404, error: "PAYOUT_NOT_FOUND" },
  LEGACY_RECORD_NOT_CANCELLABLE: { status: 409, error: "LEGACY_RECORD_NOT_CANCELLABLE" },
  ALREADY_CANCELLED: { status: 409, error: "ALREADY_CANCELLED" },
  NOT_CANCELLABLE_STATE: { status: 409, error: "NOT_CANCELLABLE_STATE" },
  REVERSAL_NOT_CANCELLABLE: { status: 409, error: "REVERSAL_NOT_CANCELLABLE" },
  HEADER_NOT_FOUND: { status: 404, error: "HEADER_NOT_FOUND" },
  ITEM_NOT_IN_HEADER: { status: 404, error: "ITEM_NOT_IN_HEADER" },
  PAID_UNDERFLOW: { status: 409, error: "PAID_UNDERFLOW" },
  HEADER_REMAINING_NEGATIVE: { status: 409, error: "HEADER_REMAINING_NEGATIVE" },
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const payout_id = parseUuid(body.payout_id)
    if (!payout_id) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "payout_id must be a valid uuid." }, { status: 400 })
    }
    const reason = parseBoundedString(body.reason, MEMO_MAX)
    if (!reason) {
      return NextResponse.json({ error: "BAD_REQUEST", message: `reason must be non-empty and ≤ ${MEMO_MAX} chars.` }, { status: 400 })
    }

    // Owner + reauth + rate limit + dup guard + biz day
    const guard = await ownerFinancialGuard({
      auth,
      supabase,
      routeLabel: "cross_store_payout_cancel",
      entityTable: "payout_records",
      rateLimitKey: `xs-payout-cancel:${auth.user_id}`,
      rateLimitPerMin: 20,
      dupKey: `xs-payout-cancel-dup:${auth.user_id}:${cheapHash(payout_id)}`,
      dupWindowMs: 5000,
    })
    if (guard.error) return guard.error

    const { data, error } = await supabase.rpc("cancel_cross_store_payout", {
      p_store_uuid: auth.store_uuid,
      p_payout_id: payout_id,
      p_reason: reason,
      p_actor: auth.user_id,
    })

    if (error) {
      const mapped = mapRpcError(error.message ?? "", RPC_ERROR_MAP)
      await logAuditEvent(supabase, {
        auth,
        action: "cross_store_payout_cancel_failed",
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
      action: "cross_store_payout_cancelled",
      entity_table: "payout_records",
      entity_id: payout_id,
      status: "success",
      metadata: {
        original_payout_id: payout_id,
        reversal_payout_id: reversalId,
        cross_store_settlement_id: result.cross_store_settlement_id ?? null,
        cross_store_settlement_item_id: result.cross_store_settlement_item_id ?? null,
        amount: result.amount ?? null,
        new_item_status: (result as { item?: { status?: string } }).item?.status ?? null,
        new_header_status: (result as { header?: { status?: string } }).header?.status ?? null,
        previous_status: result.previous_status ?? null,
        new_status: result.new_status ?? null,
      },
      reason,
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return handleRouteError(error, "cross-store/payout/cancel")
  }
}
