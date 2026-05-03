import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { isValidUUID } from "@/lib/validation"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { parseJsonBody } from "@/lib/session/parseBody"
import { writeSessionAudit } from "@/lib/session/auditWriter"
import { archivedAtFilter } from "@/lib/session/archivedFilter"
import { getBusinessDateForOps } from "@/lib/time/businessDate"
import { invalidate as invalidateCache } from "@/lib/cache/inMemoryTtl"

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

    // 2026-05-03 R-Speed-x10: manager verify + room verify + existing session +
    //   business_day fetch 를 4개 Promise.all 로 동시 fire.
    //   기존: 직렬 4 RTT (~250ms). 현재: 1 RTT (max-of-4).
    //   각 query 는 store_uuid + (roomUuid 또는 today) 만 의존, 상호 무관.
    const today = getBusinessDateForOps()
    const applyArchivedNull = await archivedAtFilter(supabase)
    const [mgrRowRes, roomRes, existingSessionRes, existingDayRes] = await Promise.all([
      managerMembershipId
        ? supabase
            .from("store_memberships")
            .select("id, role, status, deleted_at, store_uuid")
            .eq("id", managerMembershipId)
            .eq("store_uuid", authContext.store_uuid)
            .eq("role", "manager")
            .eq("status", "approved")
            .is("deleted_at", null)
            .maybeSingle()
        : Promise.resolve({ data: null as { id: string } | null, error: null as null }),
      supabase
        .from("rooms")
        .select("id")
        .eq("store_uuid", authContext.store_uuid)
        .eq("id", roomUuid)
        .single(),
      applyArchivedNull(
        supabase
          .from("room_sessions")
          .select("id")
          .eq("store_uuid", authContext.store_uuid)
          .eq("room_uuid", roomUuid)
          .eq("status", "active")
      ).maybeSingle(),
      supabase
        .from("store_operating_days")
        .select("id, status")
        .eq("store_uuid", authContext.store_uuid)
        .eq("business_date", today)
        .maybeSingle(),
    ])

    // manager verify 결과 처리
    if (managerMembershipId) {
      if (mgrRowRes.error) {
        console.error("[checkin] manager verify error:", JSON.stringify(mgrRowRes.error))
        return NextResponse.json(
          { error: "MANAGER_VERIFY_FAILED", message: "실장 검증에 실패했습니다." },
          { status: 500 },
        )
      }
      if (!mgrRowRes.data) {
        return NextResponse.json(
          {
            error: "MANAGER_INVALID",
            message:
              "지정한 실장이 이 매장에 소속된 승인된 실장이 아닙니다. 실장 재선택 필요.",
          },
          { status: 403 },
        )
      }
    }

    if (roomRes.error || !roomRes.data) {
      return NextResponse.json(
        { error: "ROOM_NOT_FOUND", message: "Room not found in this store." },
        { status: 404 }
      )
    }

    if (existingSessionRes.data) {
      return NextResponse.json(
        { error: "SESSION_CONFLICT", message: "An active session already exists for this room." },
        { status: 409 }
      )
    }

    let businessDayId: string
    const existingDay = existingDayRes.data

    if (existingDay && existingDay.status === "closed") {
      // Reopen closed business day for today
      const { error: reopenError } = await supabase
        .from("store_operating_days")
        .update({ status: "open", closed_at: null, closed_by: null })
        .eq("id", existingDay.id)
        .eq("store_uuid", authContext.store_uuid)
        .is("deleted_at", null)

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
      // R28-fix: migration 093 의 partial UNIQUE index (uq_room_active_session)
      //   가 race 시 23505 unique_violation 반환. 사용자 친화 메시지로 변환.
      if (sessionError?.code === "23505") {
        return NextResponse.json(
          { error: "SESSION_CONFLICT", message: "An active session already exists for this room." },
          { status: 409 }
        )
      }
      console.error("[checkin] session create error:", JSON.stringify(sessionError))
      return NextResponse.json(
        { error: "SESSION_CREATE_FAILED", message: sessionError?.message || "Failed to create session." },
        { status: 500 }
      )
    }

    // 5. Record audit event — background fire (응답 latency 차감 ~150ms).
    void writeSessionAudit(supabase, {
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
    }).catch((e) => {
      console.warn("[checkin] audit failed:", e instanceof Error ? e.message : e)
    })

    // R29-perf: 캐시 즉시 무효화 → 다른 카운터에서 바로 반영.
    invalidateCache("rooms")
    invalidateCache("monitor")

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
