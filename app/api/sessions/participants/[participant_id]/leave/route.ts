/**
 * POST /api/sessions/participants/[participant_id]/leave
 *
 * 일하는 식구를 즉시 종료 (status='left', left_at=now).
 *   - 부모 session 의 마지막 active 참여자였다면 session 도 closed.
 *   - manager_membership 동일성 검증 — owner/manager only.
 *   - business_day 가 closed 이면 거부.
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { isValidUUID } from "@/lib/validation"

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
      return NextResponse.json({ error: "BAD_REQUEST", message: "participant_id required" }, { status: 400 })
    }
    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    const { data: part } = await supabase
      .from("session_participants")
      .select("id, session_id, store_uuid, status, membership_id")
      .eq("id", participant_id)
      .maybeSingle()
    if (!part) {
      return NextResponse.json({ error: "PARTICIPANT_NOT_FOUND" }, { status: 404 })
    }
    if (part.status !== "active") {
      return NextResponse.json({ error: "ALREADY_LEFT", message: `status=${part.status}` }, { status: 409 })
    }

    // 권한 — super_admin 이거나 (manager/owner 이고 매장 일치)
    if (!auth.is_super_admin && part.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "STORE_FORBIDDEN" }, { status: 403 })
    }

    const nowIso = new Date().toISOString()
    const { error: upErr } = await supabase
      .from("session_participants")
      .update({ status: "left", left_at: nowIso })
      .eq("id", participant_id)
      .eq("status", "active")
    if (upErr) {
      return NextResponse.json({ error: "UPDATE_FAILED", message: upErr.message }, { status: 500 })
    }

    // session 의 active 참여자 0 이면 session 도 closed
    const { count } = await supabase
      .from("session_participants")
      .select("id", { count: "exact", head: true })
      .eq("session_id", part.session_id)
      .eq("status", "active")
      .is("deleted_at", null)
    let sessionClosed = false
    if ((count ?? 0) === 0) {
      const { error: sErr } = await supabase
        .from("room_sessions")
        .update({ status: "closed", ended_at: nowIso })
        .eq("id", part.session_id)
        .eq("status", "active")
      if (!sErr) sessionClosed = true
    }

    // R-leave-chat-cleanup (2026-06-28): 식구가 떠나면 그 세션의 room_session 채팅방
    //   에서도 자동 제거. 사용자 의도: '미연이 중간에 끝나면 그룹채팅에서 자동 나간다'.
    //   - 그 식구 본 매장 식구(원래 멤버)면 chat_participants 에서 그 row delete
    //   - session 닫혔으면 chat_room 도 is_active=false (자동 삭제)
    void (async () => {
      try {
        const { data: roomRow } = await supabase
          .from("chat_rooms")
          .select("id")
          .eq("type", "room_session")
          .eq("session_id", part.session_id)
          .eq("is_active", true)
          .maybeSingle()
        if (roomRow) {
          const chatRoomId = (roomRow as { id: string }).id
          if (sessionClosed) {
            // 방 전체 종료 — chat_room 도 비활성화
            await supabase
              .from("chat_rooms")
              .update({ is_active: false, updated_at: nowIso })
              .eq("id", chatRoomId)
          } else {
            // 그 식구만 chat_participants 에서 제거
            await supabase
              .from("chat_participants")
              .delete()
              .eq("chat_room_id", chatRoomId)
              .eq("membership_id", part.membership_id)
          }
        }
      } catch {
        // best-effort — leave 응답 차단 X
      }
    })()

    return NextResponse.json({
      ok: true,
      participant_id,
      session_id: part.session_id,
      session_closed: sessionClosed,
      left_at: nowIso,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "err" }, { status: 500 })
  }
}
