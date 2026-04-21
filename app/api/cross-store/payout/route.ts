import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { logAuditEvent } from "@/lib/audit/logEvent"
import {
  parseUuid,
  parsePositiveAmount,
  parseBoundedString,
  cheapHash,
  MEMO_MAX,
} from "@/lib/security/guards"
import { ownerFinancialGuard } from "@/lib/cross-store/services/ownerFinancialGuard"
import { mapRpcError, type RpcErrorEntry } from "@/lib/cross-store/validators/validateCrossStoreInput"

const RPC_ERROR_MAP: Record<string, RpcErrorEntry> = {
  AMOUNT_INVALID: { status: 400, error: "AMOUNT_INVALID" },
  STORE_UUID_NULL: { status: 400, error: "STORE_UUID_NULL" },
  HEADER_NOT_FOUND: { status: 404, error: "HEADER_NOT_FOUND" },
  ITEM_NOT_IN_HEADER: { status: 404, error: "ITEM_NOT_IN_HEADER" },
  MANAGER_NULL: { status: 409, error: "MANAGER_NULL" },
  OVERPAY: { status: 409, error: "OVERPAY" },
  HEADER_REMAINING_NEGATIVE: { status: 409, error: "HEADER_REMAINING_NEGATIVE" },
}

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const cross_store_settlement_id = parseUuid(body.cross_store_settlement_id)
    if (!cross_store_settlement_id) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "cross_store_settlement_id must be a valid uuid." }, { status: 400 })
    }

    const item_id = parseUuid(body.item_id)
    if (!item_id) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "item_id must be a valid uuid." }, { status: 400 })
    }

    const amountNum = parsePositiveAmount(body.amount)
    if (amountNum == null) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "amount must be a finite positive number within bounds." }, { status: 400 })
    }

    const memo = body.memo == null ? null : parseBoundedString(body.memo, MEMO_MAX)
    if (body.memo != null && memo === null) {
      return NextResponse.json({ error: "BAD_REQUEST", message: `memo must be non-empty and ≤ ${MEMO_MAX} chars.` }, { status: 400 })
    }

    // Owner + reauth + rate limit + dup guard + biz day
    const guard = await ownerFinancialGuard({
      auth,
      supabase,
      routeLabel: "cross_store_payout",
      entityTable: "cross_store_settlement_items",
      rateLimitKey: `xs-payout:${auth.user_id}`,
      rateLimitPerMin: 20,
      dupKey: `xs-payout-dup:${auth.user_id}:${cheapHash(`${cross_store_settlement_id}|${item_id}|${amountNum}`)}`,
      dupWindowMs: 3000,
    })
    if (guard.error) return guard.error

    const { data, error } = await supabase.rpc("record_cross_store_payout", {
      p_from_store_uuid: auth.store_uuid,
      p_cross_store_settlement_id: cross_store_settlement_id,
      p_item_id: item_id,
      p_amount: amountNum,
      p_memo: memo,
      p_created_by: auth.user_id,
    })

    if (error) {
      const mapped = mapRpcError(error.message ?? "", RPC_ERROR_MAP)
      if (["OVERPAY", "HEADER_REMAINING_NEGATIVE", "MANAGER_NULL", "HEADER_NOT_FOUND", "ITEM_NOT_IN_HEADER"].includes(mapped.error)) {
        await logAuditEvent(supabase, {
          auth,
          action: "cross_store_payout_failed",
          entity_table: "cross_store_settlement_items",
          entity_id: item_id,
          status: "failed",
          reason: mapped.error,
          metadata: { cross_store_settlement_id, amount: amountNum, rpc_error: mapped.error },
        })
      }
      return NextResponse.json({ error: mapped.error, message: mapped.message }, { status: mapped.status })
    }

    const result = (data ?? {}) as Record<string, unknown>
    const payoutId = typeof result.payout_id === "string" ? result.payout_id : null

    await logAuditEvent(supabase, {
      auth,
      action: "cross_store_payout_created",
      entity_table: "cross_store_settlement_items",
      entity_id: item_id,
      status: "success",
      metadata: {
        payout_id: payoutId,
        cross_store_settlement_id,
        amount: amountNum,
        new_item_status: (result as { item?: { status?: string } }).item?.status ?? null,
        new_header_status: (result as { header?: { status?: string } }).header?.status ?? null,
      },
      reason: memo,
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return handleRouteError(error, "cross-store/payout")
  }
}
