import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { writeSessionAudit } from "@/lib/session/auditWriter"
import { isValidUUID } from "@/lib/validation"
import { calculateSettlementTotals } from "@/lib/settlement/services/calculateSettlement"
import { resolveOwnerVisibility, applyOwnerVisibility } from "@/lib/settlement/services/ownerVisibility"
import type { ParticipantRow, OrderRow } from "@/lib/settlement/liveTypes"

export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    // Role gate: owner/manager only, hostess forbidden
    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to create settlements." },
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

    // 1. Verify session exists and belongs to this store
    const { data: session, error: sessionError } = await supabase
      .from("room_sessions")
      .select("id, store_uuid, room_uuid, business_day_id, status")
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
        { error: "SESSION_NOT_CLOSED", message: "Session must be closed before settlement. Current status: " + session.status },
        { status: 400 }
      )
    }

    if (!session.business_day_id) {
      return NextResponse.json(
        { error: "NO_BUSINESS_DAY", message: "Session has no business_day_id." },
        { status: 400 }
      )
    }

    // 1.5 마감 후 수정 제한
    {
      const { data: bizDay } = await supabase
        .from("store_operating_days")
        .select("status")
        .eq("id", session.business_day_id)
        .eq("store_uuid", authContext.store_uuid)
        .is("deleted_at", null)
        .maybeSingle()
      if (bizDay && bizDay.status === "closed") {
        return NextResponse.json(
          { error: "BUSINESS_DAY_CLOSED", message: "영업일이 마감되었습니다. 정산을 수정할 수 없습니다." },
          { status: 403 }
        )
      }
    }

    // 2. Check for existing draft receipt (prevent duplicate)
    const { data: existingReceipt } = await supabase
      .from("receipts")
      .select("id, status, version")
      .eq("session_id", session_id)
      .eq("store_uuid", authContext.store_uuid)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existingReceipt && existingReceipt.status === "finalized") {
      return NextResponse.json(
        { error: "ALREADY_FINALIZED", message: "Settlement is already finalized. Cannot overwrite." },
        { status: 409 }
      )
    }

    // 3. Fetch session_participants (scoped by store_uuid)
    const { data: participants, error: participantsError } = await supabase
      .from("session_participants")
      .select("id, membership_id, role, category, price_amount, manager_payout_amount, hostess_payout_amount, time_minutes, status, origin_store_uuid")
      .eq("session_id", session_id)
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)

    if (participantsError) {
      return NextResponse.json(
        { error: "QUERY_FAILED", message: "Failed to query participants." },
        { status: 500 }
      )
    }

    // 4. Fetch orders (scoped by store_uuid)
    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("id, qty, unit_price, store_price, sale_price, manager_amount, customer_amount, inventory_item_id")
      .eq("session_id", session_id)
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)

    if (ordersError) {
      return NextResponse.json(
        { error: "QUERY_FAILED", message: "Failed to query orders." },
        { status: 500 }
      )
    }

    // 4.5 Fetch inventory unit_cost for inventory-linked orders
    const typedOrders = (orders ?? []) as OrderRow[]
    const inventoryItemIds = Array.from(
      new Set(typedOrders.map((o) => o.inventory_item_id).filter((x): x is string => !!x))
    )
    const unitCostByItemId = new Map<string, number>()
    if (inventoryItemIds.length > 0) {
      const { data: invRows } = await supabase
        .from("inventory_items")
        .select("id, unit_cost")
        .in("id", inventoryItemIds)
        .eq("store_uuid", authContext.store_uuid)
      for (const r of (invRows ?? []) as { id: string; unit_cost: number | null }[]) {
        unitCostByItemId.set(r.id, Number(r.unit_cost ?? 0))
      }
    }

    // 5. Fetch store settings for TC rate
    const { data: settings } = await supabase
      .from("store_settings")
      .select("tc_rate, rounding_unit")
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle()

    const tcRate = Number(settings?.tc_rate ?? 0)
    const roundingUnit = settings?.rounding_unit ?? 1000

    // 5.1 Calculate all settlement totals (pure function, zero I/O)
    const typedParticipants = (participants ?? []) as ParticipantRow[]
    const totals = calculateSettlementTotals(
      typedParticipants,
      typedOrders,
      unitCostByItemId,
      { tcRate, roundingUnit }
    )

    // 5.5 선정산
    const { data: preSettlements } = await supabase
      .from("pre_settlements")
      .select("id, amount")
      .eq("session_id", session_id)
      .eq("store_uuid", authContext.store_uuid)
      .eq("status", "active")
      .is("deleted_at", null)

    const preSettlementTotal = (preSettlements ?? []).reduce(
      (sum: number, ps: { amount: number }) => sum + (ps.amount ?? 0), 0
    )

    // 5.6 Locked invariant guard
    if (totals.managerProfitFromParticipants + totals.hostessProfitTotal > totals.participantFlowTotal) {
      return NextResponse.json(
        {
          error: "REMAINDER_NEGATIVE",
          message: "정산 잔액이 음수입니다. 실장+아가씨 지급 합계가 타임 단가 합계를 초과합니다.",
          participant_flow_total: totals.participantFlowTotal,
          manager_profit_from_participants: totals.managerProfitFromParticipants,
          hostess_profit_total: totals.hostessProfitTotal,
        },
        { status: 409 }
      )
    }

    // 6. Build snapshot
    const crossStoreParticipants = typedParticipants.filter((p) => !!p.origin_store_uuid)
    const snapshot = {
      participants: typedParticipants.map((p) => ({
        id: p.id,
        membership_id: p.membership_id,
        role: p.role,
        category: p.category,
        price_amount: p.price_amount,
        manager_payout_amount: p.manager_payout_amount,
        hostess_payout_amount: p.hostess_payout_amount,
        time_minutes: p.time_minutes,
        status: p.status,
        origin_store_uuid: p.origin_store_uuid,
      })),
      orders: typedOrders.map((o) => ({
        id: o.id,
        qty: o.qty,
        unit_price: o.unit_price,
        store_price: o.store_price,
        sale_price: o.sale_price,
        manager_amount: o.manager_amount,
        customer_amount: o.customer_amount,
        amount: o.customer_amount ?? (o.qty * o.unit_price),
      })),
      pre_settlements: (preSettlements ?? []).map((ps: { id: string; amount: number }) => ({
        id: ps.id,
        amount: ps.amount,
      })),
      pre_settlement_total: preSettlementTotal,
      cross_store: {
        hostess_amount_local: totals.hostessAmountLocal,
        hostess_amount_cross_store: totals.hostessAmountCrossStore,
        cross_store_participants: crossStoreParticipants.map((p) => ({
          membership_id: p.membership_id,
          origin_store_uuid: p.origin_store_uuid,
          hostess_payout_amount: p.hostess_payout_amount,
        })),
      },
      settlement_method: "fixed_amount",
      tc_rate: tcRate,
      rounding_unit: roundingUnit,
      calculated_at: new Date().toISOString(),
      formula_version: "v2-relock-2026-04-16",
      customer_total: totals.customerTotal,
      participant_flow_total: totals.participantFlowTotal,
      manager_profit_total: totals.managerProfitTotal,
      manager_profit_from_participants: totals.managerProfitFromParticipants,
      manager_profit_from_liquor: totals.managerProfitFromLiquor,
      hostess_profit_total: totals.hostessProfitTotal,
      liquor_customer_total: totals.liquorCustomerTotal,
      liquor_deposit_total: totals.liquorDepositTotal,
      bottle_cost_total: totals.bottleCostTotal,
      store_revenue_total: totals.storeRevenueTotal,
      store_profit_total: totals.storeProfitTotal,
      tc_count: totals.tcCount,
      tc_amount_legacy_unused_in_settlement: totals.tcAmountLegacy,
    }

    // 7. INSERT or UPDATE receipts
    const nextVersion = existingReceipt ? existingReceipt.version + 1 : 1

    let receiptId: string
    let receiptStatus: string

    if (existingReceipt && existingReceipt.status === "draft") {
      const { data: updated, error: updateError } = await supabase
        .from("receipts")
        .update({
          version: nextVersion,
          gross_total: totals.grossTotal,
          tc_amount: totals.tcAmount,
          manager_amount: totals.managerAmount,
          hostess_amount: totals.hostessAmount,
          margin_amount: totals.marginAmount,
          order_total_amount: totals.orderTotal,
          participant_total_amount: totals.participantTotal,
          pre_settlement_total: preSettlementTotal,
          discount_amount: 0,
          service_amount: 0,
          status: "draft",
          snapshot,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingReceipt.id)
        .eq("store_uuid", authContext.store_uuid)
        .eq("version", existingReceipt.version)
        .select("id, status")
        .maybeSingle()

      if (updateError) {
        return NextResponse.json(
          { error: "SETTLEMENT_UPDATE_FAILED", message: "Failed to update settlement." },
          { status: 500 }
        )
      }
      if (!updated) {
        return NextResponse.json(
          { error: "VERSION_CONFLICT", message: "정산이 동시에 수정되었습니다. 다시 시도해 주세요." },
          { status: 409 }
        )
      }
      receiptId = updated.id
      receiptStatus = updated.status
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("receipts")
        .insert({
          session_id,
          store_uuid: authContext.store_uuid,
          business_day_id: session.business_day_id,
          version: nextVersion,
          gross_total: totals.grossTotal,
          tc_amount: totals.tcAmount,
          manager_amount: totals.managerAmount,
          hostess_amount: totals.hostessAmount,
          margin_amount: totals.marginAmount,
          order_total_amount: totals.orderTotal,
          participant_total_amount: totals.participantTotal,
          pre_settlement_total: preSettlementTotal,
          discount_amount: 0,
          service_amount: 0,
          status: "draft",
          snapshot,
        })
        .select("id, status")
        .single()

      if (insertError || !inserted) {
        return NextResponse.json(
          { error: "SETTLEMENT_CREATE_FAILED", message: "Failed to create settlement." },
          { status: 500 }
        )
      }
      receiptId = inserted.id
      receiptStatus = inserted.status
    }

    // 7.5 선정산 상태 deducted로 변경
    if (preSettlements && preSettlements.length > 0) {
      const preIds = preSettlements.map((ps: { id: string }) => ps.id)
      await supabase
        .from("pre_settlements")
        .update({
          status: "deducted",
          deducted_at: new Date().toISOString(),
          deducted_receipt_id: receiptId,
          updated_at: new Date().toISOString(),
        })
        .in("id", preIds)
        .eq("store_uuid", authContext.store_uuid)
    }

    // 8. Audit event
    await writeSessionAudit(supabase, {
      auth: authContext,
      session_id,
      entity_table: "receipts",
      entity_id: receiptId,
      action: existingReceipt ? "settlement_recalculated" : "settlement_created",
      after: {
        receipt_id: receiptId,
        version: nextVersion,
        formula_version: "v2-relock-2026-04-16",
        customer_total: totals.customerTotal,
        participant_flow_total: totals.participantFlowTotal,
        manager_profit_total: totals.managerProfitTotal,
        hostess_profit_total: totals.hostessProfitTotal,
        store_revenue_total: totals.storeRevenueTotal,
        store_profit_total: totals.storeProfitTotal,
        bottle_cost_total: totals.bottleCostTotal,
        tc_count: totals.tcCount,
        gross_total: totals.grossTotal,
        tc_amount: totals.tcAmount,
        manager_amount: totals.managerAmount,
        hostess_amount: totals.hostessAmount,
        margin_amount: totals.marginAmount,
        order_total_amount: totals.orderTotal,
        participant_total_amount: totals.participantTotal,
        status: "draft",
      },
    })

    // 9. Owner visibility
    const responseData: Record<string, unknown> = {
      receipt_id: receiptId,
      session_id,
      version: nextVersion,
      formula_version: "v2-relock-2026-04-16",
      customer_total: totals.customerTotal,
      participant_flow_total: totals.participantFlowTotal,
      store_revenue_total: totals.storeRevenueTotal,
      store_profit_total: totals.storeProfitTotal,
      bottle_cost_total: totals.bottleCostTotal,
      tc_count: totals.tcCount,
      gross_total: totals.grossTotal,
      tc_amount: totals.tcAmount,
      margin_amount: totals.marginAmount,
      order_total_amount: totals.orderTotal,
      participant_total_amount: totals.participantTotal,
      pre_settlement_total: preSettlementTotal,
      status: receiptStatus,
    }

    const ownerFlags = authContext.role === "owner"
      ? await resolveOwnerVisibility(supabase, authContext.store_uuid)
      : { showManager: true, showHostess: true }

    applyOwnerVisibility(responseData, authContext.role, ownerFlags, {
      managerAmount: totals.managerAmount,
      hostessAmount: totals.hostessAmount,
      managerProfitTotal: totals.managerProfitTotal,
      hostessProfitTotal: totals.hostessProfitTotal,
    })

    return NextResponse.json(responseData, { status: existingReceipt ? 200 : 201 })
  } catch (error) {
    return handleRouteError(error, "settlement")
  }
}
