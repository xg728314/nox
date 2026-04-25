import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { logDeniedAudit, type AuditEntityTable } from "@/lib/audit/logEvent"
import { requiresReauth, hasRecentReauth } from "@/lib/security/mfaPolicy"
import { assertStoreHasOpenDay } from "@/lib/auth/assertBusinessDayOpen"
import { rateLimit, duplicateGuard } from "@/lib/security/guards"
import { rateLimitDurable } from "@/lib/security/rateLimitDurable"

export type PermissionKey = "cross_store_payout"

export type OwnerGuardItemScope = {
  // item 단위 handler. NULL = owner 본인 처리 의미 (077 주석).
  itemHandlerMembershipId: string | null
  // permission 종류. 현재 1종, 향후 enum 확장.
  permissionKey: PermissionKey
  // guard 내부 permission 조회 scope — items.store_uuid 기준.
  // auth.store_uuid 와 다를 수 있음 (super_admin 경로).
  itemStoreUuid: string
}

type OwnerGuardInput = {
  auth: AuthContext
  supabase: SupabaseClient
  routeLabel: string
  entityTable: AuditEntityTable
  rateLimitKey: string
  rateLimitPerMin: number
  dupKey: string
  dupWindowMs: number

  // ── Phase 10 (2026-04-24) 확장 (optional) ─────────────────
  // 미지정 시 기존 owner-only 동작 유지. 기존 호출부 무영향.
  // 지정 시 manager 경로 활성화 — handler AND permission AND can_flag.
  requireItemScope?: OwnerGuardItemScope
}

export type GuardResult =
  | {
      ok: true
      // caller audit 에 포함할 실행자 역할 라벨.
      executorRole: "super_admin" | "owner" | "manager_delegated"
      // manager_delegated 인 경우 통과시킨 permission row id. 감사 추적용.
      permissionId: string | null
      error?: never
    }
  | { ok?: never; executorRole?: never; permissionId?: never; error: NextResponse }

/**
 * Shared financial guard: role gate + (optional) handler+permission,
 * reauth, rate limit, duplicate guard, business day check.
 *
 * Originally owner-only (thus the legacy name). Phase 10 extends to:
 *   - super_admin: immediate role pass.
 *   - manager + requireItemScope: pass only if all of
 *       (1) item.current_handler_membership_id === auth.membership_id
 *       (2) manager_financial_permissions row active AND can_cross_store_payout=true
 *     hold simultaneously. handler and permission axes are never mixed.
 *
 * Callers without requireItemScope keep the legacy owner-only semantics
 * (+ super_admin now also passes). Manager requests to those callers
 * are still denied (ROLE_NOT_ALLOWED).
 */
