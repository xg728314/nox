import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { assertBusinessDayOpen } from "@/lib/auth/assertBusinessDayOpen"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { writeSessionAudit } from "@/lib/session/auditWriter"
import { isValidUUID } from "@/lib/validation"

// Action handlers
import { handleUpdateExternalName } from "@/lib/session/services/participantActions/updateExternalName"
import { fillUnspecified } from "@/lib/session/services/participantActions/fillUnspecified"
import { toggleWaiterTip } from "@/lib/session/services/participantActions/toggleWaiterTip"
import { updateCategory } from "@/lib/session/services/participantActions/updateCategory"
import { updateTimeOrPrice } from "@/lib/session/services/participantActions/updateTimeOrPrice"
import { applyCha3 } from "@/lib/session/services/participantActions/applyCha3"
import { applyBanti } from "@/lib/session/services/participantActions/applyBanti"
import { applyWanti } from "@/lib/session/services/participantActions/applyWanti"
import { updateDeduction } from "@/lib/session/services/participantActions/updateDeduction"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ participant_id: string }> }
) {
  try {
    const authContext = await resolveAuthContext(request)
    if (authContext.role === "hostess") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted." }, { status: 403 })
    }

    const { participant_id } = await params
    if (!participant_id || !isValidUUID(participant_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "participant_id must be a valid UUID." }, { status: 400 })
    }

    const parsed = await parseJsonBody<{ manager_deduction?: number; action?: string; time_minutes?: number; price_amount?: number; category?: string; waiter_tip_amount?: number; membership_id?: string | null; external_name?: string; entered_at?: string; manager_membership_id?: string; origin_store_uuid?: string }>(request)
    if (parsed.error) return parsed.error
    const body = parsed.body

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // ── Action: update_external_name (self-contained handler with own auth/lookup) ──
    if (body.action === "update_external_name") {
      return handleUpdateExternalName(supabase, authContext, participant_id, body.external_name)
    }

    // 2026-05-01 R-Counter-Speed: participant + receipt + session 검증 직렬 →
    //   participant 먼저 await (다음 query 들이 session_id 의존), 그 후
    //   receipts + room_sessions Promise.all. 1단계 절감.
    const { data: participant, error: pError } = await supabase
      .from("session_participants")
      .select("id, session_id, store_uuid, price_amount, manager_payout_amount, hostess_payout_amount, category, time_minutes, cha3_amount, banti_amount, waiter_tip_received, waiter_tip_amount, status, updated_at")
      .eq("id", participant_id)
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .maybeSingle()

    if (pError || !participant) {
      return NextResponse.json({ error: "PARTICIPANT_NOT_FOUND", message: "Participant not found." }, { status: 404 })
    }

    // receipts + room_sessions 병렬 (둘 다 session_id 만 의존).
    const [receiptRes, sessionBizRes] = await Promise.all([
      supabase
        .from("receipts")
        .select("id, status")
        .eq("session_id", participant.session_id)
        .eq("store_uuid", authContext.store_uuid)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("room_sessions")
        .select("business_day_id, status")
        .eq("id", participant.session_id)
        .eq("store_uuid", authContext.store_uuid)
        .is("deleted_at", null)
        .maybeSingle(),
    ])

    const receipt = receiptRes.data
    if (receipt && receipt.status === "finalized") {
      return NextResponse.json({ error: "ALREADY_FINALIZED", message: "정산이 확정된 세션입니다." }, { status: 409 })
    }

    const sessionBizDay = sessionBizRes.data
    if (sessionBizDay && sessionBizDay.status !== "active") {
      return NextResponse.json(
        { error: "SESSION_NOT_ACTIVE", message: "세션이 종료되어 수정할 수 없습니다." },
        { status: 409 }
      )
    }
    const guard = await assertBusinessDayOpen(supabase, sessionBizDay?.business_day_id ?? null)
    if (guard) return guard

    // ── Action dispatch ──
    let updatePayload: Record<string, number | string | boolean> = { updated_at: new Date().toISOString() }
    let actionLabel = ""

    if (body.membership_id !== undefined) {
      const result = await fillUnspecified(supabase, authContext.store_uuid, { ...body, membership_id: body.membership_id }, participant)
      if (result.error) return result.error
      updatePayload = { ...updatePayload, ...result.updatePayload }
      actionLabel = result.actionLabel

    } else if (body.action === "toggle_waiter_tip") {
      const result = toggleWaiterTip(participant, body.waiter_tip_amount)
      if ("error" in result) return result.error
      updatePayload = { ...updatePayload, ...result.updatePayload }
      actionLabel = result.actionLabel

    } else if (body.category !== undefined) {
      const VALID = ["퍼블릭", "셔츠", "하퍼"]
      if (!VALID.includes(body.category)) {
        return NextResponse.json({ error: "BAD_REQUEST", message: "category must be one of: 퍼블릭, 셔츠, 하퍼." }, { status: 400 })
      }
      const result = await updateCategory(supabase, authContext.store_uuid, body.category, participant)
      updatePayload = { ...updatePayload, ...result.updatePayload }
      actionLabel = result.actionLabel

    } else if (body.time_minutes !== undefined && body.price_amount !== undefined) {
      const result = updateTimeOrPrice(body.time_minutes, body.price_amount, participant)
      if ("error" in result) return result.error
      updatePayload = { ...updatePayload, ...result.updatePayload }
      actionLabel = result.actionLabel

    } else if (body.action === "cha3") {
      const result = applyCha3(participant)
      updatePayload = { ...updatePayload, ...result.updatePayload }
      actionLabel = result.actionLabel

    } else if (body.action === "banti") {
      const result = applyBanti(participant)
      updatePayload = { ...updatePayload, ...result.updatePayload }
      actionLabel = result.actionLabel

    } else if (body.action === "wanti") {
      const result = await applyWanti(supabase, authContext.store_uuid, participant)
      updatePayload = { ...updatePayload, ...result.updatePayload }
      actionLabel = result.actionLabel

    } else if (body.manager_deduction !== undefined) {
      const result = updateDeduction(body.manager_deduction, participant)
      if ("error" in result) return result.error
      updatePayload = { ...updatePayload, ...result.updatePayload }
      actionLabel = result.actionLabel

    } else {
      return NextResponse.json({ error: "BAD_REQUEST", message: "action, manager_deduction, or (time_minutes + price_amount) is required." }, { status: 400 })
    }

    // ── DB write + audit + response ──
    const { data: updated, error: updateError } = await supabase
      .from("session_participants")
      .update(updatePayload)
      .eq("id", participant_id)
      .eq("store_uuid", authContext.store_uuid)
      .eq("updated_at", participant.updated_at)
      .select("id, session_id, membership_id, category, price_amount, manager_payout_amount, hostess_payout_amount, cha3_amount, banti_amount, waiter_tip_received, waiter_tip_amount")
      .maybeSingle()

    if (updateError) {
      return NextResponse.json({ error: "UPDATE_FAILED", message: "Failed to update participant." }, { status: 500 })
    }
    if (!updated) {
      return NextResponse.json({ error: "VERSION_CONFLICT", message: "참여자 정보가 동시에 수정되었습니다. 다시 시도해 주세요." }, { status: 409 })
    }

    // 2026-05-01 R-Counter-Speed: audit background fire (await 제거).
    void writeSessionAudit(supabase, {
      auth: authContext,
      session_id: participant.session_id,
      entity_table: "session_participants",
      entity_id: participant_id,
      action: actionLabel,
      before: { price_amount: participant.price_amount, manager_payout_amount: participant.manager_payout_amount },
      after: updatePayload,
    }).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn("[participant PATCH] audit failed:", e instanceof Error ? e.message : e)
    })

    return NextResponse.json({
      participant_id: updated.id,
      session_id: updated.session_id,
      membership_id: updated.membership_id,
      category: updated.category,
      price_amount: updated.price_amount,
      cha3_amount: updated.cha3_amount,
      banti_amount: updated.banti_amount,
      waiter_tip_received: updated.waiter_tip_received,
      waiter_tip_amount: updated.waiter_tip_amount,
      manager_deduction: updated.manager_payout_amount,
      hostess_payout: updated.hostess_payout_amount,
    })
  } catch (error) {
    return handleRouteError(error, "participants/[participant_id]")
  }
}
