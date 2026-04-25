import type { SupabaseClient } from "@supabase/supabase-js"
import type { AuthContext } from "@/lib/auth/resolveAuthContext"

/**
 * RLS 3차 라운드 — app.store_uuid / app.is_super_admin GUC 주입 helper.
 *
 * ── 구조적 한계 (반드시 이해하고 사용) ─────────────────────────
 *
 * Supabase-JS 의 `.rpc("rls_set_context", ...)` 는 단독 HTTP 요청 = 단독
 * DB transaction. 그 안에서 `set_config(..., is_local=true)` 로 세팅한
 * GUC 는 **다음 `.from(...).select(...)` 호출 이전에 소멸**한다.
 * 즉 app 레벨에서 아래처럼 쓰면 **효과 없음**:
 *
 *   await setRlsContext(supabase, auth)          // tx A, GUC 세팅 후 종료
 *   await supabase.from("rooms").select("*")     // tx B, GUC 이미 리셋
 *
 * 이 helper 는 다음 3가지 경우에만 의미:
 *
 *   (1) SECURITY DEFINER 래퍼 Postgres function 안에서 본 RPC 가 아닌
 *       set_config 호출 + SELECT 가 한 transaction 에 묶일 때.
 *       (본 helper 자체가 아닌 RPC 함수 내부에서 호출 패턴.)
 *
 *   (2) 향후 NOX 가 Path A (JWT claim) 로 전환되면 본 helper 는 제거되고
 *       policy 가 `current_setting('request.jwt.claim.store_uuid', true)`
 *       로 재작성. 이 경우 JWT 자체가 claim 을 운반 → 주입 code 불필요.
 *
 *   (3) 테스트/진단 목적 — RPC 호출 자체가 성공하는지 (권한, 함수 존재)
 *       확인용.
 *
 * ── 현재 NOX 상황에서 호출하지 말아야 하는 이유 ─────────────
 *
 *   (a) 모든 API route 가 service role key 로 쿼리 → RLS BYPASS. GUC 가
 *       있든 없든 policy 가 평가되지 않음.
 *   (b) 설령 평가된다 해도 (1) 의 조건 외에는 GUC 가 persist 되지 않아
 *       다음 query 에서 0 rows 반환됨.
 *   (c) 매 request 당 RPC round-trip (~50-200ms) 을 추가하면서 얻는 실효 0.
 *
 *   → resolveAuthContext 직후 자동 호출 형태로 integrate **하지 않음**.
 *
 * ── 향후 활성화 경로 (로드맵) ─────────────────────────────────
 *
 *   A. JWT claim 전환 (권장):
 *      1. login route 에서 Supabase Auth 에 app_metadata 로 store_uuid
 *         + is_super_admin 주입.
 *      2. 064 / 065 migration policy 를
 *         `current_setting('request.jwt.claim.app_metadata', true)::json
 *           ->> 'store_uuid'` 형태로 재작성.
 *      3. route 들이 service role 대신 authed client 로 전환.
 *      4. 이 helper 파일 제거.
 *
 *   B. RPC-wrapped read 전환:
 *      1. 민감 테이블에 대한 read 를 SECURITY DEFINER Postgres function
 *         (예: `rooms_for_store()`) 으로 감싸고, 함수 내부에서
 *         `rls_set_context` 를 먼저 호출 후 SELECT.
 *      2. route 에서 `.from("rooms")` 대신 `.rpc("rooms_for_store")`.
 *      3. 이 helper 는 route 가 아닌 **SQL 함수 내부**에서만 호출됨.
 */

export type RlsContextResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Postgres function `rls_set_context(p_store_uuid, p_is_super_admin)` 호출.
 * JSON Supabase-JS 레벨에서 호출 시 **다음 query 에 영향 없음** (transaction
 * scope). 위 주석의 (1)(2)(3) 에 해당하는 상황에서만 유의미.
 */
export async function setRlsContext(
  supabase: SupabaseClient,
  auth: AuthContext,
): Promise<RlsContextResult> {
  const { error } = await supabase.rpc("rls_set_context", {
    p_store_uuid: auth.store_uuid,
    p_is_super_admin: auth.is_super_admin === true,
  })
  if (error) {
    return { ok: false, error: error.message }
  }
  return { ok: true }
}
