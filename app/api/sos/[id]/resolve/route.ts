/**
 * POST /api/sos/[id]/resolve
 * SOS 해결 처리.
 * Body: { note?: string, action?: 'resolved' | 'cancelled' }
 * 권한: owner / manager 또는 발신자 본인 (cancel 만).
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await resolveAuthContext(request)
    const { id } = await params
    if (!id || !isValidUUID(id)) {
      return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    }
    const body = (await request.json().catch(() => ({}))) as {
      note?: string
      action?: "resolved" | "cancelled"
    }
    const action = body.action ?? "resolved"
    const supabase = getServiceClient()

    // SOS 조회 + 권한 검증
    const { data: sos } = await supabase
      .from("sos_events")
      .select("id, store_uuid, sender_user_id, status")
      .eq("id", id)
      .maybeSingle()
    if (!sos) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    }
    const s = sos as {
      id: string
      store_uuid: string
      sender_user_id: string
      status: string
    }
    if (s.status !== "active") {
      return NextResponse.json(
        { error: "ALREADY_RESOLVED", status: s.status },
        { status: 409 },
      )
    }
    // manager/owner 는 매장 일치, hostess/counter 는 본인 cancel 만
    if (auth.role === "owner" || auth.role === "manager") {
      if (s.store_uuid !== auth.store_uuid && !auth.is_super_admin) {
        return NextResponse.json({ error: "STORE_FORBIDDEN" }, { status: 403 })
      }
    } else {
      if (s.sender_user_id !== auth.user_id) {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
      }
      if (action !== "cancelled") {
        return NextResponse.json({ error: "SENDER_CANCEL_ONLY" }, { status: 403 })
      }
    }

    const { error } = await supabase
      .from("sos_events")
      .update({
        status: action,
        resolved_at: new Date().toISOString(),
        resolved_by: auth.user_id,
        resolved_note: body.note ?? null,
      })
      .eq("id", id)
      .eq("status", "active")
    if (error) {
      return NextResponse.json(
        { error: "UPDATE_FAILED", message: error.message },
        { status: 500 },
      )
    }
    return NextResponse.json({ ok: true, status: action })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 })
  }
}
