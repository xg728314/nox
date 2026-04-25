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
 * POST /api/manager-permissions/grant
 *
 * Phase 10 (2026-04-24): owner/super_admin 이 매장 소속 manager 에게
 * cross-store payout 실행 권한을 명시 위임한다.
 *
 * 원칙:
 *   - handler / executor / permission 세 축 혼합 금지.
 *     본 API 는 permission 축만 조작한다.
 *   - owner 경로 재사용: ownerFinancialGuard (reauth + ratelimit + dup + day)
 *     를 통과해야만 grant 실행 가능.
 *   - 중복 active grant 는 23505 (uq_mfp_active) 로 차단, route 에서
 *     ALREADY_GRANTED 409 로 매핑.
 *
 * Body:
 *   { membership_id: uuid, grant_reason: string }
 *
 * 응답:
 *   201 { ok, permission_id, membership_id, granted_at }
 */

export async function POST(request: Request) {
  try {
    const auth = await resolveAuthContext(request)

    const svc = createServiceClient()
    if (svc.error) return svc.error
    const supabase = svc.supabase

    // role gate: owner / super_admin only
    if (auth.role !== "owner" && auth.is_super_admin !== true) {
      await logDeniedAudit(supabase, {
        auth,
        action: "manager_permission_grant_forbidden",
        entity_table: "manager_financial_permissions",
        reason: "ROLE_NOT_ALLOWED",
        metadata: { route: "manager_permissions/grant" },
      })
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const membership_id = parseUuid(body.membership_id)
    if (!membership_id) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "membership_id must be a valid uuid." },
        { status: 400 },
      )
    }
    const grant_reason = parseBoundedString(body.grant_reason, MEMO_MAX)
    if (!grant_reason) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: `grant_reason must be non-empty and ≤ ${MEMO_MAX} chars.` },
        { status: 400 },
      )
    }

    // target membership 검증: approved manager + 같은 매장 (super_admin 제외)
    const { data: targetRow, error: targetErr } = await supabase
      .from("store_memberships")
      .select("id, store_uuid, role, status")
      .eq("id", membership_id)
      .is("deleted_at", null)
      .maybeSingle()
    if (targetErr) {
      return NextResponse.json(
        { error: "INTERNAL_ERROR", message: "target membership 조회 실패", detail: targetErr.message },
        { status: 500 },
      )
    }
    const target = targetRow as { id: string; store_uuid: string; role: string; status: string } | null
    if (!target) {
      return NextResponse.json(
        { error: "TARGET_NOT_FOUND", message: "대상 membership 을 찾을 수 없습니다." },
        { status: 404 },
      )
    }
    if (target.role !== "manager") {
      return NextResponse.json(
        { error: "TARGET_NOT_MANAGER", message: "manager role 인 membership 에만 grant 가능합니다." },
        { status: 400 },
      )
    }
    if (target.status !== "approved") {
      return NextResponse.json(
        { error: "TARGET_NOT_APPROVED", message: "approved membership 에만 grant 가능합니다." },
        { status: 400 },
      )
    }
    // 타매장 grant 금지 (super_admin 은 예외 — 단, target.store_uuid 를 scope 로 사용)
    if (auth.is_super_admin !== true && target.store_uuid !== auth.store_uuid) {
      return NextResponse.json(
        { error: "STORE_SCOPE_FORBIDDEN", message: "타매장 manager 에게는 grant 할 수 없습니다." },
        { status: 403 },
      )
    }
    const scopeStoreUuid = target.store_uuid

    // financial-write 수준 보안: ownerFinancialGuard 재사용.
    // requireItemScope 미전달 → 기존 owner-only 경로 유지.
    const guard = await ownerFinancialGuard({
      auth,
      supabase,
      routeLabel: "manager_permission_grant",
      entityTable: "manager_financial_permissions",
      rateLimitKey: `mfp-grant:${auth.user_id}`,
      rateLimitPerMin: 20,
      dupKey: `mfp-grant-dup:${auth.user_id}:${cheapHash(membership_id)}`,
      dupWindowMs: 5000,
    })
    if (guard.error) return guard.error

    // INSERT — uq_mfp_active 에 의해 active 중복은 23505 로 실패.
    const { data: insertedRow, error: insErr } = await supabase
      .from("manager_financial_permissions")
      .insert({
        store_uuid: scopeStoreUuid,
        membership_id,
        can_cross_store_payout: true,
        granted_by_user_id: auth.user_id,
        granted_by_membership_id: auth.membership_id,
        grant_reason,
      })
      .select("id, granted_at")
      .maybeSingle()

    if (insErr) {
      const msg = String(insErr.message ?? "")
      const code = (insErr as { code?: string }).code ?? ""
      if (code === "23505" || /duplicate key value/i.test(msg) || /uq_mfp_active/i.test(msg)) {
        await logDeniedAudit(supabase, {
          auth,
          action: "manager_permission_grant_duplicate",
          entity_table: "manager_financial_permissions",
          reason: "ALREADY_GRANTED",
          metadata: { membership_id, store_uuid: scopeStoreUuid },
        })
        return NextResponse.json(
          { error: "ALREADY_GRANTED", message: "이미 active 권한이 존재합니다. revoke 후 재발급하세요." },
          { status: 409 },
        )
      }
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
        { error: "INSERT_FAILED", message: "grant 실패", detail: msg },
        { status: 500 },
      )
    }

    const inserted = insertedRow as { id: string; granted_at: string } | null
    if (!inserted) {
      return NextResponse.json(
        { error: "INSERT_FAILED", message: "grant row 반환 실패" },
        { status: 500 },
      )
    }

    await logAuditEvent(supabase, {
      auth,
      action: "manager_permission_granted",
      entity_table: "manager_financial_permissions",
      entity_id: inserted.id,
      status: "success",
      metadata: {
        permission_id: inserted.id,
        membership_id,
        store_uuid: scopeStoreUuid,
        can_cross_store_payout: true,
        granted_by_role: auth.is_super_admin === true ? "super_admin" : "owner",
      },
      reason: grant_reason,
    })

    return NextResponse.json(
      {
        ok: true,
        permission_id: inserted.id,
        membership_id,
        granted_at: inserted.granted_at,
      },
      { status: 201 },
    )
  } catch (error) {
    return handleRouteError(error, "manager-permissions/grant")
  }
}
