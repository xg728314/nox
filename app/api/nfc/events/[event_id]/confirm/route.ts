/**
 * POST /api/nfc/events/[event_id]/confirm
 *   실장/사장/웨이터 (owner/manager/waiter) 이 pending 이벤트를 즉시 확인.
 *   status=pending → confirmed · 매크로 채팅 발행 (담당실장 그룹톡 or 매장 전체톡)
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"
import { publishNfcMacroChat } from "@/lib/chat/publishNfcMacroChat"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ event_id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    if (!["owner", "manager", "waiter"].includes(auth.role) && !auth.is_super_admin) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN" }, { status: 403 })
    }
    const { event_id } = await params
    if (!isValidUUID(event_id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    const sb = getServiceClient()

    // 이벤트 조회 · pending 검증
    const { data: ev, error } = await sb
      .from("nfc_scan_events")
      .select("id, status, store_uuid, room_uuid, tag_type, actor_membership_id, session_id, participant_id, scanned_at")
      .eq("id", event_id)
      .maybeSingle()
    if (error) {
      if ((error as { code?: string }).code === "42P01") {
        return NextResponse.json({ error: "MIGRATION_PENDING" }, { status: 503 })
      }
      return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    }
    if (!ev) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }
    if ((ev as { status: string }).status !== "pending") {
      return NextResponse.json({ error: "ALREADY_PROCESSED", status: (ev as { status: string }).status }, { status: 409 })
    }

    // Scope: super_admin 는 매장 무관 · 그 외는 same store
    if (!auth.is_super_admin && (ev as { store_uuid: string }).store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "SCOPE_FORBIDDEN" }, { status: 403 })
    }

    const nowIso = new Date().toISOString()
    const { data: updated, error: upErr } = await sb
      .from("nfc_scan_events")
      .update({
        status: "confirmed",
        confirmed_at: nowIso,
        confirmed_by_membership_id: auth.membership_id,
      })
      .eq("id", event_id)
      .eq("status", "pending")
      .select("id, status, confirmed_at, store_uuid, room_uuid, tag_type, actor_membership_id, session_id, participant_id, scanned_at")
      .maybeSingle()
    if (upErr || !updated) {
      return NextResponse.json({ error: "UPDATE_FAILED", message: upErr?.message ?? "concurrent" }, { status: 500 })
    }

    // 매크로 채팅 발행 (best-effort)
    void publishNfcMacroChat({ auth, event: updated as never }).catch(() => { /* silent */ })

    return NextResponse.json({ event: updated })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
