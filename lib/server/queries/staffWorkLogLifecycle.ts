import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { NextResponse } from "next/server"
import { logAuditEvent, auditOr500 } from "@/lib/audit/logEvent"

/**
 * staff_work_logs lifecycle 공통 로직 (Phase 2).
 *
 * 전이 매트릭스:
 *   - draft → confirmed  : owner / super_admin 만
 *   - draft → voided     : 작성자(manager 본인) 또는 owner / super_admin
 *   - confirmed → voided : owner / super_admin 만
 *   - confirmed → disputed : owner / manager(자기 담당) / super_admin
 *   - settled            : 어떤 전이도 금지 (SETTLED_LOCKED)
 *
 * store scope:
 *   - non-super_admin 은 `origin_store_uuid === auth.store_uuid` 강제
 *
 * Phase 2 는 schema 추가 없이 기존 confirmed_by/at, voided_by/at,
 * void_reason 컬럼만 사용. dispute 의 reason 은 audit_events 메타에만
 * 남기고 row 에는 status 만 변경 (DB 대수술 금지 제약).
 */

export type WorkLogRow = {
  id: string
  origin_store_uuid: string
  working_store_uuid: string
  hostess_membership_id: string
  manager_membership_id: string | null
  status: string
  created_by: string | null
  created_by_role: string | null
  voided_by: string | null
  voided_at: string | null
}

export type LifecycleError = {
  error: string
  message: string
  status: number
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function loadWorkLog(
  id: string,
): Promise<{ row: WorkLogRow | null; error: LifecycleError | null }> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from("staff_work_logs")
    .select(
      "id, origin_store_uuid, working_store_uuid, hostess_membership_id, manager_membership_id, status, created_by, created_by_role, voided_by, voided_at",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle()
  if (error) {
    return {
      row: null,
      error: { error: "INTERNAL_ERROR", message: "로그 조회 실패", status: 500 },
    }
  }
  if (!data) {
    return {
      row: null,
      error: { error: "NOT_FOUND", message: "근무 로그를 찾을 수 없습니다.", status: 404 },
    }
  }
  return { row: data as WorkLogRow, error: null }
}

/**
 * Scope gate — 모든 lifecycle 전이 공통:
 *   - settled 불가 (SETTLED_LOCKED)
 *   - 이미 voided 는 재전이 불가 (STATE_CONFLICT)
 *   - disputed → 추가 전이는 이번 라운드 범위 밖 (Phase 3)
 *   - non-super_admin 은 origin_store_uuid 일치 필요
 */
export function checkBaseLifecycleGate(
  row: WorkLogRow,
  auth: AuthContext,
): LifecycleError | null {
  if (row.status === "settled") {
    return {
      error: "SETTLED_LOCKED",
      message: "정산 편입된 기록은 상태 변경이 불가합니다.",
      status: 400,
    }
  }
  if (row.status === "voided") {
    return {
      error: "INVALID_STATE_TRANSITION",
      message: "이미 무효화된 기록입니다.",
      status: 400,
    }
  }

  const isSuperAdmin = auth.is_super_admin === true
  if (!isSuperAdmin && row.origin_store_uuid !== auth.store_uuid) {
    return {
      error: "STORE_SCOPE_FORBIDDEN",
      message: "본 매장 외 로그는 변경할 수 없습니다.",
      status: 403,
    }
  }
  return null
}

/**
 * Resolve (disputed → confirmed) 용 종합 게이트.
 *   - settled     → 400 SETTLED_LOCKED
 *   - voided      → 400 INVALID_STATE_TRANSITION (이미 무효)
 *   - disputed 아님 → 409 STATE_CONFLICT (이번 스펙이 명시)
 *   - non-super_admin 은 origin_store_uuid 일치 필요
 *   - manager_membership_id null → 400 MANAGER_REQUIRED (정산 귀속 명확화)
 *
 * role (owner/super_admin) 은 route 쪽에서 이미 검증. 본 함수는 row
 * 상태·scope·데이터 일관성만 책임.
 */
export function checkResolvable(
  row: WorkLogRow,
  auth: AuthContext,
): LifecycleError | null {
  if (row.status === "settled") {
    return { error: "SETTLED_LOCKED", message: "정산 편입된 기록은 상태 변경이 불가합니다.", status: 400 }
  }
  if (row.status === "voided") {
    return { error: "INVALID_STATE_TRANSITION", message: "이미 무효화된 기록입니다.", status: 400 }
  }
  if (row.status !== "disputed") {
    return {
      error: "STATE_CONFLICT",
      message: `현재 상태(${row.status}) 에서는 해결할 수 없습니다. disputed 만 가능합니다.`,
      status: 409,
    }
  }
  const isSuperAdmin = auth.is_super_admin === true
  if (!isSuperAdmin && row.origin_store_uuid !== auth.store_uuid) {
    return { error: "STORE_SCOPE_FORBIDDEN", message: "본 매장 외 로그는 변경할 수 없습니다.", status: 403 }
  }
  if (!row.manager_membership_id) {
    return {
      error: "MANAGER_REQUIRED",
      message: "담당 실장 지정이 없는 분쟁 기록은 재확정할 수 없습니다. 먼저 담당 실장을 배정하세요.",
      status: 400,
    }
  }
  return null
}

/**
 * Dispute 용 scope 게이트 — origin 또는 working 매장 caller 허용.
 * settled/voided 공통 차단은 그대로 적용.
 */
export function checkDisputeScopeGate(
  row: WorkLogRow,
  auth: AuthContext,
): LifecycleError | null {
  if (row.status === "settled") {
    return { error: "SETTLED_LOCKED", message: "정산 편입된 기록은 상태 변경이 불가합니다.", status: 400 }
  }
  if (row.status === "voided") {
    return { error: "INVALID_STATE_TRANSITION", message: "이미 무효화된 기록입니다.", status: 400 }
  }
  const isSuperAdmin = auth.is_super_admin === true
  if (isSuperAdmin) return null
  const atOrigin = row.origin_store_uuid === auth.store_uuid
  const atWorking = row.working_store_uuid === auth.store_uuid
  if (!atOrigin && !atWorking) {
    return {
      error: "STORE_SCOPE_FORBIDDEN",
      message: "이 로그에 대한 매장 권한이 없습니다.",
      status: 403,
    }
  }
  return null
}

export function errResp(e: LifecycleError) {
  return NextResponse.json({ error: e.error, message: e.message }, { status: e.status })
}

export { getServiceClient, logAuditEvent, auditOr500 }
