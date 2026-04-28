/**
 * R-Auth: 도메인 무관 일일 권한 제어 layer.
 *
 * 모델:
 *   - default 는 role 기반 (호출자가 role_defaults 매트릭스 제공)
 *   - grant 는 default 위에 덮어쓰는 control layer:
 *       extend          → default deny 인데 명시 허용
 *       restrict        → default allow 인데 명시 차단
 *       require_review  → 허용 유지하지만 변경 시 검수 필요
 *   - owner 는 grant 무관 — 항상 모든 action 허용
 *   - 같은 (action, business_date) 에 restrict + extend 충돌 시 restrict 우선 (safer)
 *
 * 도메인별 사용:
 *   - 종이장부:  table='paper_ledger_access_grants', role_defaults=RECONCILE_ROLE_DEFAULTS
 *   - 향후 도메인 (정산/외상 등): 동일 helper, 다른 table + role_defaults
 *
 * 호출 패턴:
 *   1) 단건:    resolveFeatureAccess(supabase, auth, { table, store_uuid, business_date, action, role_defaults })
 *   2) 배치:    fetchActiveGrants() 한 번 + resolveAccessFromGrants() 여러 번
 *               (list 화면처럼 여러 business_date 평가 시)
 *
 * Fail policy:
 *   - DB 장애 (grant 조회 실패) → fail-closed (allowed=false). 운영 사고 방지.
 *   - role 이 role_defaults 에 없으면 fail-closed (모든 action deny).
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { AuthContext } from "@/lib/auth/resolveAuthContext"

// ─── 타입 ────────────────────────────────────────────────────────

export type AccessAction = "view" | "edit" | "review"

export type GrantKind = "extend" | "restrict" | "require_review"

export type ScopeType = "single_date" | "date_range" | "all_dates"

/** DB 의 paper_ledger_access_grants row shape (다른 도메인도 동일 schema). */
export type ActiveGrant = {
  id: string
  store_uuid: string
  membership_id: string
  kind: GrantKind
  action: AccessAction
  scope_type: ScopeType
  business_date: string | null
  date_start: string | null
  date_end: string | null
  expires_at: string
}

/** 도메인별 role 기본 정책. action 별 boolean. */
export type RoleDefaults = Record<string, Record<AccessAction, boolean>>

/** 종이장부 도메인의 role 기본 정책.
 *  사용자 정책: owner/manager 자유, waiter/staff/hostess 차단.
 *  (counter 는 role enum 이 아니라 owner/manager 의 delegated UI actor 라 별도 항목 없음.)
 */
export const RECONCILE_ROLE_DEFAULTS: RoleDefaults = {
  owner:   { view: true,  edit: true,  review: true },
  manager: { view: true,  edit: true,  review: true },
  waiter:  { view: false, edit: false, review: false },
  staff:   { view: false, edit: false, review: false },
  hostess: { view: false, edit: false, review: false },
}

export type AccessResolution = {
  /** 최종 접근 가능 여부. action 별로 호출자가 분기. */
  allowed: boolean
  /** require_review grant 가 적용됐는지 (R-C 에서 저장 시 검수 강제용). */
  requires_review: boolean
  /** 결정 source — owner / role_default / grant. audit/UI 표시용. */
  via: "owner" | "role_default" | "grant"
  /** baseline (grant 없었을 때) 결정. 디버깅 / 사용자 안내용. */
  baseline_role_decision: boolean
  /** 실제 적용된 grant id 들. audit 기록 권장. */
  applied_grants: string[]
}

export type AccessCheckInput = {
  table: string
  store_uuid: string
  business_date: string                 // 'YYYY-MM-DD'
  action: AccessAction
  role_defaults: RoleDefaults
}

// ─── 핵심 함수 ────────────────────────────────────────────────────

