import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { assertBusinessDayOpen } from "@/lib/auth/assertBusinessDayOpen"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { parseJsonBody } from "@/lib/session/parseBody"
import { loadSessionScoped } from "@/lib/session/sessionLoader"
import { writeSessionAudit } from "@/lib/session/auditWriter"

export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    // Role gate: owner/manager only, hostess forbidden
    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to perform mid-out." },
        { status: 403 }
      )
    }

    const parsed = await parseJsonBody<{
      session_id?: string
      participant_id?: string
    }>(request)
    if (parsed.error) return parsed.error
    const { session_id, participant_id } = parsed.body

    if (!session_id) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "session_id is required." },
        { status: 400 }
      )
    }
    if (!participant_id) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "participant_id is required." },
        { status: 400 }
      )
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 1-2. Load session + store scope + active status
    const loaded = await loadSessionScoped(supabase, session_id, authContext.store_uuid, { requireStatus: "active" })
    if (loaded.error) return loaded.error
    const session = loaded.session

    // 3. Business day closure guard
    {
      const guard = await assertBusinessDayOpen(supabase, session.business_day_id)
      if (guard) return guard
    }

    // 3. Look up participant and verify active status
    const { data: participant, error: participantError } = await supabase
      .from("session_participants")
      .select("id, session_id, status, entered_at, price_amount")
      .eq("id", participant_id)
      .eq("session_id", session_id)
      .eq("store_uuid", authContext.store_uuid)
      .is("deleted_at", null)
      .maybeSingle()

    if (participantError || !participant) {
      return NextResponse.json(
        { error: "PARTICIPANT_NOT_FOUND", message: `Participant not found: ${participantError?.message || "no match"}`, participant_id, session_id },
        { status: 404 }
      )
    }

    if (participant.status !== "active") {
      return NextResponse.json(
        { error: "PARTICIPANT_NOT_ACTIVE", message: "Participant is not active." },
        { status: 400 }
      )
    }

    // 3-1. Determine exit_type: kicked (< 12분) vs left (≥ 12분)
    const KICK_THRESHOLD_MS = 12 * 60 * 1000
    const nowMs = Date.now()
    const enteredMs = participant.entered_at ? new Date(participant.entered_at).getTime() : nowMs
    const elapsedMs = nowMs - enteredMs
    const exitType = elapsedMs < KICK_THRESHOLD_MS ? "kicked" : "left"

    const beforeState = {
      status: participant.status,
      price_amount: participant.price_amount,
    }

    // 4. UPDATE session_participant: status='left', left_at
    const leftAt = new Date().toISOString()
    const updateFields: Record<string, unknown> = {
      status: "left",
      left_at: leftAt,
    }
    if (exitType === "kicked") {
      updateFields.price_amount = 0
      updateFields.manager_payout_amount = 0
      updateFields.hostess_payout_amount = 0
      updateFields.margin_amount = 0
    }

    // 2026-05-03 R-Speed-x10: 4 RTT (UPDATE → SELECT → UPDATE exit_type → audit)
    //   → 1 RTT (UPDATE returning + audit background). 약 400ms 절감.
    updateFields.exit_type = exitType

    type UpdatedRow = { id: string; session_id: string; status: string; left_at: string; price_amount: number }
    let updated: UpdatedRow | null = null
    const { data: u1, error: u1Err } = await supabase
      .from("session_participants")
      .update(updateFields)
      .eq("id", participant_id)
      .eq("store_uuid", authContext.store_uuid)
      .select("id, session_id, status, left_at, price_amount")
      .single()

    if (!u1Err && u1) {
      updated = u1 as UpdatedRow
    } else {
      // exit_type 컬럼 부재 (migration 013 미적용) fallback.
      const fallbackFields = { ...updateFields }
      delete fallbackFields.exit_type
      const { data: u2, error: u2Err } = await supabase
        .from("session_participants")
        .update(fallbackFields)
        .eq("id", participant_id)
        .eq("store_uuid", authContext.store_uuid)
        .select("id, session_id, status, left_at, price_amount")
        .single()
      if (u2Err || !u2) {
        return NextResponse.json(
          {
            error: "MID_OUT_FAILED",
            message: `Failed to update participant: ${(u1Err ?? u2Err)?.message ?? "unknown"}`,
          },
          { status: 500 }
        )
      }
      updated = u2 as UpdatedRow
    }

    if (!updated) {
      return NextResponse.json(
        { error: "MID_OUT_FAILED", message: "Update succeeded but no row returned.", participant_id },
        { status: 500 }
      )
    }

    // 5. Audit — background fire (응답 latency 차감 ~150ms).
    void writeSessionAudit(supabase, {
      auth: authContext,
      session_id,
      entity_table: "session_participants",
      entity_id: participant_id,
      action: exitType === "kicked" ? "participant_kicked" : "participant_mid_out",
      before: beforeState,
      after: {
        status: updated.status,
        left_at: updated.left_at,
        exit_type: exitType,
        price_amount: updated.price_amount,
      },
    }).catch((e) => {
      console.warn("[mid-out] audit failed:", e instanceof Error ? e.message : e)
    })

    return NextResponse.json(
      {
        participant_id: updated.id,
        session_id: updated.session_id,
        status: updated.status,
        left_at: updated.left_at,
        exit_type: exitType,
        elapsed_minutes: Math.floor(elapsedMs / 60000),
      },
      { status: 200 }
    )
  } catch (error) {
    return handleRouteError(error, "mid-out")
  }
}
