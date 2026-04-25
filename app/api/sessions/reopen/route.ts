import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { isValidUUID } from "@/lib/validation"
import { writeSessionAudit } from "@/lib/session/auditWriter"

/**
 * POST /api/sessions/reopen
 *
 * 2026-04-25: 체크아웃 된 세션을 다시 active 로 되돌림. 실수 체크아웃,
 *   손님이 연장 요청 등의 상황 대응.
 *
 * 제약:
 *   - owner / manager 만 가능 (hostess 금지)
 *   - 원래 status='closed' 여야 함 (active/draft/inactive 에서 호출 금지)
 *   - 해당 방에 다른 active 세션이 있으면 409 (동시 재개 불가)
 *   - 정산(receipt) 이 finalized 된 세션은 409 (이미 확정 = 되돌릴 수 없음)
 *   - archived_at 세팅된 세션은 409 (archive 된 = 되돌릴 수 없음)
 *
 * 효과:
 *   - room_sessions.status = 'active'
 *   - ended_at = NULL
 *   - audit_events 에 reopen 이벤트 기록
 */
export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role !== "owner" && auth.role !== "manager") {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "세션 재개 권한이 없습니다." },
        { status: 403 },
      )
    }

    const parsed = await parseJsonBody<{ session_id?: string; reason?: string }>(request)
    if (parsed.error) return parsed.error
    const sessionId = parsed.body.session_id
    if (!sessionId || !isValidUUID(sessionId)) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "session_id 가 필요합니다." },
        { status: 400 },
      )
    }

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // 1. 세션 상태 + store_uuid 검증
    const { data: session } = await supabase
      .from("room_sessions")
      .select("id, room_uuid, status, ended_at, archived_at, business_day_id")
      .eq("id", sessionId)
      .eq("store_uuid", auth.store_uuid)
      .maybeSingle()
    if (!session) {
      return NextResponse.json(
        { error: "SESSION_NOT_FOUND", message: "세션을 찾을 수 없습니다." },
        { status: 404 },
      )
    }
    if (session.archived_at) {
      return NextResponse.json(
        {
          error: "ALREADY_ARCHIVED",
          message: "기록 숨김(archive) 처리된 세션은 재개할 수 없습니다.",
        },
        { status: 409 },
      )
    }
    if (session.status !== "closed") {
      return NextResponse.json(
        {
          error: "INVALID_STATUS",
          message: `현재 상태(${session.status}) 에서는 재개할 수 없습니다. closed 상태만 가능.`,
        },
        { status: 409 },
      )
    }

    // 2. 정산 finalized 체크 — 확정된 정산은 되돌리면 장부 깨짐.
    const { data: receipt } = await supabase
      .from("receipts")
      .select("id, status")
      .eq("session_id", sessionId)
      .eq("store_uuid", auth.store_uuid)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (receipt && receipt.status === "finalized") {
      return NextResponse.json(
        {
          error: "SETTLEMENT_FINALIZED",
          message:
            "정산이 확정된 세션은 재개할 수 없습니다. 정산 먼저 취소 후 다시 시도하세요.",
        },
        { status: 409 },
      )
    }

    // 3. 같은 방에 다른 active 세션이 있는지 (동시 재개 방지)
    const { data: conflict } = await supabase
      .from("room_sessions")
      .select("id")
      .eq("store_uuid", auth.store_uuid)
      .eq("room_uuid", session.room_uuid)
      .eq("status", "active")
      .neq("id", sessionId)
      .is("archived_at", null)
      .maybeSingle()
    if (conflict) {
      return NextResponse.json(
        {
          error: "SESSION_CONFLICT",
          message:
            "이미 이 방에 다른 진행 중인 세션이 있습니다. 그 세션을 먼저 정리한 후 재개 가능.",
        },
        { status: 409 },
      )
    }

    // 4. 재개 — status='active', ended_at=NULL
    const { data: updated, error: updateErr } = await supabase
      .from("room_sessions")
      .update({
        status: "active",
        ended_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("store_uuid", auth.store_uuid)
      .eq("status", "closed") // 이중 체크 (race)
      .select("id, status, started_at, ended_at, manager_name, manager_membership_id")
      .single()

    if (updateErr || !updated) {
      console.error("[sessions/reopen] update failed:", updateErr)
      return NextResponse.json(
        { error: "UPDATE_FAILED", message: "재개 처리에 실패했습니다." },
        { status: 500 },
      )
    }

    // 5. audit
    const reason = (parsed.body.reason ?? "").trim()
    await writeSessionAudit(supabase, {
      auth,
      session_id: sessionId,
      room_uuid: session.room_uuid,
      entity_table: "room_sessions",
      entity_id: sessionId,
      action: "session_reopened",
      before: { status: "closed", ended_at: session.ended_at },
      after: {
        status: "active",
        ended_at: null,
        reason: reason || null,
      },
    })

    return NextResponse.json({
      session_id: updated.id,
      status: updated.status,
      started_at: updated.started_at,
      ended_at: updated.ended_at,
      manager_name: updated.manager_name,
      manager_membership_id: updated.manager_membership_id,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "예상치 못한 오류." },
      { status: 500 },
    )
  }
}
