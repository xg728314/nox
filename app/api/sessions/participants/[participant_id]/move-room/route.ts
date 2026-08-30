/**
 * POST /api/sessions/participants/[participant_id]/move-room
 *
 * 이미 세션에 등록된 참여자를 **같은 매장의 다른 방** 으로 이동.
 *
 * 배경 (R-cross-store-room-move · 2026-08-31):
 *   Marvel → 상한가 dispatch 시 서버가 상한가의 빈 방을 자동 배정.
 *   실제로는 상한가 사장/실장이 눈 앞에서 다른 방으로 안내 → 방 이동 필요.
 *   기존엔 leave + 재등록 필요 → entered_at 리셋, audit 2건 → 부정확.
 *   이 endpoint 는 participant.session_id 만 교체 → 시각/금액/원소속 유지.
 *
 * Body: { target_room_uuid: string }
 *
 * 로직:
 *   1. participant 조회 + 권한 (owner/manager/super_admin, 매장 일치)
 *   2. 현 세션의 store_uuid 확보 → target_room 도 같은 매장 확인
 *   3. target_room 의 active session 있으면 재사용, 없으면 새 세션 생성
 *   4. participant.session_id = new session_id · store_uuid 유지
 *   5. 원 세션에 active 참여자 0명 → 세션 closed 처리
 *   6. audit 기록 (before/after session_id)
 *
 * 안전 장치:
 *   - target_room 이 다른 매장이면 거부 (cross-store 이동은 leave-by-name 사용)
 *   - target_room 에 다른 매니저의 active session 이 있어도 join 허용 (실무 승계)
 *   - participant.status !== "active" 면 거부
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { writeSessionAudit } from "@/lib/session/auditWriter"
import { isValidUUID } from "@/lib/validation"
import { getBusinessDateForOps } from "@/lib/time/businessDate"
import { invalidate as invalidateCache } from "@/lib/cache/inMemoryTtl"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ participant_id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role === "hostess") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const { participant_id } = await params
    if (!participant_id || !isValidUUID(participant_id)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "participant_id required" },
        { status: 400 },
      )
    }

    const parsed = await parseJsonBody<{ target_room_uuid?: string }>(request)
    if (parsed.error) return parsed.error
    const targetRoomUuid = parsed.body.target_room_uuid
    if (!targetRoomUuid || !isValidUUID(targetRoomUuid)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "target_room_uuid required" },
        { status: 400 },
      )
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 1. participant 조회
    const { data: part } = await supabase
      .from("session_participants")
      .select("id, session_id, store_uuid, status, membership_id, origin_store_uuid")
      .eq("id", participant_id)
      .maybeSingle()
    if (!part) {
      return NextResponse.json({ error: "PARTICIPANT_NOT_FOUND" }, { status: 404 })
    }
    if (part.status !== "active") {
      return NextResponse.json(
        { error: "PARTICIPANT_NOT_ACTIVE", message: `status=${part.status}` },
        { status: 409 },
      )
    }

    // 2. 권한 — super_admin 이거나 매장 일치
    if (!auth.is_super_admin && part.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "STORE_FORBIDDEN" }, { status: 403 })
    }

    // 3. target_room 검증 — 같은 매장
    const { data: room } = await supabase
      .from("rooms")
      .select("id, room_no, room_name, store_uuid, is_active")
      .eq("id", targetRoomUuid)
      .maybeSingle()
    if (!room || room.is_active === false) {
      return NextResponse.json({ error: "ROOM_NOT_FOUND" }, { status: 404 })
    }
    if (room.store_uuid !== part.store_uuid) {
      return NextResponse.json(
        { error: "ROOM_STORE_MISMATCH", message: "다른 매장의 방으로 이동 불가." },
        { status: 400 },
      )
    }

    // 4. 원 세션 조회 (이동 후 정리용)
    const { data: originSession } = await supabase
      .from("room_sessions")
      .select("id, room_uuid, business_day_id, status")
      .eq("id", part.session_id)
      .maybeSingle()

    // 이미 그 방이면 no-op
    if (originSession?.room_uuid === targetRoomUuid) {
      return NextResponse.json(
        { ok: true, no_op: true, message: "이미 해당 방에 있음", session_id: part.session_id },
        { status: 200 },
      )
    }

    // 5. target_room 의 active session 조회 (없으면 새로 생성)
    let targetSessionId: string
    let createdNewSession = false
    const { data: activeInTarget } = await supabase
      .from("room_sessions")
      .select("id")
      .eq("store_uuid", part.store_uuid)
      .eq("room_uuid", targetRoomUuid)
      .eq("status", "active")
      .maybeSingle()

    if (activeInTarget) {
      targetSessionId = activeInTarget.id
    } else {
      // business_day 확보 — 원 세션의 business_day_id 재사용 or 오늘 자 확보
      let bizDayId = originSession?.business_day_id ?? null
      if (!bizDayId) {
        const today = getBusinessDateForOps()
        const { data: bd } = await supabase
          .from("store_operating_days")
          .select("id, status")
          .eq("store_uuid", part.store_uuid)
          .eq("business_date", today)
          .maybeSingle()
        if (bd) {
          if (bd.status === "closed") {
            await supabase
              .from("store_operating_days")
              .update({ status: "open", closed_at: null, closed_by: null })
              .eq("id", bd.id)
          }
          bizDayId = bd.id
        } else {
          const { data: newBd, error: newBdErr } = await supabase
            .from("store_operating_days")
            .insert({
              store_uuid: part.store_uuid,
              business_date: today,
              status: "open",
              opened_by: auth.user_id,
            })
            .select("id")
            .single()
          if (newBdErr || !newBd) {
            return NextResponse.json(
              { error: "BUSINESS_DAY_FAILED", message: newBdErr?.message ?? "biz_day 실패" },
              { status: 500 },
            )
          }
          bizDayId = newBd.id
        }
      }

      const { data: newSess, error: newSessErr } = await supabase
        .from("room_sessions")
        .insert({
          store_uuid: part.store_uuid,
          room_uuid: targetRoomUuid,
          business_day_id: bizDayId,
          status: "active",
          opened_by: auth.user_id,
          manager_membership_id: null,
          manager_name: null,
          is_external_manager: false,
        })
        .select("id")
        .single()
      if (newSessErr || !newSess) {
        // 23505 race → 재조회
        if (newSessErr?.code === "23505") {
          const { data: raceSess } = await supabase
            .from("room_sessions")
            .select("id")
            .eq("store_uuid", part.store_uuid)
            .eq("room_uuid", targetRoomUuid)
            .eq("status", "active")
            .maybeSingle()
          if (raceSess) {
            targetSessionId = raceSess.id
          } else {
            return NextResponse.json(
              { error: "SESSION_CREATE_FAILED", message: "race 후 세션 없음" },
              { status: 500 },
            )
          }
        } else {
          return NextResponse.json(
            { error: "SESSION_CREATE_FAILED", message: newSessErr?.message ?? "세션 생성 실패" },
            { status: 500 },
          )
        }
      } else {
        targetSessionId = newSess.id
        createdNewSession = true
      }
    }

    // 6. participant.session_id 교체
    const { error: upErr } = await supabase
      .from("session_participants")
      .update({ session_id: targetSessionId })
      .eq("id", participant_id)
      .eq("status", "active")
    if (upErr) {
      return NextResponse.json(
        { error: "MOVE_FAILED", message: upErr.message },
        { status: 500 },
      )
    }

    // 7. 원 세션에 active 참여자 0 → 세션 closed
    if (originSession) {
      const { count } = await supabase
        .from("session_participants")
        .select("id", { count: "exact", head: true })
        .eq("session_id", originSession.id)
        .eq("status", "active")
      if ((count ?? 0) === 0 && originSession.status === "active") {
        await supabase
          .from("room_sessions")
          .update({ status: "closed", closed_at: new Date().toISOString(), closed_by: auth.user_id })
          .eq("id", originSession.id)
          .eq("status", "active")
      }
    }

    // 8. audit — background fire
    void writeSessionAudit(supabase, {
      auth,
      session_id: targetSessionId,
      entity_table: "session_participants",
      entity_id: participant_id,
      action: "participant_moved_room",
      before: {
        session_id: part.session_id,
        room_uuid: originSession?.room_uuid ?? null,
      },
      after: {
        session_id: targetSessionId,
        room_uuid: targetRoomUuid,
        created_new_session: createdNewSession,
      },
    }).catch((e) => {
      console.warn("[move-room] audit failed:", e instanceof Error ? e.message : e)
    })

    // 캐시 무효화
    invalidateCache("rooms")
    invalidateCache("monitor")
    invalidateCache("room_participants")
    invalidateCache("session_orders")

    return NextResponse.json({
      ok: true,
      session_id: targetSessionId,
      room_uuid: targetRoomUuid,
      room_no: room.room_no,
      created_new_session: createdNewSession,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.type, message: error.message }, { status: error.status })
    }
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: (error as Error).message },
      { status: 500 },
    )
  }
}
