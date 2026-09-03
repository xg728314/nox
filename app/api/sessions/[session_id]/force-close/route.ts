/**
 * POST /api/sessions/[session_id]/force-close
 *
 * 세션 강제 종료 (정산 없음 · 빈 세션 정리 용).
 *
 * 배경 (R-force-close · 2026-08-31):
 *   사용자 보고 — 사용하지 않는 방이 "진행 175시간" 으로 계속 뜸.
 *   원인: 이전 세션이 종료 안 되고 남음 (checkout 안 함, 마감 안 함).
 *   기존 checkout 은 RPC 로 정산까지 함 → 빈 세션에는 부적합.
 *   이 endpoint 는 참여자 0명 (또는 all left) 인 세션을 즉시 close.
 *
 * 규칙:
 *   - active 참여자 있으면 409 (checkout 사용 권장)
 *   - store_uuid 일치 필수 (super_admin 예외)
 *   - hostess role 차단
 *
 * Body: 없음 (session_id path)
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { writeSessionAudit } from "@/lib/session/auditWriter"
import { isValidUUID } from "@/lib/validation"
import { invalidate as invalidateCache } from "@/lib/cache/inMemoryTtl"
import { assertSessionUnlocked } from "@/lib/session/lockGuard"
import { archiveRoomSessionChat } from "@/lib/chat/services/archiveRoomSessionChat"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ session_id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role === "hostess") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const { session_id } = await params
    if (!session_id || !isValidUUID(session_id)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "session_id required" }, { status: 400 })
    }
    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 1. session 조회
    const { data: session } = await supabase
      .from("room_sessions")
      .select("id, store_uuid, room_uuid, status, started_at")
      .eq("id", session_id)
      .maybeSingle()
    if (!session) {
      return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 })
    }
    if (session.status !== "active") {
      return NextResponse.json({ error: "ALREADY_CLOSED", message: `status=${session.status}` }, { status: 409 })
    }
    // 2. 매장 권한
    if (!auth.is_super_admin && session.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "STORE_FORBIDDEN" }, { status: 403 })
    }

    // R-room-lock (2026-08-31)
    const locked = await assertSessionUnlocked(supabase, session_id, auth)
    if (locked) return locked

    // 3. active 참여자 있으면 거부
    const { count } = await supabase
      .from("session_participants")
      .select("id", { count: "exact", head: true })
      .eq("session_id", session_id)
      .eq("status", "active")
    if ((count ?? 0) > 0) {
      return NextResponse.json({
        error: "SESSION_HAS_ACTIVE_PARTICIPANTS",
        message: `active 참여자 ${count}명 · checkout 또는 개별 leave 후 재시도`,
      }, { status: 409 })
    }

    // 4. close
    const nowIso = new Date().toISOString()
    const { error: upErr } = await supabase
      .from("room_sessions")
      .update({ status: "closed", ended_at: nowIso, closed_at: nowIso, closed_by: auth.user_id })
      .eq("id", session_id)
      .eq("status", "active")
    if (upErr) {
      return NextResponse.json({ error: "CLOSE_FAILED", message: upErr.message }, { status: 500 })
    }

    // 5. audit
    void writeSessionAudit(supabase, {
      auth,
      session_id,
      entity_table: "room_sessions",
      entity_id: session_id,
      action: "session_force_closed",
      before: { status: "active" },
      after: { status: "closed", reason: "force_close_empty" },
    }).catch((e) => console.warn("[force-close] audit:", e instanceof Error ? e.message : e))

    invalidateCache("rooms")
    invalidateCache("monitor")
    invalidateCache("room_participants")
    invalidateCache("building_rooms")

    // R-chat-cleanup-on-close (2026-09-04): 룸 채팅방 자동 archive
    void archiveRoomSessionChat(supabase, session_id).catch(() => { /* silent */ })

    return NextResponse.json({ ok: true, session_id, status: "closed", ended_at: nowIso })
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
