import { NextResponse } from "next/server"
import { resolveAuthContext } from "@/lib/auth/resolveAuthContext"
import { createServiceClient } from "@/lib/session/createServiceClient"
import { handleRouteError } from "@/lib/session/handleAuthError"
import { logAuditEvent, logDeniedAudit } from "@/lib/audit/logEvent"
import {
  parseUuid,
  parseBoundedString,
  cheapHash,
  MEMO_MAX,
} from "@/lib/security/guards"
import { ownerFinancialGuard } from "@/lib/cross-store/services/ownerFinancialGuard"

/**
 * POST /api/manager-permissions/revoke
 *
 * Phase 10 (2026-04-24): owner/super_admin 이 기존 active permission 을 회수.
 *
 * 원칙:
 *   - soft revoke (revoked_at/user/membership 세트 채움). 이력 보존.
 *   - permission_id 또는 membership_id 중 정확히 하나 제공.
 *       permission_id 지정: 해당 row 직접 회수.
 *       membership_id 지정: active row 1개를 찾아 회수 (uq_mfp_active 덕에 유일).
 *   - 이미 회수된 row 재회수 금지 (ALREADY_REVOKED 409).
 *
 * Body:
 *   { permission_id?: uuid, membership_id?: uuid, revoke_reason: string }
 *
 * 응답:
 *   200 { ok, permission_id, revoked_at }
 */

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    if (auth.role !== "owner" && auth.is_super_admin !== true) {
      await logDeniedAudit(supabase, {
        auth,
        action: "manager_permission_revoke_forbidden",
        entity_table: "manager_financial_permissions",
        reason: "ROLE_NOT_ALLOWED",
        metadata: { route: "manager_permissions/revoke" },
      })
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const permission_id = parseUuid(body.permission_id)
    const membership_id = parseUuid(body.membership_id)
    if (!permission_id && !membership_id) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "permission_id 또는 membership_id 중 하나는 필요합니다." },
        { status: 400 },
      )
    }
    if (permission_id && membership_id) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "permission_id 와 membership_id 는 동시 지정 불가." },
        { status: 400 },
      )
    }
    const revoke_reason = parseBoundedString(body.revoke_reason, MEMO_MAX)
    if (!revoke_reason) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: `revoke_reason must be non-empty and ≤ ${MEMO_MAX} chars.` },
        { status: 400 },
      )
    }

    // 대상 row 로드
    let query = supabase
      .from("manager_financial_permissions")
      .select("id, store_uuid, membership_id, can_cross_store_payout, revoked_at")
      .is("revoked_at", null)
      .is("deleted_at", null)
    if (permission_id) {
      query = query.eq("id", permission_id)
    } else if (membership_id) {
      query = query.eq("membership_id", membership_id)
    }

    const { data: rowData, error: loadErr } = await query.maybeSingle()
    if (loadErr) {
      const msg = String(loadErr.message ?? "")
      if (/relation .*manager_financial_permissions.* does not exist/i.test(msg)) {
        return NextResponse.json(
          {
            error: "MIGRATION_REQUIRED",
            message: "manager_financial_permissions 테이블이 없습니다. migration 079 적용 필요.",
            missing_migration: "079_manager_financial_permissions.sql",
          },
          { status: 409 },
        )
      }
      return NextResponse.json(
        { error: "INTERNAL_ERROR", message: "permission 조회 실패", detail: msg },
        { status: 500 },
      )
    }
    const row = rowData as {
      id: string
      store_uuid: string
      membership_id: string
      can_cross_store_payout: boolean
      revoked_at: string | null
    } | null

    if (!row) {
      // 이미 회수되었거나 존재하지 않음. 구분을 위해 별도 재조회.
      if (permission_id) {
        const { data: maybeRevoked } = await supabase
          .from("manager_financial_permissions")
          .select("id, revoked_at")
          .eq("id", permission_id)
          .maybeSingle()
        const r = maybeRevoked as { id: string; revoked_at: string | null } | null
        if (r && r.revoked_at) {
          return NextResponse.json(
            { error: "ALREADY_REVOKED", message: "이미 회수된 권한입니다." },
            { status: 409 },
          )
        }
      }
      return NextResponse.json(
        { error: "PERMISSION_NOT_FOUND", message: "active permission 을 찾을 수 없습니다." },
        { status: 404 },
      )
    }

    // store scope (super_admin 제외)
    if (auth.is_super_admin !== true && row.store_uuid !== auth.store_uuid) {
      await logDeniedAudit(supabase, {
        auth,
        action: "manager_permission_revoke_forbidden",
        entity_table: "manager_financial_permissions",
        reason: "STORE_SCOPE_FORBIDDEN",
        metadata: { permission_id: row.id, target_store_uuid: row.store_uuid },
      })
      return NextResponse.json(
        { error: "STORE_SCOPE_FORBIDDEN", message: "타매장 권한은 회수할 수 없습니다." },
        { status: 403 },
      )
    }

    const guard = await ownerFinancialGuard({
      auth,
      supabase,
      routeLabel: "manager_permission_revoke",
      entityTable: "manager_financial_permissions",
      rateLimitKey: `mfp-revoke:${auth.user_id}`,
      rateLimitPerMin: 20,
      dupKey: `mfp-revoke-dup:${auth.user_id}:${cheapHash(row.id)}`,
      dupWindowMs: 5000,
    })
    if (guard.error) return guard.error

    const nowIso = new Date().toISOString()
    const { data: updatedRow, error: updErr } = await supabase
      .from("manager_financial_permissions")
      .update({
        revoked_at: nowIso,
        revoked_by_user_id: auth.user_id,
        revoked_by_membership_id: auth.membership_id,
        revoke_reason,
        updated_at: nowIso,
      })
      .eq("id", row.id)
      .is("revoked_at", null) // 동시 revoke race 차단
      .select("id, revoked_at")
      .maybeSingle()

    if (updErr) {
      return NextResponse.json(
        { error: "UPDATE_FAILED", message: "revoke 실패", detail: updErr.message },
        { status: 500 },
      )
    }
    const updated = updatedRow as { id: string; revoked_at: string } | null
    if (!updated) {
      // race: 누군가 먼저 revoke 완료
      return NextResponse.json(
        { error: "ALREADY_REVOKED", message: "이미 회수된 권한입니다." },
        { status: 409 },
      )
    }

    await logAuditEvent(supabase, {
      auth,
      action: "manager_permission_revoked",
      entity_table: "manager_financial_permissions",
      entity_id: updated.id,
      status: "success",
      metadata: {
        permission_id: updated.id,
        membership_id: row.membership_id,
        store_uuid: row.store_uuid,
        revoked_by_role: auth.is_super_admin === true ? "super_admin" : "owner",
      },
      reason: revoke_reason,
    })

    return NextResponse.json({
      ok: true,
      permission_id: updated.id,
      revoked_at: updated.revoked_at,
    })
  } catch (error) {
    return handleRouteError(error, "manager-permissions/revoke")
  }
}
