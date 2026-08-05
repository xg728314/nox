/**
 * POST /api/nfc/events/[event_id]/reject
 *   실장이 "오차" 판정 · status=rejected · 매크로 채팅 미발행
 *   body: { reason?: string }
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { isValidUUID } from "@/lib/validation"

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
    const body = (await request.json().catch(() => ({}))) as { reason?: string }
    const sb = getServiceClient()

    const { data: ev, error } = await sb
      .from("nfc_scan_events")
      .select("id, status, store_uuid")
      .eq("id", event_id)
      .maybeSingle()
    if (error) {
      if ((error as { code?: string }).code === "42P01") return NextResponse.json({ error: "MIGRATION_PENDING" }, { status: 503 })
      return NextResponse.json({ error: "QUERY_FAILED", message: error.message }, { status: 500 })
    }
    if (!ev) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    if ((ev as { status: string }).status !== "pending") {
      return NextResponse.json({ error: "ALREADY_PROCESSED", status: (ev as { status: string }).status }, { status: 409 })
    }
    if (!auth.is_super_admin && (ev as { store_uuid: string }).store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "SCOPE_FORBIDDEN" }, { status: 403 })
    }
    const nowIso = new Date().toISOString()
    const { data: updated, error: upErr } = await sb
      .from("nfc_scan_events")
      .update({
        status: "rejected",
        confirmed_at: nowIso,
        confirmed_by_membership_id: auth.membership_id,
        reject_reason: body.reason ?? null,
      })
      .eq("id", event_id)
      .eq("status", "pending")
      .select("id, status, confirmed_at, reject_reason")
      .maybeSingle()
    if (upErr || !updated) {
      return NextResponse.json({ error: "UPDATE_FAILED", message: upErr?.message ?? "concurrent" }, { status: 500 })
    }
    return NextResponse.json({ event: updated })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
