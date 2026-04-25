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
  AMOUNT_INVALID: {
    status: 400,
    error: "AMOUNT_INVALID",
    message: "지급 금액은 유효한 양수여야 합니다.",
  },
  STORE_UUID_NULL: {
    status: 400,
    error: "STORE_UUID_NULL",
    message: "요청자의 store_uuid 가 누락됐습니다.",
  },
  HEADER_NOT_FOUND: {
    status: 404,
    error: "HEADER_NOT_FOUND",
    message:
      "정산 헤더를 찾을 수 없습니다. aggregate 로 item 이 먼저 생성되어 있는지 확인하세요 (AGGREGATE_REQUIRED).",
  },
  ITEM_NOT_IN_HEADER: {
    status: 404,
    error: "ITEM_NOT_IN_HEADER",
    message: "해당 item 이 지정된 헤더에 존재하지 않습니다.",
  },
  // RPC 는 MANAGER_NULL 을 반환하지만, 운영 어휘로 'MANAGER_UNASSIGNED' 가
  // 더 명확 — 이 라운드부터 route 층에서 별칭 처리.
  MANAGER_NULL: {
    status: 409,
    error: "MANAGER_UNASSIGNED",
    message:
      "해당 item 에 담당 실장이 배정되지 않아 지급할 수 없습니다. 먼저 실장 배정 경로로 보정하세요.",
  },
  OVERPAY: {
    status: 409,
    error: "OVERPAY",
    message: "item 의 잔액(remaining_amount) 을 초과하는 지급은 허용되지 않습니다.",
  },
  HEADER_REMAINING_NEGATIVE: {
    status: 409,
    error: "HEADER_REMAINING_NEGATIVE",
    message: "정산 헤더 잔액이 음수가 됩니다. 금액을 조정하세요.",
  },
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

    // Phase 10 (handover) 보강:
    //   executor 결정 우선순위 (Phase 10.1):
    //     (1) body.executor_membership_id (명시)
    //     (2) items.current_handler_membership_id (handler 자동 매핑)
    //     (3) auth.membership_id (caller 본인)
    //   RPC 는 migration 078 로 p_executor_membership_id 파라미터 지원 →
    //   후속 UPDATE 제거. INSERT 시점에 한 트랜잭션으로 원자적 기록.
    const bodyExecutor = body.executor_membership_id
    const explicitExecutor =
      typeof bodyExecutor === "string" ? parseUuid(bodyExecutor) : null
    if (typeof bodyExecutor === "string" && bodyExecutor.length > 0 && !explicitExecutor) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "executor_membership_id must be a valid uuid." },
        { status: 400 },
      )
    }

    // item 조회로 handler 확인. store_uuid 가드와 handler 자동 매핑에 사용.
    //   실패 시 RPC 가 ITEM_NOT_IN_HEADER / HEADER_NOT_FOUND 로 최종 차단 —
    //   여기서는 pre-read 만. column 미적용 (077 미적용) 시 fallback NULL.
    let itemHandlerId: string | null = null
    let itemStoreUuid: string | null = null
    {
      const { data: itemRow, error: itemErr } = await supabase
        .from("cross_store_settlement_items")
        .select("current_handler_membership_id, store_uuid")
        .eq("id", item_id)
        .eq("cross_store_settlement_id", cross_store_settlement_id)
        .is("deleted_at", null)
        .maybeSingle()
      if (itemErr) {
        const msg = String(itemErr.message ?? "")
        if (/column .*current_handler_membership_id.* does not exist/i.test(msg)) {
          // 077 미적용 — handler 자동 매핑 불가. explicit / self 만 사용.
          itemHandlerId = null
        } else {
          return NextResponse.json(
            { error: "INTERNAL_ERROR", message: "item lookup failed", detail: msg },
            { status: 500 },
          )
        }
      } else if (itemRow) {
        itemHandlerId =
          typeof (itemRow as { current_handler_membership_id?: string | null })
            .current_handler_membership_id === "string"
            ? ((itemRow as { current_handler_membership_id?: string | null })
                .current_handler_membership_id as string | null)
            : null
        itemStoreUuid =
          typeof (itemRow as { store_uuid?: string }).store_uuid === "string"
            ? ((itemRow as { store_uuid: string }).store_uuid)
            : null
      }
    }

    const executorMembershipId =
      explicitExecutor ?? itemHandlerId ?? auth.membership_id

    // executor 가 payer 매장 (items.store_uuid 또는 auth.store_uuid) 소속
    //   approved membership 인지 검증. 자기 자신(auth.membership_id) 는 이미
    //   resolveAuthContext 가 검증한 상태라 스킵 가능 — 그 외에만 검사.
    if (executorMembershipId !== auth.membership_id) {
      const expectedStore = itemStoreUuid ?? auth.store_uuid
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
      if (em.store_uuid !== expectedStore) {
        return NextResponse.json(
          {
            error: "EXECUTOR_STORE_MISMATCH",
            message: "executor 는 payer 매장 소속이어야 합니다.",
            executor_store_uuid: em.store_uuid,
            expected_store_uuid: expectedStore,
          },
          { status: 400 },
        )
      }
    }

    // Phase 10: role + (handler + permission) + reauth + rate-limit + dup + day.
    //   manager 경로는 requireItemScope 가 전달될 때만 활성화.
    //   077 미적용 fallback: itemStoreUuid 가 null 이면 auth.store_uuid 사용.
    const guard = await ownerFinancialGuard({
      auth,
      supabase,
      routeLabel: "cross_store_payout",
      entityTable: "cross_store_settlement_items",
      rateLimitKey: `xs-payout:${auth.user_id}`,
      rateLimitPerMin: 20,
      dupKey: `xs-payout-dup:${auth.user_id}:${cheapHash(`${cross_store_settlement_id}|${item_id}|${amountNum}`)}`,
      dupWindowMs: 3000,
      requireItemScope: {
        itemHandlerMembershipId: itemHandlerId,
        permissionKey: "cross_store_payout",
        itemStoreUuid: itemStoreUuid ?? auth.store_uuid,
      },
    })
    if (guard.error) return guard.error

    const { data, error } = await supabase.rpc("record_cross_store_payout", {
      p_from_store_uuid: auth.store_uuid,
      p_cross_store_settlement_id: cross_store_settlement_id,
      p_item_id: item_id,
      p_amount: amountNum,
      p_memo: memo,
      p_created_by: auth.user_id,
      p_executor_membership_id: executorMembershipId,
    })

    if (error) {
      const mapped = mapRpcError(error.message ?? "", RPC_ERROR_MAP)
      // MANAGER_NULL 은 MANAGER_UNASSIGNED 별칭으로 매핑됨 (위 RPC_ERROR_MAP).
      const AUDITED_BUSINESS_ERRORS = [
        "OVERPAY",
        "HEADER_REMAINING_NEGATIVE",
        "MANAGER_UNASSIGNED",
        "HEADER_NOT_FOUND",
        "ITEM_NOT_IN_HEADER",
      ]
      if (AUDITED_BUSINESS_ERRORS.includes(mapped.error)) {
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

    // Phase 10.1: executor 는 RPC (078) 이 INSERT 시점에 원자적으로 기록.
    //   후속 UPDATE 제거 — race window 없음.

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
        executor_membership_id: executorMembershipId,
        executor_role: guard.executorRole,
        permission_id: guard.permissionId,
        new_item_status: (result as { item?: { status?: string } }).item?.status ?? null,
        new_header_status: (result as { header?: { status?: string } }).header?.status ?? null,
      },
      reason: memo,
    })

    return NextResponse.json(
      { ...result, executor_membership_id: executorMembershipId },
      { status: 201 },
    )
  } catch (error) {
    return handleRouteError(error, "cross-store/payout")
  }
}
