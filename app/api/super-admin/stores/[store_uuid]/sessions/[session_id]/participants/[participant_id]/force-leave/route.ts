import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { createClient } from "@supabase/supabase-js"
import { logAdminAccess } from "@/lib/audit/adminAccessLog"

/**
 * POST /api/super-admin/stores/[store_uuid]/sessions/[session_id]/participants/[participant_id]/force-leave
 *
 * Mirrors the operator `/api/sessions/mid-out` flow: transitions a single
 * participant active → left. Uses the identical UPDATE predicate pattern,
 * so the DB trigger `trg_block_participants_on_nonactive_session` (STEP-4B)
 * continues to gate the transition — this write path ONLY succeeds when
 * the parent session is active AND the participant is currently active.
 *
 * No direct state invention. No settlement recompute. No delete.
 */

const REASON_MIN = 3
const REASON_MAX = 500
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(
  request: Request,
  { params }: { params: Promise<{ store_uuid: string; session_id: string; participant_id: string }> }
) {
  try {
    const auth = await resolveAuthContext(request)
    if (!auth.is_super_admin) {
      return NextResponse.json(
        { error: "ROLE_FORBIDDEN", message: "Super admin access required." },
        { status: 403 }
      )
    }

    const { store_uuid, session_id, participant_id } = await params
    if (![store_uuid, session_id, participant_id].every((v) => UUID_RE.test(v))) {
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

    // Load session + participant pair with store scope. 404 if mismatch.
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
        action_kind: "write", action_detail: "force_leave_participant",
        metadata: { session_id, participant_id, reason, result: "rejected", denial_reason: "SESSION_NOT_FOUND" },
      })
      return NextResponse.json({ error: "SESSION_NOT_FOUND" }, { status: 404 })
    }
    if (sessionRow.status !== "active") {
      await logAdminAccess(supabase, {
        actor_user_id: auth.user_id, target_store_uuid: store_uuid, screen: SCREEN,
        action_kind: "write", action_detail: "force_leave_participant",
        metadata: { session_id, participant_id, reason, result: "rejected", denial_reason: "SESSION_NOT_ACTIVE", previous_session_status: sessionRow.status },
      })
      return NextResponse.json(
        { error: "SESSION_NOT_ACTIVE", message: `세션이 활성 상태가 아닙니다. 현재 상태: ${sessionRow.status}` },
        { status: 409 }
      )
    }

    const { data: partRow } = await supabase
      .from("session_participants")
      .select("id, session_id, store_uuid, status, external_name, membership_id")
      .eq("id", participant_id)
      .eq("session_id", session_id)
      .eq("store_uuid", store_uuid)
      .is("deleted_at", null)
      .maybeSingle()
    if (!partRow) {
      await logAdminAccess(supabase, {
        actor_user_id: auth.user_id, target_store_uuid: store_uuid, screen: SCREEN,
        action_kind: "write", action_detail: "force_leave_participant",
        metadata: { session_id, participant_id, reason, result: "rejected", denial_reason: "PARTICIPANT_NOT_FOUND" },
      })
      return NextResponse.json({ error: "PARTICIPANT_NOT_FOUND" }, { status: 404 })
    }
    const previousStatus = partRow.status as string
    if (previousStatus !== "active") {
      await logAdminAccess(supabase, {
        actor_user_id: auth.user_id, target_store_uuid: store_uuid, screen: SCREEN,
        action_kind: "write", action_detail: "force_leave_participant",
        metadata: { session_id, participant_id, reason, result: "rejected", denial_reason: "PARTICIPANT_NOT_ACTIVE", previous_status: previousStatus },
      })
      return NextResponse.json(
        { error: "PARTICIPANT_NOT_ACTIVE", message: `참가자가 이미 ${previousStatus} 상태입니다.` },
        { status: 409 }
      )
    }

    // Atomic transition — same predicate shape as /api/sessions/mid-out.
    // The `status='active'` WHERE filter + DB trigger together guarantee
    // only a single winning transition even under concurrent calls.
    const now = new Date().toISOString()
    const { data: updated, error: updErr } = await supabase
      .from("session_participants")
      .update({ status: "left", left_at: now, updated_at: now })
      .eq("id", participant_id)
      .eq("session_id", session_id)
      .eq("store_uuid", store_uuid)
      .eq("status", "active")
      .select("id, status, left_at")
      .maybeSingle()

    if (updErr || !updated) {
      await logAdminAccess(supabase, {
        actor_user_id: auth.user_id, target_store_uuid: store_uuid, screen: SCREEN,
        action_kind: "write", action_detail: "force_leave_participant",
        metadata: { session_id, participant_id, reason, result: "rejected", denial_reason: "UPDATE_FAILED", db_error: updErr?.message },
      })
      return NextResponse.json(
        { error: "UPDATE_FAILED", message: "참가자 종료에 실패했습니다." },
        { status: 500 }
      )
    }

    await logAdminAccess(supabase, {
      actor_user_id: auth.user_id, target_store_uuid: store_uuid, screen: SCREEN,
      action_kind: "write", action_detail: "force_leave_participant",
      metadata: {
        session_id,
        participant_id,
        reason,
        result: "success",
        before_state: { status: previousStatus },
        after_state: { status: "left", left_at: now },
      },
    })

    return NextResponse.json({
      ok: true,
      participant_id: updated.id,
      status: updated.status,
      left_at: updated.left_at,
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
