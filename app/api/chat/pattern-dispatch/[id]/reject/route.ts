/**
 * POST /api/chat/pattern-dispatch/[id]/reject
 *
 * 수신측 매니저가 임시 등록 취소.
 *   잘못 기재된 이름/매장 인지하면 reject → 발신자가 다시 등록할 수 있게.
 *
 * 권한: target_store 매니저 또는 super_admin.
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await resolveAuthContext(request)
    if (auth.role === "hostess") {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const { id } = await params
    if (!id || !isValidUUID(id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    let body: { reason?: string } = {}
    try { body = await request.json() } catch { /* ok */ }
    const supabase = getServiceClient()

    const { data: row } = await supabase
      .from("chat_pattern_dispatches")
      .select("id, chat_message_id, target_store_uuid, status")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle()
    if (!row) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }
    type Row = { id: string; chat_message_id: string; target_store_uuid: string; status: string }
    const r = row as Row
    if (r.status !== "pending") {
      return NextResponse.json({ error: "NOT_PENDING", status: r.status }, { status: 409 })
    }
    if (!auth.is_super_admin && r.target_store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "STORE_FORBIDDEN" }, { status: 403 })
    }

    const nowIso = new Date().toISOString()
    const { error: updErr } = await supabase
      .from("chat_pattern_dispatches")
      .update({
        status: "rejected",
        rejected_reason: body.reason ?? "수신측 취소",
        target_confirmed_by: auth.user_id,
        target_confirmed_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", id)
      .eq("status", "pending")
    if (updErr) {
      return NextResponse.json({ error: "UPDATE_FAILED", message: updErr.message }, { status: 500 })
    }

    // 같은 chat_message 의 다른 row 도 함께 reject (전체 일괄 취소 — 잘못 기재면 전부 무효)
    const { data: latest } = await supabase
      .from("chat_pattern_dispatches")
      .select("id, target_store_uuid, hostess_membership_id, category, time_type, status, target_confirmed_by")
      .eq("chat_message_id", r.chat_message_id)
      .is("deleted_at", null)

    return NextResponse.json({ ok: true, dispatches: latest ?? [] })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: e instanceof Error ? e.message : "err" }, { status: 500 })
  }
}
