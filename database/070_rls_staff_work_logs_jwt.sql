-- ============================================================
-- 070_rls_staff_work_logs_jwt.sql
--
-- RLS 7차 — staff_work_logs 를 JWT claim 기반 SELECT 정책으로 확장.
--
-- 배경:
--   065 는 origin / working / super_admin 3-policy 설계를 GUC
--   (`current_setting('app.store_uuid')` / `app.is_super_admin`) 기반으로
--   정의. PostgREST stateless 요청 모델과 GUC 세팅 경로 부재로 현 NOX
--   코드에서는 실질 적용이 불가능. 067 custom_access_token_hook + 068 의
--   rooms pilot + 069 의 hostesses / store_memberships 확장으로 JWT claim
--   경로가 E2E 성립함이 확인됨. 본 migration 은 staff_work_logs 에 동일
--   경로를 얹는다.
--
-- 설계 원칙:
--   1) origin_store_uuid / working_store_uuid dual column 구조를 그대로 반영.
--   2) lifecycle(status) 에 따라 working store 가시 범위 제한.
--   3) "단순 OR" 로 합치지 않고 policy 를 역할별로 분리 → 감사 로그/권한
--      추적 시 어느 policy 로 row 가 열렸는지 식별 가능.
--   4) 기존 비즈니스 로직 (lib/server/queries/staffWorkLogLifecycle.ts 의
--      checkBaseLifecycleGate / checkResolvable / checkDisputeScopeGate) 과
--      **정확히** 일치.
--   5) 065 와 함께 OR union 으로 공존 → GUC 세팅 경로가 생기면 그대로
--      사용 가능. 기존 API 는 여전히 service_role BYPASSRLS 경로.
--
-- 정책 3종 (065 와 동명이지만 GUC → JWT 로 매핑 변경된 독립 policy 이름):
--
--   J1  select_jwt_origin_scope
--        → origin_store_uuid = JWT app_metadata.store_uuid
--        → status 제한 없음. 전 lifecycle (draft/confirmed/disputed/settled/voided).
--        → 근거: 원천 기록물 소유자는 home store. 모든 상태 확인 필요.
--
--   J2  select_jwt_working_scope_dispute_state
--        → working_store_uuid = JWT app_metadata.store_uuid
--        → AND status IN ('confirmed','disputed')
--        → working 은 dispute 접점 상태만. draft/settled/voided 비노출.
--
--   J3  select_jwt_super_admin
--        → JWT app_metadata.is_super_admin = true → 전수 가시.
--
-- lifecycle 기준 설명 (왜 working 에 confirmed/disputed 만 허용하는가):
--   draft    : origin 이 작성 중. 아직 확정 안 된 근무 기록. working 에 노출
--              시 기록물이 flip-flop 되며 dispute 트리거의 판단 기준이
--              흔들린다 → origin-private.
--   confirmed: 정산 집계 진입 직전 또는 편입 대기. working 이 "내 매장 장부
--              와 맞나?" 검증하고 이의제기할 수 있어야 함 → 노출.
--   disputed : working 이 이의 제기한 상태. 양측 모두 진행을 봐야 해결 가능
--              → 노출.
--   settled  : cross_store_settlement_items 로 편입 완료. 정산 view 는 별도
--              path 로 조회. row 원본은 origin 기록물로 보존 → origin-private.
--   voided   : origin 이 취소. working 이 보면 "이미 무효화됨" 재분쟁 유도
--              가능성 → origin-private.
--
-- 잘못 설계했을 때 발생하는 문제:
--   ❌ origin / working 을 단일 `store_uuid IN (origin_uuid, working_uuid)` OR 로
--      합치면 working 이 voided row 를 조회 → 취소된 기록을 들고 재분쟁
--      트리거. 감사 관점에서 어느 policy 가 매칭됐는지 불가지.
--   ❌ working 에 draft 노출 → 초안 기록이 확정 전에 외부 매장에 유출.
--      비즈니스 규칙 위반 (원천 기록 확정은 origin 전용).
--   ❌ settled 까지 working 에 열어주면 cross_store_settlement_items 정산
--      경로와 원본 row 경로가 이중 노출 → 금액 재계산 혼선 가능.
--   ❌ super_admin 을 별도 policy 로 분리하지 않고 `(origin = … OR working …
--      OR is_super_admin)` 단일 조건에 섞으면 super_admin bypass 가 실행
--      계획에서 seq scan 을 유도하고, policy 감사/해지 시 단위 제거 불가.
--   ❌ JWT 캐스트 없이 `= (auth.jwt() -> 'app_metadata' -> 'store_uuid')`
--      (jsonb 비교) 하면 UUID 와 타입 불일치로 row 절대 매칭 안 됨 (silent 0).
--
-- NULL-safety:
--   hook 비활성 / claim 부재 시 `((auth.jwt() -> 'app_metadata') ->> 'store_uuid')::uuid`
--   = NULL → `origin_store_uuid = NULL` UNKNOWN → row 제외. super_admin
--   claim 부재 시 `COALESCE(…::boolean, false)` = false. 모든 경우 fail-close.
--
-- 전제:
--   - service_role BYPASSRLS → 현 NOX 모든 route 무영향.
--   - 067 hook 이 활성화되면 authenticated client JWT 에 app_metadata 주입.
--   - WRITE policy 정의하지 않음 — 기존 경로 (service_role) 그대로.
--
-- idempotent: DROP IF EXISTS + CREATE POLICY 이름 고정.
-- 기존 065 policy 는 **건드리지 않음** (OR union 유지).
-- ============================================================

