import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { logAdminAccess } from "@/lib/audit/adminAccessLog"

/**
 * POST /api/super-admin/stores/[store_uuid]/sessions/[session_id]/participants/force-clean
 *
 * Bulk variant of force-leave — transitions every remaining active
 * participant of a session to 'left'. Purpose: bring a session into a
 * state where `close_session_atomic` can succeed (no active participants
 * left to block the close).
 *
 * Same DB-trigger-guarded transition as force-leave. The `status='active'`
 * predicate + `trg_block_participants_on_nonactive_session` ensure this
 * NEVER transitions a closed session's participants (which would be an
 * illegal terminal-table write anyway).
 */

const REASON_MIN = 3
const REASON_MAX = 500
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(
  request: Request,
  { params }: { params: Promise<{ store_uuid: string; session_id: string }> }
) {
  try {
    const auth = await resolveAuthContext(request)
    if (!auth.is_super_admin) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }

    const { store_uuid, session_id } = await params
    if (!UUID_RE.test(store_uuid) || !UUID_RE.test(session_id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }

    const body = (await request.json().catch(() => ({}))) as { reason?: unknown }
    const rawReason = typeof body.reason === "string" ? body.reason.trim() : ""
    if (rawReason.length < REASON_MIN) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: `reason must be at least ${REASON_MIN} characters.` },
        { status: 400 }
      )
    }
    const reason = rawReason.slice(0, REASON_MAX)

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "SERVER_CONFIG_ERROR" }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const SCREEN = `/super-admin/stores/${store_uuid}`

    const { data: sessionRow } = await supabase
      .from("room_sessions")
      .select("id, status")
      .eq("id", session_id)
      .eq("store_uuid", store_uuid)
      .is("deleted_at", null)
      .maybeSingle()
    if (!sessionRow) {
      await logAdminAccess(supabase, {
        actor_user_id: auth.user_id, target_store_uuid: store_uuid, screen: SCREEN,
        action_kind: "write", action_detail: "force_clean_participants",
        metadata: { session_id, reason, result: "rejected", denial_reason: "SESSION_NOT_FOUND" },
      })
      return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 })
    }
    if (sessionRow.status !== "active") {
      await logAdminAccess(supabase, {
        actor_user_id: auth.user_id, target_store_uuid: store_uuid, screen: SCREEN,
        action_kind: "write", action_detail: "force_clean_participants",
        metadata: { session_id, reason, result: "rejected", denial_reason: "SESSION_NOT_ACTIVE", previous_session_status: sessionRow.status },
      })
      return NextResponse.json(
        { error: "SESSION_NOT_ACTIVE", message: `세션이 활성 상태가 아닙니다. 현재 상태: ${sessionRow.status}` },
        { status: 409 }
      )
    }

    const now = new Date().toISOString()
    const { data: updatedRows, error: updErr } = await supabase
      .from("session_participants")
      .update({ status: "left", left_at: now, updated_at: now })
      .eq("session_id", session_id)
      .eq("store_uuid", store_uuid)
      .eq("status", "active")
      .is("deleted_at", null)
      .select("id")

    if (updErr) {
      await logAdminAccess(supabase, {
        actor_user_id: auth.user_id, target_store_uuid: store_uuid, screen: SCREEN,
        action_kind: "write", action_detail: "force_clean_participants",
        metadata: { session_id, reason, result: "rejected", denial_reason: "UPDATE_FAILED", db_error: updErr.message },
      })
      return NextResponse.json({ error: "UPDATE_FAILED" }, { status: 500 })
    }

    const affected = updatedRows?.length ?? 0
    await logAdminAccess(supabase, {
      actor_user_id: auth.user_id, target_store_uuid: store_uuid, screen: SCREEN,
      action_kind: "write", action_detail: "force_clean_participants",
      metadata: {
        session_id,
        reason,
        result: affected === 0 ? "noop" : "success",
        before_state: { active_participants: affected },
        after_state: { active_participants: 0, left_at: now },
        participants_transitioned: affected,
      },
    })

    return NextResponse.json({
      ok: true,
      participants_transitioned: affected,
      noop: affected === 0,
      message: affected === 0 ? "정리할 활성 참가자가 없습니다." : `${affected}명을 left 처리했습니다.`,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      const status =
        error.type === "AUTH_MISSING" || error.type === "AUTH_INVALID" ? 401 :
        error.type === "SERVER_CONFIG_ERROR" ? 500 : 403
      return NextResponse.json({ error: error.type, message: error.message }, { status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
