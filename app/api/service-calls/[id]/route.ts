/**
 * /api/service-calls/[id] — PATCH: status 변경 (in_progress / done / cancelled)
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { isValidUUID } from "@/lib/validation"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await resolveAuthContext(request)
    const { id } = await params
    if (!isValidUUID(id)) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    const parsed = await parseJsonBody<{ status?: string }>(request)
    if (parsed.error) return parsed.error
    const status = parsed.body.status
    if (!status || !["in_progress", "done", "cancelled"].includes(status)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "status invalid" }, { status: 400 })
    }

    const sb = getServiceClient()
    const { data: call } = await sb.from("room_service_calls").select("id, store_uuid").eq("id", id).maybeSingle()
    if (!call) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    if (!auth.is_super_admin && call.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }

    const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
    if (status === "in_progress") {
      patch.progress_at = new Date().toISOString()
      patch.assigned_to_membership_id = auth.membership_id
    } else if (status === "done") {
      patch.completed_at = new Date().toISOString()
      if (!("assigned_to_membership_id" in patch)) patch.assigned_to_membership_id = auth.membership_id
    }

    await sb.from("room_service_calls").update(patch).eq("id", id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.type, message: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (error as Error).message }, { status: 500 })
  }
}