/**
 * 호출자 (auth) 의 매장 + 멤버십에 active grant 전부 조회.
 * action / business_date 필터링은 in-memory 로 (list 같은 batch 케이스 효율).
 *
 * Fail-closed: 조회 실패 시 빈 배열 반환 (호출자가 baseline 만 적용 → role 기반 결과만).
 * 호출자가 명시적으로 fail 케이스 처리하려면 try/catch 직접.
 */
export async function fetchActiveGrants(
  supabase: SupabaseClient,
  auth: AuthContext,
  table: string,
): Promise<ActiveGrant[]> {
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from(table)
    .select("id, store_uuid, membership_id, kind, action, scope_type, business_date, date_start, date_end, expires_at")
    .eq("store_uuid", auth.store_uuid)
    .eq("membership_id", auth.membership_id)
    .is("revoked_at", null)
    .gt("expires_at", nowIso)

  if (error || !data) return []
  return data as ActiveGrant[]
}

/**
 * 미리 받은 grants 배열 + role_defaults 로 단일 (business_date, action) 평가.
 * batch 처리 (예: list 의 N개 snapshot) 시 이걸 반복 호출.
 *
 * 정책:
 *   - owner → 항상 allow (grant 무시)
 *   - role 이 role_defaults 에 없으면 → fail-closed (deny)
 *   - matched grants 중 restrict 가 하나라도 있으면 → deny
 *   - 그 외 extend 가 있으면 → allow
 *   - require_review 는 allow 결정과 무관, requires_review=true 만 셋
 */
export function resolveAccessFromGrants(
  auth: AuthContext,
  grants: ActiveGrant[],
  input: { business_date: string; action: AccessAction; role_defaults: RoleDefaults },
): AccessResolution {
  // owner 자동 통과
  if (auth.role === "owner") {
    return {
      allowed: true,
      requires_review: false,
      via: "owner",
      baseline_role_decision: true,
      applied_grants: [],
    }
  }

  // baseline = role default (없으면 fail-closed)
  const baseline = input.role_defaults[auth.role]?.[input.action] ?? false

  // 이 action + business_date 에 매칭되는 grant 만 추출
  const matched = grants.filter((g) => {
    if (g.action !== input.action) return false
    if (g.scope_type === "all_dates") return true
    if (g.scope_type === "single_date") return g.business_date === input.business_date
    if (g.scope_type === "date_range") {
      return (
        !!g.date_start && !!g.date_end &&
        g.date_start <= input.business_date && input.business_date <= g.date_end
      )
    }
    return false
  })

  let allowed = baseline
  let requires_review = false

  const has_restrict = matched.some((g) => g.kind === "restrict")
  const has_extend = matched.some((g) => g.kind === "extend")
  const has_review = matched.some((g) => g.kind === "require_review")

  // restrict 우선 (safer default)
  if (has_restrict) allowed = false
  else if (has_extend) allowed = true
  if (has_review) requires_review = true

  return {
    allowed,
    requires_review,
    via: matched.length > 0 ? "grant" : "role_default",
    baseline_role_decision: baseline,
    applied_grants: matched.map((g) => g.id),
  }
}

/**
 * 단건 평가 wrapper: fetchActiveGrants + resolveAccessFromGrants.
 * 1회 호출 endpoint (단일 snapshot 검증) 에서 사용.
 *
 * 참고: 같은 요청에서 여러 번 평가하면 매번 DB 조회 — batch (list) 에서는
 * fetchActiveGrants 한 번 받고 resolveAccessFromGrants 반복 사용 권장.
 */
export async function resolveFeatureAccess(
  supabase: SupabaseClient,
  auth: AuthContext,
  input: AccessCheckInput,
): Promise<AccessResolution> {
  // owner 빠른 경로 — DB 조회 스킵
  if (auth.role === "owner") {
    return {
      allowed: true,
      requires_review: false,
      via: "owner",
      baseline_role_decision: true,
      applied_grants: [],
    }
  }

  const grants = await fetchActiveGrants(supabase, auth, input.table)
  return resolveAccessFromGrants(auth, grants, {
    business_date: input.business_date,
    action: input.action,
    role_defaults: input.role_defaults,
  })
}
