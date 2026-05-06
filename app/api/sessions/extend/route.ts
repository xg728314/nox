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
        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to extend sessions." },
        { status: 403 }
      )
    }

    const parsed = await parseJsonBody<{
      session_id?: string
      participant_id?: string
      extend_minutes?: number
    }>(request)
    if (parsed.error) return parsed.error
    const { session_id, participant_id, extend_minutes } = parsed.body

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
    if (extend_minutes === undefined || extend_minutes === null || typeof extend_minutes !== "number") {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "extend_minutes is required and must be a number." },
        { status: 400 }
      )
    }
    if (extend_minutes <= 0 || extend_minutes % 15 !== 0) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "extend_minutes must be a positive multiple of 15." },
        { status: 400 }
      )
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 2026-05-06: session + participant 병렬 fetch (둘 다 session_id/participant_id
    //   만 의존). 직렬 2 RTT → 1 RTT.
    const [loaded, participantRes] = await Promise.all([
      loadSessionScoped(supabase, session_id, authContext.store_uuid, { requireStatus: "active" }),
      supabase
        .from("session_participants")
        .select("id, session_id, time_minutes, price_amount, category, status")
        .eq("id", participant_id)
        .eq("session_id", session_id)
        .eq("store_uuid", authContext.store_uuid)
        .is("deleted_at", null)
        .maybeSingle(),
    ])
    if (loaded.error) return loaded.error
    const session = loaded.session

    // 3. Business day closure guard
    {
      const guard = await assertBusinessDayOpen(supabase, session.business_day_id)
      if (guard) return guard
    }

    const { data: participant, error: participantError } = participantRes

    if (participantError || !participant) {
      return NextResponse.json(
        { error: "PARTICIPANT_NOT_FOUND", message: "Participant not found." },
        { status: 404 }
      )
    }

    if (participant.status !== "active") {
      return NextResponse.json(
        { error: "PARTICIPANT_NOT_ACTIVE", message: "Participant is not active." },
        { status: 400 }
      )
    }

    // 4. Calculate updated values server-side
    const newTimeMinutes = participant.time_minutes + extend_minutes

    // DB 기반 단가 조회: extend_minutes에 해당하는 store_service_types 가격을 더함
    let extendPrice = 0
    if (participant.category) {
      const { data: sst } = await supabase
        .from("store_service_types")
        .select("price")
        .eq("store_uuid", session.store_uuid)
        .eq("service_type", participant.category)
        .eq("time_minutes", extend_minutes)
        .eq("is_active", true)
        .maybeSingle()
      if (sst) {
        extendPrice = sst.price
      }
    }

    let newPriceAmount: number
    if (extendPrice > 0) {
      newPriceAmount = participant.price_amount + extendPrice
    } else if (participant.time_minutes > 0 && participant.price_amount > 0) {
      // Fallback: proportional per-minute rate
      const unitRate = participant.price_amount / participant.time_minutes
      newPriceAmount = Math.round(unitRate * newTimeMinutes)
    } else {
      newPriceAmount = participant.price_amount
    }

    const beforeState = {
      time_minutes: participant.time_minutes,
      price_amount: participant.price_amount,
      status: participant.status,
    }

    // 5. UPDATE session_participant
    // 2026-05-06 fix: Extend + Mid-out race condition.
    //   기존 WHERE: id + store_uuid 만 사용. 동시 mid-out 이 status='left' 로
    //   바꾼 직후 extend UPDATE 가 통과 → status='left' 인데 time_minutes=90
    //   부정합 (mid-out 이 price=0 했으면 extend price 가 덮어씀).
    //   현재: WHERE 에 status='active' 추가. mid-out 이 먼저 통과했으면 0 rows
    //   return → "PARTICIPANT_NOT_ACTIVE" 응답 → 클라가 정확한 상태 인식.
    const { data: updated, error: updateError } = await supabase
      .from("session_participants")
      .update({
        time_minutes: newTimeMinutes,
        price_amount: newPriceAmount,
      })
      .eq("id", participant_id)
      .eq("store_uuid", authContext.store_uuid)
      .eq("status", "active")
      .is("deleted_at", null)
      .select("id, session_id, time_minutes, price_amount, status")
      .maybeSingle()

    if (updateError) {
      return NextResponse.json(
        { error: "EXTEND_FAILED", message: "Failed to extend session participant." },
        { status: 500 }
      )
    }
    if (!updated) {
      // Race: mid-out 이 먼저 통과해서 status 가 'active' 가 아닌 상태.
      return NextResponse.json(
        {
          error: "PARTICIPANT_NOT_ACTIVE",
          message: "이 스태프는 이미 퇴실 처리되어 연장할 수 없습니다.",
        },
        { status: 409 }
      )
    }

    // 6. Record audit event
    await writeSessionAudit(supabase, {
      auth: authContext,
      session_id,
      entity_table: "session_participants",
      entity_id: participant_id,
      action: "participant_extended",
      before: beforeState,
      after: {
        time_minutes: newTimeMinutes,
        price_amount: newPriceAmount,
        status: updated.status,
        extend_minutes,
      },
    })

    return NextResponse.json(
      {
        participant_id: updated.id,
        session_id: updated.session_id,
        time_minutes: updated.time_minutes,
        status: updated.status,
      },
      { status: 200 }
    )
  } catch (error) {
    return handleRouteError(error, "extend")
  }
}
