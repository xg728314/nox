import type { AuthContext } from "@/lib/auth/resolveAuthContext"
import { getServiceClient } from "@/lib/supabase/serviceClient"
import { NextResponse } from "next/server"
import { logAuditEvent, auditOr500 } from "@/lib/audit/logEvent"

/**
 * /api/staff-work-logs 계열 lifecycle 공통 로직.
 *
 * ⚠️ 2026-04-24 수정:
 *   라이브 DB 에 `staff_work_logs` 테이블이 없고 `cross_store_work_records`
 *   만 존재. 본 모듈은 `cross_store_work_records` 실 컬럼 기준으로 동작한다.
 *   staff_work_logs 로 되돌리는 작업이 아니며, `manager_membership_id` /
 *   `created_by` / `started_at` / `working_store_room_uuid` / `category` /
 *   `work_type` / `memo` / `void_reason` / `confirmed_by` 등 과거 컬럼은
 *   전부 제거됨. 다른 테이블의 `manager_membership_id` (sessions /
 *   session_participants / hostesses) 의미는 변경하지 않는다.
 *
 * cross_store_work_records 실 컬럼 (009_cross_store_settlement.sql):
 *   id, session_id, business_day_id, working_store_uuid, origin_store_uuid,
 *   hostess_membership_id, requested_by, approved_by, approved_at,
 *   status, created_at, updated_at, deleted_at
 *
 * 전이 매트릭스 (본 라운드 정의):
 *   pending   → confirmed  : confirm route (owner / super_admin)
 *   confirmed → disputed   : dispute route (owner / manager / super_admin)
 *   disputed  → resolved   : resolve route (owner / super_admin)
 *   any non-voided → voided : void route (soft delete via status flag)
 *
 * store scope:
 *   non-super_admin 은 `origin_store_uuid === auth.store_uuid` 가 기본.
 *   dispute 만 origin/working 양쪽 매장 허용.
 */

export type WorkLogRow = {
  id: string
  session_id: string | null
  business_day_id: string | null
  working_store_uuid: string
  origin_store_uuid: string
  hostess_membership_id: string
  requested_by: string | null
  approved_by: string | null
  approved_at: string | null
  status: string
}

export type LifecycleError = {
  error: string
  message: string
  status: number
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const WORK_LOG_SELECT_COLS =
  "id, session_id, business_day_id, working_store_uuid, origin_store_uuid, " +
  "hostess_membership_id, requested_by, approved_by, approved_at, " +
  "status, created_at, updated_at, deleted_at"

export async function loadWorkLog(
  id: string,
): Promise<{ row: WorkLogRow | null; error: LifecycleError | null }> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from("cross_store_work_records")
    .select(
      "id, session_id, business_day_id, working_store_uuid, origin_store_uuid, " +
        "hostess_membership_id, requested_by, approved_by, approved_at, status",
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
  return { row: data as unknown as WorkLogRow, error: null }
}

/**
 * 전이 공통 게이트:
 *   - resolved / voided 는 terminal → 재전이 불가
 *   - non-super_admin 은 origin_store_uuid 일치 필요 (dispute 제외)
 */
export function checkBaseLifecycleGate(
  row: WorkLogRow,
  auth: AuthContext,
): LifecycleError | null {
  if (row.status === "resolved") {
    return {
      error: "INVALID_STATE_TRANSITION",
      message: "이미 해결 완료된 기록입니다.",
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
 * Resolve (disputed → resolved) 용 종합 게이트.
 *   - disputed 아님 → 409 STATE_CONFLICT
 *   - voided / resolved → 400 INVALID_STATE_TRANSITION
 *   - non-super_admin: origin_store_uuid 일치 필요
 */
export function checkResolvable(
  row: WorkLogRow,
  auth: AuthContext,
): LifecycleError | null {
  if (row.status === "resolved") {
    return { error: "INVALID_STATE_TRANSITION", message: "이미 해결 완료된 기록입니다.", status: 400 }
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
  return null
}

/**
 * Dispute 용 scope 게이트 — origin 또는 working 매장 caller 허용.
 * terminal (resolved/voided) 는 차단. dispute 는 `confirmed` 상태에서만 허용
 * 되지만 상태 자체 검증은 route 가 수행.
 */
export function checkDisputeScopeGate(
  row: WorkLogRow,
  auth: AuthContext,
): LifecycleError | null {
  if (row.status === "resolved") {
    return { error: "INVALID_STATE_TRANSITION", message: "이미 해결된 기록입니다.", status: 400 }
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