export async function ownerFinancialGuard(
  input: OwnerGuardInput
): Promise<GuardResult> {
  const { auth, supabase, routeLabel, entityTable, requireItemScope } = input

  // audit entity_id NOT NULL fallback chain.
  const deniedEntityId =
    requireItemScope?.itemHandlerMembershipId ??
    auth.membership_id ??
    auth.store_uuid

  // ── [A/B/C/D] role + scope gate ────────────────────────────
  let executorRole: "super_admin" | "owner" | "manager_delegated"
  let permissionId: string | null = null

  if (auth.is_super_admin === true) {
    // [A] super_admin: role pass. 후속 검사(reauth/ratelimit/dup/day) 는 동일 적용.
    executorRole = "super_admin"
  } else if (auth.role === "owner") {
    // [B] owner: 기존 경로.
    executorRole = "owner"
  } else if (auth.role === "manager" && requireItemScope) {
    // [C] manager + item scope 제공 → handler + permission AND 검증.

    // C-1. handler 자체가 없으면 owner 본인 처리 의미 (077). manager 진입 금지.
    if (requireItemScope.itemHandlerMembershipId === null) {
      await logDeniedAudit(supabase, {
        auth,
        action: `${routeLabel}_handler_required`,
        entity_table: entityTable,
        entity_id: deniedEntityId,
        reason: "HANDLER_REQUIRED",
        metadata: {
          route: routeLabel,
          permission_key: requireItemScope.permissionKey,
          item_store_uuid: requireItemScope.itemStoreUuid,
          caller_membership_id: auth.membership_id,
        },
      })
      return {
        error: NextResponse.json(
          {
            error: "HANDLER_REQUIRED",
            message:
              "해당 item 은 handler 가 지정되지 않았습니다 (owner 본인 처리 전용). manager 는 handler 지정 후 실행하세요.",
          },
          { status: 403 }
        ),
      }
    }

    // C-2. handler 본인만 통과.
    if (requireItemScope.itemHandlerMembershipId !== auth.membership_id) {
      await logDeniedAudit(supabase, {
        auth,
        action: `${routeLabel}_not_handler`,
        entity_table: entityTable,
        entity_id: deniedEntityId,
        reason: "NOT_HANDLER",
        metadata: {
          route: routeLabel,
          permission_key: requireItemScope.permissionKey,
          item_store_uuid: requireItemScope.itemStoreUuid,
          expected_handler: requireItemScope.itemHandlerMembershipId,
          caller_membership_id: auth.membership_id,
        },
      })
      return {
        error: NextResponse.json(
          {
            error: "NOT_HANDLER",
            message: "현재 handler 본인만 실행할 수 있습니다.",
          },
          { status: 403 }
        ),
      }
    }

    // C-3. permission 조회 — handler 와 별개 축. AND 결합.
    const { data: permRow, error: permErr } = await supabase
      .from("manager_financial_permissions")
      .select("id")
      .eq("store_uuid", requireItemScope.itemStoreUuid)
      .eq("membership_id", auth.membership_id)
      .eq("can_cross_store_payout", true)
      .is("revoked_at", null)
      .is("deleted_at", null)
      .maybeSingle()

    if (permErr) {
      const msg = String(permErr.message ?? "")
      if (/relation .*manager_financial_permissions.* does not exist/i.test(msg)) {
        return {
          error: NextResponse.json(
            {
              error: "MIGRATION_REQUIRED",
              message:
                "manager_financial_permissions 테이블이 없습니다. migration 079 적용 필요.",
              missing_migration: "079_manager_financial_permissions.sql",
            },
            { status: 409 }
          ),
        }
      }
      // DB 장애: PERMISSION_DENIED 로 내리지 않고 503 — fail-close 이지만 원인 구분.
      return {
        error: NextResponse.json(
          {
            error: "SECURITY_STATE_UNAVAILABLE",
            message: "permission 조회 실패. 재시도 필요.",
          },
          { status: 503 }
        ),
      }
    }

    const row = permRow as { id: string } | null
    if (!row) {
      await logDeniedAudit(supabase, {
        auth,
        action: `${routeLabel}_permission_denied`,
        entity_table: entityTable,
        entity_id: deniedEntityId,
        reason: "PERMISSION_DENIED",
        metadata: {
          route: routeLabel,
          permission_key: requireItemScope.permissionKey,
          item_store_uuid: requireItemScope.itemStoreUuid,
          caller_membership_id: auth.membership_id,
        },
      })
      return {
        error: NextResponse.json(
          {
            error: "PERMISSION_DENIED",
            message:
              "cross-store payout 실행 권한이 없습니다. owner 승인(위임) 후 재시도하세요.",
          },
          { status: 403 }
        ),
      }
    }

    executorRole = "manager_delegated"
    permissionId = row.id
  } else {
    // [D] 그 외: hostess / manager(scope 미제공) / 기타.
    await logDeniedAudit(supabase, {
      auth,
      action: `${routeLabel}_forbidden`,
      entity_table: entityTable,
      entity_id: deniedEntityId,
      reason: "ROLE_NOT_ALLOWED",
      metadata: { route: routeLabel, caller_role: auth.role },
    })
    return {
      error: NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }),
    }
  }

  // ── 2. Reauth (manager 도 financial_write 에서 요구됨: mfaPolicy) ──
  // super_admin 도 동일 적용 — root 일수록 더 엄격.
  // Role 타입은 hostess|owner|manager 만 인식하므로 super_admin 은 auth.role 그대로 사용.
  // auth.role 은 waiter/staff 포함 확장 enum — mfaPolicy Role 타입과 맞추기 위해
  // 해당 분기에서만 owner/manager/hostess 세 값으로 안전 매핑. 그 외는 reauth 생략.
  const mfaRole: "owner" | "manager" | "hostess" =
    auth.role === "owner" || auth.role === "manager" ? auth.role : "hostess"
  if (requiresReauth("financial_write", mfaRole)) {
    const ok = await hasRecentReauth(supabase, auth.user_id, "financial_write")
    if (!ok) {
      await logDeniedAudit(supabase, {
        auth,
        action: "sensitive_action_blocked_due_to_missing_reauth",
        entity_table: entityTable,
        entity_id: deniedEntityId,
        reason: "REAUTH_REQUIRED",
        metadata: { route: routeLabel },
      })
      return {
        error: NextResponse.json(
          { error: "REAUTH_REQUIRED", message: "Recent re-authentication required." },
          { status: 401 }
        ),
      }
    }
  }

  // ── 3. Rate limit (local + durable) ──────────────────────────
  const rlLocal = rateLimit(input.rateLimitKey, {
    limit: input.rateLimitPerMin * 2,
    windowMs: 60_000,
  })
  if (!rlLocal.ok) {
    return {
      error: NextResponse.json(
        { error: "RATE_LIMITED", message: "Too many requests. Retry shortly." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rlLocal.retryAfter / 1000)) } }
      ),
    }
  }
  const rlDurable = await rateLimitDurable(supabase, {
    key: input.rateLimitKey,
    action: "payout",
    limit: input.rateLimitPerMin,
    windowSeconds: 60,
  })
  if (!rlDurable.ok) {
    const status = rlDurable.reason === "db_error" ? 503 : 429
    return {
      error: NextResponse.json(
        {
          error: rlDurable.reason === "db_error" ? "SECURITY_STATE_UNAVAILABLE" : "RATE_LIMITED",
          message: "Too many requests. Retry shortly.",
        },
        { status, headers: { "Retry-After": String(Math.max(1, rlDurable.retryAfter)) } }
      ),
    }
  }

  // ── 4. Duplicate guard ──
  const dup = duplicateGuard(input.dupKey, input.dupWindowMs)
  if (!dup.ok) {
    return {
      error: NextResponse.json(
        { error: "DUPLICATE_SUBMIT", message: "Duplicate submission detected." },
        { status: 409, headers: { "Retry-After": String(Math.ceil(dup.retryAfter / 1000)) } }
      ),
    }
  }

  // ── 5. Business day open ──
  const dayGuard = await assertStoreHasOpenDay(supabase, auth.store_uuid)
  if (dayGuard) {
    await logDeniedAudit(supabase, {
      auth,
      action: `${routeLabel}_blocked_day_closed`,
      entity_table: entityTable,
      entity_id: deniedEntityId,
      reason: "BUSINESS_DAY_CLOSED",
      metadata: {},
    })
    return { error: dayGuard }
  }

  return { ok: true, executorRole, permissionId }
}
