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
import { effectivePermissions, PERMS, hasPerm } from "@/lib/auth/permissions"

export async function PATCH(request: Request, { params }: { params: Promise<{ membership_id: string }> }) {
  try {
    const auth = await resolveAuthContext(request)
    const { membership_id: mid } = await params
    if (!isValidUUID(mid)) return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 })
    // R-manager-perms (2026-09-04): owner OR super_admin OR delegated (managers.manage)
    //   위임된 manager 도 조작 가능 → 사장이 대행자에게 실장 관리 위임 가능.
    let canManage = auth.role === "owner" || auth.is_super_admin
    if (!canManage && auth.role === "manager") {
      const sbAuth = getServiceClient()
      const { data: myMem } = await sbAuth.from("store_memberships")
        .select("permissions").eq("id", auth.membership_id).maybeSingle()
      const myPerms = effectivePermissions(
        auth.role,
        (myMem as { permissions?: Record<string, boolean> | null } | null)?.permissions ?? null,
      )
      if (hasPerm(myPerms, PERMS.MANAGERS_MANAGE)) canManage = true
    }
    if (!canManage) {
      return NextResponse.json({ error: "ROLE_FORBIDDEN", message: "사장 또는 위임된 실장만 조작 가능" }, { status: 403 })
    }
    const parsed = await parseJsonBody<{ action?: string; permissions?: Record<string, boolean> | null }>(request)
    if (parsed.error) return parsed.error
    const action = parsed.body.action
    // R-manager-perms (2026-09-04): 'set_permissions' 액션 추가.
    if (!action || !["revoke", "restore", "set_permissions"].includes(action)) {
      return NextResponse.json({ error: "BAD_REQUEST", message: "action must be revoke|restore|set_permissions" }, { status: 400 })
    }

    const sb = getServiceClient()
    const { data: target } = await sb.from("store_memberships")
      .select("id, store_uuid, role, status, deleted_at, profile_id").eq("id", mid).maybeSingle()
    if (!target) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    if (!auth.is_super_admin && target.store_uuid !== auth.store_uuid) {
      return NextResponse.json({ error: "STORE_FORBIDDEN" }, { status: 403 })
    }
    // R31 (2026-09-04): 자기 자신 방어 확장
    //   revoke : 본인 계정 → SELF_REVOKE_FORBIDDEN
    //   set_permissions : 본인 계정 → SELF_PERMS_FORBIDDEN (자기 잠금 방지)
    if (mid === auth.membership_id) {
      if (action === "revoke") {
        return NextResponse.json({ error: "SELF_REVOKE_FORBIDDEN", message: "본인 계정은 revoke 불가" }, { status: 400 })
      }
      if (action === "set_permissions") {
        return NextResponse.json({ error: "SELF_PERMS_FORBIDDEN", message: "본인 권한은 스스로 변경 불가 (self-lock 방지)" }, { status: 400 })
      }
    }
    // R31 (2026-09-04): owner 대상 조작은 사장 or super_admin 만.
    //   위임된 실장 (MANAGERS_MANAGE) 이 다른 사장을 revoke 하는 우회 차단.
    if (target.role === "owner" && (action === "revoke" || action === "set_permissions")) {
      if (auth.role !== "owner" && !auth.is_super_admin) {
        return NextResponse.json({
          error: "OWNER_TARGET_FORBIDDEN",
          message: "사장 대상 조작은 사장 본인 또는 super_admin 만 가능",
        }, { status: 403 })
      }
    }
    // R31 (2026-09-04): LAST_OWNER 가드는 super_admin 도 예외 없이 적용.
    //   매장 무주공산화 방지 — 매장에는 최소 1명의 활성 owner 필요.
    if (target.role === "owner" && action === "revoke") {
      const { count } = await sb.from("store_memberships")
        .select("id", { count: "exact", head: true })
        .eq("store_uuid", target.store_uuid).eq("role", "owner").eq("status", "approved")
        .is("deleted_at", null)
      if ((count ?? 0) <= 1) {
        return NextResponse.json({ error: "LAST_OWNER", message: "마지막 사장은 revoke 불가 (super_admin 도 예외 없음)" }, { status: 400 })
      }
    }

    const nowIso = new Date().toISOString()
    if (action === "revoke") {
      // R-manager-revoke-fix (2026-09-04): status='revoked' 는 CHECK constraint
      //   위반 (store_memberships_status_check: [approved,pending,rejected,suspended]).
      //   기존 valid enum 'suspended' 사용. deleted_at 도 함께 설정 →
      //   resolveAuthContext 가 deleted_at IS NULL 조건으로 접근 차단.
      const { error: upErr, count } = await sb.from("store_memberships").update({
        status: "suspended", deleted_at: nowIso, updated_at: nowIso,
      }, { count: "exact" }).eq("id", mid)
      if (upErr) {
        return NextResponse.json({ error: "UPDATE_FAILED", message: upErr.message }, { status: 500 })
      }
      if ((count ?? 0) === 0) {
        return NextResponse.json({ error: "NOT_UPDATED", message: "membership 을 찾지 못했거나 이미 처리됨" }, { status: 409 })
      }
      // R-chat-cleanup (2026-09-04): 이 실장이 참여 중인 채팅에서 즉시 나감.
      //   R31 fix: 실 스키마 컬럼은 removed_at 이 아니라 `left_at` (chat_participants 는
      //   { joined_at, left_at, pinned_at, deleted_at } 만 존재). 이전에는 removed_at
      //   컬럼 부재로 update 가 silently fail 했음.
      const { error: chatErr } = await sb.from("chat_participants").update({
        left_at: nowIso,
      }).eq("membership_id", mid).is("left_at", null)
      if (chatErr) {
        // non-fatal: 실장 revoke 는 성공했으니 chat cleanup 실패는 로그만.
        console.warn("[managers/revoke] chat_participants left_at update failed:", chatErr.message)
      }
    } else if (action === "restore") {
      const { error: upErr } = await sb.from("store_memberships").update({
        status: "approved", deleted_at: null, updated_at: nowIso,
      }).eq("id", mid)
      if (upErr) {
        return NextResponse.json({ error: "UPDATE_FAILED", message: upErr.message }, { status: 500 })
      }
    } else if (action === "set_permissions") {
      // R-manager-perms (2026-09-04): 실장 세부 권한 설정.
      //   대상은 role='manager' 만 (owner 는 항상 전권 → 무의미)
      //   body.permissions:
      //     null                    → NULL 저장 (backend 에서 기본 실장 권한 적용)
      //     {}                      → 완전 잠금 (아무 것도 못함)
      //     { "chat.view": true }  → 지정 키만 허용
      if (target.role !== "manager") {
        return NextResponse.json({
          error: "ROLE_MISMATCH",
          message: "권한 설정은 실장(manager) 대상만 가능 (사장은 항상 전권)",
        }, { status: 400 })
      }
      const nextPerms = parsed.body.permissions === undefined ? null : parsed.body.permissions
      // 유효성: object 또는 null 만
      if (nextPerms !== null && (typeof nextPerms !== "object" || Array.isArray(nextPerms))) {
        return NextResponse.json({ error: "BAD_REQUEST", message: "permissions must be object or null" }, { status: 400 })
      }
      const { error: upErr } = await sb.from("store_memberships").update({
        permissions: nextPerms,
        updated_at: nowIso,
      }).eq("id", mid)
      if (upErr) {
        return NextResponse.json({ error: "UPDATE_FAILED", message: upErr.message }, { status: 500 })
      }
    }

    // audit
    const auditAction =
      action === "revoke" ? "manager_revoked" :
      action === "restore" ? "manager_restored" :
      "manager_permissions_updated"
    void writeSessionAudit(sb, {
      auth,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session_id: undefined as any,
      entity_table: "store_memberships",
      entity_id: mid,
      action: auditAction,
      before: action === "set_permissions"
        ? { permissions: null /* omitted for brevity */ }
        : { status: target.status, deleted_at: target.deleted_at },
      after: action === "set_permissions"
        ? { permissions: parsed.body.permissions ?? null }
        : { status: action === "revoke" ? "revoked" : "approved" },
    }).catch(() => { /* silent */ })

    return NextResponse.json({ ok: true, membership_id: mid, action })
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.type, message: e.message }, { status: e.status })
    return NextResponse.json({ error: "INTERNAL_ERROR", message: (e as Error).message }, { status: 500 })
  }
}
