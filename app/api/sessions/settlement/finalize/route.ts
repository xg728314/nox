import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { writeSessionAudit } from "@/lib/session/auditWriter"
import { isValidUUID } from "@/lib/validation"
import { resolveOwnerVisibility, applyOwnerVisibility } from "@/lib/settlement/services/ownerVisibility"

/**
 * POST /api/sessions/settlement/finalize
 * draft 영수증을 finalized로 확정한다.
 * 확정 전 participants 기준으로 금액을 재계산하여 최종 스냅샷을 저장한다.
 *
 * Body: { session_id: string }
 */
export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to finalize settlements." },
        { status: 403 }
      )
    }

    const parsed = await parseJsonBody<{ session_id?: string }>(request)
    if (parsed.error) return parsed.error
    const { session_id } = parsed.body

    if (!session_id || !isValidUUID(session_id)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "session_id is required and must be a valid UUID." },
        { status: 400 }
      )
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 1. 세션 확인
    const { data: session, error: sessionError } = await supabase
      .from("room_sessions")
      .select("id, store_uuid, business_day_id, status")
      .eq("id", session_id)
      .eq("store_uuid", authContext.store_uuid)
      .maybeSingle()

    if (sessionError || !session) {
      return NextResponse.json(
        { error: "SESSION_NOT_FOUND", message: "Session not found in this store." },
        { status: 404 }
      )
    }

    if (session.status !== "closed") {
      return NextResponse.json(
        { error: "SESSION_NOT_CLOSED", message: "Session must be closed before finalization." },
        { status: 400 }
      )
    }

    // 2. 마감 확인
    if (session.business_day_id) {
      const { data: bizDay } = await supabase
        .from("store_operating_days")
        .select("status")
        .eq("id", session.business_day_id)
        .maybeSingle()
      if (bizDay && bizDay.status === "closed") {
        return NextResponse.json(
          { error: "BUSINESS_DAY_CLOSED", message: "영업일이 마감되었습니다." },
          { status: 403 }
        )
      }
    }

    // 3. 기존 영수증 확인 — settlement/route.ts가 이미 계산해 둔 값을 그대로 읽는다.
    //    finalize는 더 이상 계산하지 않는다 (single source of truth = settlement/route.ts).
    const { data: existingReceipt } = await supabase
      .from("receipts")
      .select("id, status, version, gross_total, tc_amount, manager_amount, hostess_amount, margin_amount, order_total_amount, participant_total_amount, pre_settlement_total, snapshot")
      .eq("session_id", session_id)
      .eq("store_uuid", authContext.store_uuid)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!existingReceipt) {
      return NextResponse.json(
        { error: "NO_RECEIPT", message: "정산 내역이 없습니다. 먼저 정산을 생성하세요." },
        { status: 404 }
      )
    }

    if (existingReceipt.status === "finalized") {
      return NextResponse.json(
        { error: "ALREADY_FINALIZED", message: "이미 확정된 정산입니다." },
        { status: 409 }
      )
    }

    // 4. 저장된 값 그대로 사용 (재계산 금지). 모든 금액은 settlement/route.ts가
    //    STEP-NEXT-SETTLEMENT-FORMULA-LOCK 규칙으로 이미 계산해 둔 값이다.
    const grossTotal = existingReceipt.gross_total ?? 0          // legacy column ← customer_total
    const tcAmount = existingReceipt.tc_amount ?? 0              // legacy display only
    const managerAmount = existingReceipt.manager_amount ?? 0    // ← manager_profit_total
    const hostessAmount = existingReceipt.hostess_amount ?? 0    // ← hostess_profit_total
    const marginAmount = existingReceipt.margin_amount ?? 0      // ← store_profit_total
    const orderTotal = existingReceipt.order_total_amount ?? 0   // ← liquor_customer_total
    const participantTotal = existingReceipt.participant_total_amount ?? 0 // ← participant_flow_total

    const baseSnapshotForRead =
      existingReceipt.snapshot && typeof existingReceipt.snapshot === "object"
        ? (existingReceipt.snapshot as Record<string, unknown>)
        : {}
    const formulaVersion = typeof baseSnapshotForRead.formula_version === "string"
      ? (baseSnapshotForRead.formula_version as string)
      : null

    // 4.5 Locked-format gate. Receipts created under the old formula
    //     (formula_version absent) cannot be finalized — they must be re-run
    //     through settlement/route.ts so the new totals are written first.
    if (!formulaVersion || !formulaVersion.startsWith("v2-relock")) {
      return NextResponse.json(
        {
          error: "RECEIPT_LEGACY_FORMULA",
          message: "이 영수증은 구 정산 공식으로 작성되었습니다. 정산을 다시 실행한 뒤 확정해 주세요.",
        },
        { status: 409 }
      )
    }

    // 4.6 Locked invariant guard — uses the stored snapshot values, not recomputed.
    //     The labor split must not exceed participant_flow_total.
    const snapParticipantFlow = Number(baseSnapshotForRead.participant_flow_total ?? participantTotal)
    const snapManagerFromParticipants = Number(baseSnapshotForRead.manager_profit_from_participants ?? 0)
    const snapHostessTotal = Number(baseSnapshotForRead.hostess_profit_total ?? hostessAmount)
    if (snapManagerFromParticipants + snapHostessTotal > snapParticipantFlow) {
      return NextResponse.json(
        {
          error: "REMAINDER_NEGATIVE",
          message: "정산 잔액이 음수입니다. 확정할 수 없습니다.",
          participant_flow_total: snapParticipantFlow,
          manager_profit_from_participants: snapManagerFromParticipants,
          hostess_profit_total: snapHostessTotal,
        },
        { status: 409 }
      )
    }

    // Pull new locked totals from snapshot for audit/response (read-only).
    const customerTotal = Number(baseSnapshotForRead.customer_total ?? grossTotal)
    const participantFlowTotal = snapParticipantFlow
    const managerProfitTotal = Number(baseSnapshotForRead.manager_profit_total ?? managerAmount)
    const hostessProfitTotal = snapHostessTotal
    const storeRevenueTotal = Number(baseSnapshotForRead.store_revenue_total ?? 0)
    const storeProfitTotal = Number(baseSnapshotForRead.store_profit_total ?? marginAmount)
    const bottleCostTotal = Number(baseSnapshotForRead.bottle_cost_total ?? 0)
    const tcCount = Number(baseSnapshotForRead.tc_count ?? 0)

    // 5. 최종 스냅샷 — settlement/route.ts가 작성해 둔 draft snapshot을 그대로 채택하고
    //    finalized_at 만 표시한다. 새로 계산하지 않는다.
    const snapshot = {
      ...baseSnapshotForRead,
      finalized_at: new Date().toISOString(),
    }

    // 6. UPDATE receipt → finalized (status / version / snapshot 표시만, 금액은 그대로 둔다)
    const nextVersion = existingReceipt.version + 1

    // STEP-003: atomic optimistic lock on version + status='draft'. Two
    // concurrent finalize calls can both pass the read-time "already finalized"
    // check (line 98); the atomic WHERE ensures only one of them transitions
    // the receipt. The loser receives VERSION_CONFLICT rather than silently
    // double-incrementing version and producing duplicate audit entries.
    const { data: finalized, error: updateError } = await supabase
      .from("receipts")
      .update({
        version: nextVersion,
        status: "finalized",
        snapshot,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingReceipt.id)
      .eq("store_uuid", authContext.store_uuid)
      .eq("status", "draft")
      .eq("version", existingReceipt.version)
      .select("id, status, version")
      .maybeSingle()

    if (updateError) {
      return NextResponse.json(
        { error: "FINALIZE_FAILED", message: "Failed to finalize settlement." },
        { status: 500 }
      )
    }
    if (!finalized) {
      return NextResponse.json(
        { error: "VERSION_CONFLICT", message: "정산이 동시에 수정되었습니다. 다시 시도해 주세요." },
        { status: 409 }
      )
    }

    // 7. Audit
    await writeSessionAudit(supabase, {
      auth: authContext,
      session_id,
      entity_table: "receipts",
      entity_id: finalized.id,
      action: "settlement_finalized",
      after: {
        receipt_id: finalized.id,
        version: nextVersion,
        formula_version: formulaVersion,
        // New locked totals (authoritative)
        customer_total: customerTotal,
        participant_flow_total: participantFlowTotal,
        manager_profit_total: managerProfitTotal,
        hostess_profit_total: hostessProfitTotal,
        store_revenue_total: storeRevenueTotal,
        store_profit_total: storeProfitTotal,
        bottle_cost_total: bottleCostTotal,
        tc_count: tcCount,
        // Legacy column shapes (repurposed) for back-compat readers
        gross_total: grossTotal,
        tc_amount: tcAmount,
        manager_amount: managerAmount,
        hostess_amount: hostessAmount,
        margin_amount: marginAmount,
        status: "finalized",
      },
    })

    // Owner visibility: toggle-based read-through
    const responseData: Record<string, unknown> = {
      receipt_id: finalized.id,
      session_id,
      version: finalized.version,
      formula_version: formulaVersion,
      customer_total: customerTotal,
      participant_flow_total: participantFlowTotal,
      store_revenue_total: storeRevenueTotal,
      store_profit_total: storeProfitTotal,
      bottle_cost_total: bottleCostTotal,
      tc_count: tcCount,
      gross_total: grossTotal,
      tc_amount: tcAmount,
      margin_amount: marginAmount,
      order_total_amount: orderTotal,
      participant_total_amount: participantTotal,
      status: "finalized",
    }

    const ownerFlags = authContext.role === "owner"
      ? await resolveOwnerVisibility(supabase, authContext.store_uuid)
      : { showManager: true, showHostess: true }

    applyOwnerVisibility(responseData, authContext.role, ownerFlags, {
      managerAmount,
      hostessAmount,
      managerProfitTotal,
      hostessProfitTotal,
    })

    return NextResponse.json(responseData)
  } catch (error) {
    return handleRouteError(error, "finalize")
  }
}
