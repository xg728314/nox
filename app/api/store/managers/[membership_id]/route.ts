/**
 * PATCH /api/store/managers/[membership_id] — 실장 상태 변경 (퇴사 · 재입사)
 *
 * body: { action: 'revoke' | 'restore' }
 * - revoke: status='revoked' + deleted_at=now → resolveAuthContext 에서 차단
 * - restore: status='approved' + deleted_at=null
 *
 * R-manager-mgmt (2026-09-04): 실장 그만두면 매장 정보 못 보게.
 * 본인의 owner membership 은 revoke 불가.
 */
import { NextResponse } from "next/server"
import { resolveAuthContext, AuthError } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { parseJsonBody } from "@/lib/session/parseBody"
import { writeSessionAudit } from "@/lib/session/auditWriter"
import { isValidUUID } from "@/lib/validation"

export async function PATCH(request: Request, { params }: { params: Promise<{ membership_id: string }> }) {
  try {
    const auth = await resolveAuthContext(request)
    const { membership_id: mid } = await params
    if (!isValidUUID(mid)) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    if (auth.role !== "owner" && !auth.is_super_admin) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "사장만 조작 가능" }, { status: 403 })
    }
    const parsed = await parseJsonBody<{ action?: string }>(request)
    if (parsed.error) return parsed.error
    const action = parsed.body.action
    if (!action || !["revoke", "restore"].includes(action)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "action must be revoke|restore" }, { status: 400 })
    }

    const sb = getServiceClient()
    const { data: target } = await sb.from("store_memberships")
      .select("id, store_uuid, role, status, deleted_at, profile_id").eq("id", mid).maybeSingle()
    if (!target) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    if (!auth.is_super_admin && target.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "STORE_FORBIDDEN" }, { status: 403 })
    }
    if (mid === auth.membership_id && action === "revoke") {
      return NextResponse.json({ error: "SELF_REVOKE_FORBIDDEN", message: "본인 계정은 revoke 불가" }, { status: 400 })
    }
    // owner 는 다른 owner revoke 가능 (매장 여러 사장 케이스) · 하지만 마지막 owner 방지
    if (target.role === "owner" && action === "revoke") {
      const { count } = await sb.from("store_memberships")
        .select("id", { count: "exact", head: true })
        .eq("store_uuid", target.store_uuid).eq("role", "owner").eq("status", "approved")
        .is("deleted_at", null)
      if ((count ?? 0) <= 1) {
        return NextResponse.json({ error: "LAST_OWNER", message: "마지막 사장은 revoke 불가" }, { status: 400 })
      }
    }

    const nowIso = new Date().toISOString()
    if (action === "revoke") {
      await sb.from("store_memberships").update({
        status: "revoked", deleted_at: nowIso, updated_at: nowIso,
      }).eq("id", mid)
      // R-chat-cleanup (2026-09-04): 이 실장이 참여 중인 매장 그룹채팅에서도 즉시 제거
      await sb.from("chat_participants").update({
        removed_at: nowIso,
      }).eq("membership_id", mid).is("removed_at", null)
    } else {
      await sb.from("store_memberships").update({
        status: "approved", deleted_at: null, updated_at: nowIso,
      }).eq("id", mid)
    }

    // audit
    void writeSessionAudit(sb, {
      auth,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session_id: undefined as any,
      entity_table: "store_memberships",
      entity_id: mid,
      action: action === "revoke" ? "manager_revoked" : "manager_restored",
      before: { status: target.status, deleted_at: target.deleted_at },
      after: { status: action === "revoke" ? "revoked" : "approved" },
    }).catch(() => { /* silent */ })

    return NextResponse.json({ ok: true, membership_id: mid, action })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (e as Error).message }, { status: 500 })
  }
}
