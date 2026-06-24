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
