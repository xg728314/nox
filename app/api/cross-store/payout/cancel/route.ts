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

    // Phase 10.1: reversal row 에도 executor 기록.
    //   body.executor_membership_id 미지정 시 auth.membership_id 로 기본.
    //   executor 는 payer 매장(auth.store_uuid) 소속 approved membership 이어야 함.
    const bodyExecutor = body.executor_membership_id
    const explicitExecutor =
      typeof bodyExecutor === "string" ? parseUuid(bodyExecutor) : null
    if (typeof bodyExecutor === "string" && bodyExecutor.length > 0 && !explicitExecutor) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "executor_membership_id must be a valid uuid." },
        { status: 400 },
      )
    }
    const executorMembershipId = explicitExecutor ?? auth.membership_id
    if (executorMembershipId !== auth.membership_id) {
      const { data: execMem, error: execMemErr } = await supabase
        .from("store_memberships")
        .select("id, store_uuid, status")
        .eq("id", executorMembershipId)
        .is("deleted_at", null)
        .maybeSingle()
      if (execMemErr) {
        return NextResponse.json(
          { error: "INTERNAL_ERROR", message: "executor 조회 실패", detail: execMemErr.message },
          { status: 500 },
        )
      }
      const em = execMem as { id: string; store_uuid: string; status: string } | null
      if (!em) {
        return NextResponse.json(
          { error: "EXECUTOR_NOT_FOUND", message: "executor 멤버십을 찾을 수 없습니다." },
          { status: 404 },
        )
      }
      if (em.status !== "approved") {
        return NextResponse.json(
          { error: "EXECUTOR_INVALID", message: "executor 는 approved membership 이어야 합니다." },
          { status: 400 },
        )
      }
      if (em.store_uuid !== auth.store_uuid) {
        return NextResponse.json(
          {
            error: "EXECUTOR_STORE_MISMATCH",
            message: "executor 는 payer 매장 소속이어야 합니다.",
          },
          { status: 400 },
        )
      }
    }

    // Phase 10: cancel 은 payout_id 만 받으므로 guard 에 전달할 handler/store
    //   를 복원하기 위해 payout → item 2-hop 사전 조회.
    //   실패 / 077 미적용 fallback 은 itemHandlerId = null (→ manager 경로 차단).
    let itemHandlerId: string | null = null
    let itemStoreUuid: string | null = null
    {
      const { data: payoutRow, error: payoutErr } = await supabase
        .from("payout_records")
        .select("cross_store_settlement_item_id")
        .eq("id", payout_id)
        .is("deleted_at", null)
        .maybeSingle()
      if (payoutErr) {
        return NextResponse.json(
          { error: "INTERNAL_ERROR", message: "payout 조회 실패", detail: payoutErr.message },
          { status: 500 },
        )
      }
      const p = payoutRow as { cross_store_settlement_item_id: string | null } | null
      const item_id_for_scope = p?.cross_store_settlement_item_id ?? null
      if (item_id_for_scope) {
        const { data: itemRow, error: itemErr } = await supabase
          .from("cross_store_settlement_items")
          .select("current_handler_membership_id, store_uuid")
          .eq("id", item_id_for_scope)
          .is("deleted_at", null)
          .maybeSingle()
        if (itemErr) {
          const msg = String(itemErr.message ?? "")
          if (!/column .*current_handler_membership_id.* does not exist/i.test(msg)) {
            return NextResponse.json(
              { error: "INTERNAL_ERROR", message: "item 조회 실패", detail: msg },
              { status: 500 },
            )
          }
          // 077 미적용 → itemHandlerId = null (manager 경로 자동 차단).
        } else if (itemRow) {
          const row = itemRow as {
            current_handler_membership_id: string | null
            store_uuid: string | null
          }
          itemHandlerId = row.current_handler_membership_id ?? null
          itemStoreUuid = row.store_uuid ?? null
        }
      }
      // payout 자체가 없으면 RPC 가 PAYOUT_NOT_FOUND 로 최종 차단.
      // 여기서는 handler fallback 만 유지.
    }

    // role + (handler + permission) + reauth + rate-limit + dup + day
    const guard = await ownerFinancialGuard({
      auth,
      supabase,
      routeLabel: "cross_store_payout_cancel",
      entityTable: "payout_records",
      rateLimitKey: `xs-payout-cancel:${auth.user_id}`,
      rateLimitPerMin: 20,
      dupKey: `xs-payout-cancel-dup:${auth.user_id}:${cheapHash(payout_id)}`,
      dupWindowMs: 5000,
      requireItemScope: {
        itemHandlerMembershipId: itemHandlerId,
        permissionKey: "cross_store_payout",
        itemStoreUuid: itemStoreUuid ?? auth.store_uuid,
      },
    })
    if (guard.error) return guard.error

    const { data, error } = await supabase.rpc("cancel_cross_store_payout", {
      p_store_uuid: auth.store_uuid,
      p_payout_id: payout_id,
      p_reason: reason,
      p_actor: auth.user_id,
      p_executor_membership_id: executorMembershipId,
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
        executor_membership_id: executorMembershipId,
        executor_role: guard.executorRole,
        permission_id: guard.permissionId,
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
