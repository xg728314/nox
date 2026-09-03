/**
 * /api/waitlist/[id] — PATCH: 상태 변경 (matched/cancelled)
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
    const parsed = await parseJsonBody<{ status?: string; matched_target_store_uuid?: string }>(request)
    if (parsed.error) return parsed.error
    const b = parsed.body

    if (!b.status || !["matched", "cancelled"].includes(b.status)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "status invalid" }, { status: 400 })
    }

    const sb = getServiceClient()
    const { data: wl } = await sb.from("waitlist_requests")
      .select("id, store_uuid, author_membership_id, status")
      .eq("id", id).maybeSingle()
    if (!wl) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })

    // 취소는 본인 or 본 매장 owner/manager
    // matched 는 상대 매장 or 본 매장 아무나
    if (b.status === "cancelled") {
      const isAuthor = wl.author_membership_id === auth.membership_id
      const isSameStoreMgr = wl.store_uuid === auth.store_uuid && (auth.role === "owner" || auth.role === "manager")
      if (!isAuthor && !isSameStoreMgr && !auth.is_super_admin) {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
      }
    }

    const patch: Record<string, unknown> = { status: b.status, updated_at: new Date().toISOString() }
    if (b.status === "matched") {
      patch.matched_at = new Date().toISOString()
      patch.matched_by_membership_id = auth.membership_id
      if (b.matched_target_store_uuid && isValidUUID(b.matched_target_store_uuid)) {
        patch.matched_target_store_uuid = b.matched_target_store_uuid
      } else {
        patch.matched_target_store_uuid = auth.store_uuid
      }
    }

    await sb.from("waitlist_requests").update(patch).eq("id", id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.type, message: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (error as Error).message }, { status: 500 })
  }
}
