/**
 * Sprint 4 (2026-07-29): Pending macro_confirm 거부
 *
 * POST /api/chat/messages/[message_id]/reject-macro
 *   실장이 파싱 결과 오탐 판정 → 세션 미등록 · 매크로 발행 X · superseded
 *   body: { reason?: string }
 *
 *   audit_events 로 이유 기록 → 학습 데이터로 활용 가능
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
    if (!isValidUUID(message_id)) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    const body = (await request.json().catch(() => ({}))) as { reason?: string }

    const sb = getServiceClient()
    const { data: msgData, error } = await sb
      .from("chat_messages")
      .select("id, store_uuid, message_type, macro_context, superseded_at, deleted_at")
      .eq("id", message_id)
      .maybeSingle()
    if (error) {
      if ((error as { code?: string }).code === "42P01") return NextResponse.json({ error: "MIGRATION_PENDING" }, { status: 503 })
      return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    }
    const msg = msgData as {
      id: string; store_uuid: string; message_type: string;
      macro_context: Record<string, unknown> | null;
      superseded_at: string | null; deleted_at: string | null
    } | null
    if (!msg) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    if (msg.deleted_at || msg.superseded_at) return NextResponse.json({ error: "ALREADY_HANDLED" }, { status: 409 })
    if (msg.message_type !== "macro_confirm") {
      return NextResponse.json({ error: "NOT_REJECTABLE" }, { status: 400 })
    }
    if (!auth.is_super_admin && msg.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "SCOPE_FORBIDDEN" }, { status: 403 })
    }

    const nowIso = new Date().toISOString()
    await sb
      .from("chat_messages")
      .update({
        superseded_at: nowIso,
        macro_context: {
          ...(msg.macro_context ?? {}),
          rejected_at: nowIso,
          rejected_by_membership_id: auth.membership_id,
          reject_reason: body.reason ?? null,
        },
      })
      .eq("id", message_id)

    try {
      await sb.from("audit_events").insert({
        store_uuid: msg.store_uuid,
        actor_profile_id: auth.user_id,
        actor_membership_id: auth.membership_id,
        actor_role: auth.role,
        actor_type: auth.role,
        entity_table: "chat_messages",
        entity_id: message_id,
        action: "macro_rejected",
        before: msg.macro_context ?? {},
        after: { reason: body.reason ?? null },
      })
    } catch { /* best-effort */ }

    return NextResponse.json({ ok: true, rejected_at: nowIso })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (e as Error).message }, { status: 500 })
  }
}