ALTER TABLE staff_work_logs ENABLE ROW LEVEL SECURITY;

-- 재실행 대비 본 라운드 policy cleanup
DROP POLICY IF EXISTS "select_jwt_origin_scope"                  ON staff_work_logs;
DROP POLICY IF EXISTS "select_jwt_working_scope_dispute_state"   ON staff_work_logs;
DROP POLICY IF EXISTS "select_jwt_super_admin"                   ON staff_work_logs;

-- ── J1: origin scope — 전 lifecycle 가시 ───────────────────────
CREATE POLICY "select_jwt_origin_scope"
  ON staff_work_logs
  FOR SELECT
  USING (
    staff_work_logs.origin_store_uuid
      = ((auth.jwt() -> 'app_metadata') ->> 'store_uuid')::uuid
  );

-- ── J2: working scope — dispute 접점 상태만 ────────────────────
CREATE POLICY "select_jwt_working_scope_dispute_state"
  ON staff_work_logs
  FOR SELECT
  USING (
    staff_work_logs.working_store_uuid
      = ((auth.jwt() -> 'app_metadata') ->> 'store_uuid')::uuid
    AND staff_work_logs.status IN ('confirmed', 'disputed')
  );

-- ── J3: super_admin bypass ─────────────────────────────────────
CREATE POLICY "select_jwt_super_admin"
  ON staff_work_logs
  FOR SELECT
  USING (
    COALESCE(
      ((auth.jwt() -> 'app_metadata') ->> 'is_super_admin')::boolean,
      false
    ) = true
  );

COMMENT ON POLICY "select_jwt_origin_scope" ON staff_work_logs IS
  'RLS-phase-7: origin_store_uuid = JWT app_metadata.store_uuid → 전 lifecycle 가시. 065 GUC policy 와 OR union.';
COMMENT ON POLICY "select_jwt_working_scope_dispute_state" ON staff_work_logs IS
  'RLS-phase-7: working_store_uuid = JWT app_metadata.store_uuid AND status IN (confirmed, disputed). draft/settled/voided 비노출.';
COMMENT ON POLICY "select_jwt_super_admin" ON staff_work_logs IS
  'RLS-phase-7: JWT app_metadata.is_super_admin=true → 전 row 가시.';

-- WRITE policy 없음. mutation 은 service_role 로만 (BYPASSRLS).
