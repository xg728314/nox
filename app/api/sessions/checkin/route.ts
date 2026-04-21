import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { isValidUUID } from "@/lib/validation"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { parseJsonBody } from "@/lib/session/parseBody"
import { writeSessionAudit } from "@/lib/session/auditWriter"

export async function POST(request: Request) {
  try {
    const authContext = await resolveAuthContext(request)

    // Role gate: owner/manager only, hostess forbidden
    if (authContext.role === "hostess") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Hostess role is not permitted to check in sessions." },
        { status: 403 }
      )
    }

    const parsed = await parseJsonBody<{
      room_uuid?: string
      manager_name?: string | null
      manager_membership_id?: string | null
      is_external_manager?: boolean
    }>(request)
    if (parsed.error) return parsed.error
    const body = parsed.body

    const roomUuid = body.room_uuid
    if (!roomUuid || !isValidUUID(roomUuid)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "room_uuid is required and must be a valid UUID." },
        { status: 400 }
      )
    }

    // 담당 실장 — 선택사항
    const isExternalManager = body.is_external_manager === true
    const managerName = (body.manager_name ?? "").trim() || null
    let managerMembershipId: string | null = null
    if (!isExternalManager && body.manager_membership_id) {
      if (!isValidUUID(body.manager_membership_id)) {
        return NextResponse.json(
          { error: "BAD_REQUEST", message: "manager_membership_id must be a valid UUID." },
          { status: 400 }
        )
      }
      managerMembershipId = body.manager_membership_id
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 1. Verify room exists in this store
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("id")
      .eq("store_uuid", authContext.store_uuid)
      .eq("id", roomUuid)
      .single()

    if (roomError || !room) {
      return NextResponse.json(
        { error: "ROOM_NOT_FOUND", message: "Room not found in this store." },
        { status: 404 }
      )
    }

    // 2. Check for active session in this room (conflict guard)
    const { data: existingSession } = await supabase
      .from("room_sessions")
      .select("id")
      .eq("store_uuid", authContext.store_uuid)
      .eq("room_uuid", roomUuid)
      .eq("status", "active")
      .maybeSingle()

    if (existingSession) {
      return NextResponse.json(
        { error: "SESSION_CONFLICT", message: "An active session already exists for this room." },
        { status: 409 }
      )
    }

    // 3. Get or create business_day for today
    const today = new Date().toISOString().split("T")[0]

    let businessDayId: string

    const { data: existingDay } = await supabase
      .from("store_operating_days")
      .select("id, status")
      .eq("store_uuid", authContext.store_uuid)
      .eq("business_date", today)
      .maybeSingle()

    if (existingDay && existingDay.status === "closed") {
      // Reopen closed business day for today
      const { error: reopenError } = await supabase
        .from("store_operating_days")
        .update({ status: "open", closed_at: null, closed_by: null })
        .eq("id", existingDay.id)

      if (reopenError) {
        console.error("[checkin] reopen business_day error:", JSON.stringify(reopenError))
        return NextResponse.json(
          { error: "BUSINESS_DAY_REOPEN_FAILED", message: reopenError.message || "Failed to reopen business day." },
          { status: 500 }
        )
      }
      businessDayId = existingDay.id
    } else if (existingDay) {
      businessDayId = existingDay.id
    } else {
      const { data: newDay, error: newDayError } = await supabase
        .from("store_operating_days")
        .insert({
          store_uuid: authContext.store_uuid,
          business_date: today,
          status: "open",
          opened_by: authContext.user_id,
        })
        .select("id")
        .single()

      if (newDayError || !newDay) {
        console.error("[checkin] business_day create error:", JSON.stringify(newDayError))
        return NextResponse.json(
          { error: "BUSINESS_DAY_CREATE_FAILED", message: newDayError?.message || "Failed to create business day record." },
          { status: 500 }
        )
      }
      businessDayId = newDay.id
    }

    // 4. INSERT room session
    const { data: session, error: sessionError } = await supabase
      .from("room_sessions")
      .insert({
        store_uuid: authContext.store_uuid,
        room_uuid: roomUuid,
        business_day_id: businessDayId,
        status: "active",
        opened_by: authContext.user_id,
        manager_membership_id: managerMembershipId,
        manager_name: managerName,
        is_external_manager: isExternalManager,
      })
      .select("id, status, started_at, manager_name, manager_membership_id, is_external_manager")
      .single()

    if (sessionError || !session) {
      console.error("[checkin] session create error:", JSON.stringify(sessionError))
      return NextResponse.json(
        { error: "SESSION_CREATE_FAILED", message: sessionError?.message || "Failed to create session." },
        { status: 500 }
      )
    }

    // 5. Record audit event
    await writeSessionAudit(supabase, {
      auth: authContext,
      session_id: session.id,
      room_uuid: roomUuid,
      entity_table: "room_sessions",
      entity_id: session.id,
      action: "checkin",
      after: {
        status: "active",
        room_uuid: roomUuid,
        business_day_id: businessDayId,
      },
    })

    return NextResponse.json(
      {
        session_id: session.id,
        room_uuid: roomUuid,
        store_uuid: authContext.store_uuid,
        status: session.status,
        started_at: session.started_at,
        manager_name: session.manager_name,
        manager_membership_id: session.manager_membership_id,
        is_external_manager: session.is_external_manager,
      },
      { status: 201 }
    )
  } catch (error) {
    return handleRouteError(error, "checkin")
  }
}
