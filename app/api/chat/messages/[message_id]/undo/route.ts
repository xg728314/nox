/**
 * Sprint 1 (2026-07-29):
 * POST /api/chat/messages/[message_id]/undo
 *   매크로 메시지 5분 유예 취소 · 세션 archived · message soft-deleted
 *
 *   조건: undo_deadline_at > now() · message_type LIKE 'macro_%'
 *   효과:
 *     1. chat_messages.deleted_at 스탬프 (UI 에서 숨김)
 *     2. 매크로가 session_id 참조하면 → session archived + 참여자 leave
 *     3. audit_events 로그
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ message_id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    if (!["owner", "manager"].includes(auth.role) && !auth.is_super_admin) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const { message_id } = await params
    if (!isValidUUID(message_id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    const sb = getServiceClient()

    const { data: msg, error } = await sb
      .from("chat_messages")
      .select("id, store_uuid, message_type, session_id, undo_deadline_at, deleted_at")
      .eq("id", message_id)
      .maybeSingle()
    if (error) {
      if ((error as { code?: string }).code === "42703") {
        // undo_deadline_at column missing → migration 174 미apply
        return NextResponse.json({ error: "MIGRATION_PENDING" }, { status: 503 })
      }
      return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    }
    if (!msg) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })

    const m = msg as {
      id: string
      store_uuid: string
      message_type: string
      session_id: string | null
      undo_deadline_at: string | null
      deleted_at: string | null
    }
    if (m.deleted_at) return NextResponse.json({ error: "ALREADY_DELETED" }, { status: 409 })
    if (!m.message_type.startsWith("macro_")) {
      return NextResponse.json({ error: "NOT_UNDOABLE", message: "매크로 메시지만 취소 가능" }, { status: 400 })
    }
    if (!m.undo_deadline_at || new Date(m.undo_deadline_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "UNDO_EXPIRED", message: "5분 유예 지남 · 취소 불가" }, { status: 410 })
    }
    if (!auth.is_super_admin && m.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "SCOPE_FORBIDDEN" }, { status: 403 })
    }

    const nowIso = new Date().toISOString()

    // 1) message soft-delete
    await sb
      .from("chat_messages")
      .update({ deleted_at: nowIso })
      .eq("id", message_id)

    // 2) session 참여자 archive · session close (session 참조 있는 매크로만)
    let sessionArchived = false
    if (m.session_id) {
      // 이 세션의 최근 5분 안 등록된 참여자만 archive (다른 실장이 나중에 추가한 것은 유지)
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString()
      const { data: parts } = await sb
        .from("session_participants")
        .select("id, entered_at")
        .eq("session_id", m.session_id)
        .eq("status", "active")
        .gte("entered_at", fiveMinAgo)
      const partIds = ((parts ?? []) as Array<{ id: string }>).map((p) => p.id)
      if (partIds.length > 0) {
        await sb
          .from("session_participants")
          .update({ status: "left", left_at: nowIso })
          .in("id", partIds)
      }
      // 남은 active 참여자 없으면 세션도 close
      const { count } = await sb
        .from("session_participants")
        .select("id", { count: "exact", head: true })
        .eq("session_id", m.session_id)
        .eq("status", "active")
      if ((count ?? 0) === 0) {
        await sb
          .from("room_sessions")
          .update({ status: "closed", ended_at: nowIso })
          .eq("id", m.session_id)
          .eq("status", "active")
        sessionArchived = true
      }
    }

    // 3) audit
    try {
      await sb.from("audit_events").insert({
        store_uuid: m.store_uuid,
        actor_profile_id: auth.user_id,
        actor_membership_id: auth.membership_id,
        actor_role: auth.role,
        actor_type: auth.role,
        entity_table: "chat_messages",
        entity_id: message_id,
        action: "macro_undo",
        before: { message_type: m.message_type, session_id: m.session_id },
      })
    } catch { /* best-effort */ }

    return NextResponse.json({
      ok: true,
      undone_at: nowIso,
      session_archived: sessionArchived,
    })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (e as Error).message }, { status: 500 })
  }
}
