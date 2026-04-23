-- ============================================================
-- 070_rls_cross_store_work_records_jwt.sql
--
-- RLS 7차 — cross_store_work_records 를 JWT claim 기반 SELECT 정책으로 확장.
--
-- ⚠️ 수정 이력:
--   본 파일은 처음 `staff_work_logs` 를 대상으로 작성되었다. live DB 실측
--   확인 결과:
--     - 실제 테이블명: `cross_store_work_records` (009_cross_store_settlement.sql)
--     - 실제 status 값: 'pending' 하나 (lifecycle 단일 상태)
--   에 따라 본 파일을 리네임 + 정책명/상태필터 전면 교체. 기존 065 는
--   `staff_work_logs` 를 참조하며, 만약 그 테이블이 live 에 존재하지
--   않는다면 해당 migration 도 재검토 필요 (본 라운드 범위 외).
--
-- 배경:
--   067 custom_access_token_hook + 068 rooms pilot + 069 hostesses /
--   store_memberships 확장으로 JWT claim 경로가 E2E 성립. 본 migration 은
--   cross_store_work_records 에 동일 경로를 얹는다.
--
-- 설계 원칙:
--   1) origin_store_uuid / working_store_uuid dual column 구조를 그대로 반영.
--   2) lifecycle(status='pending') 에 따라 working store 가시 범위 제한.
--      현 스키마는 단일 상태라 working 에게는 pending 만 노출되는 셈이지만,
--      향후 상태가 추가(e.g. 'confirmed','settled','voided') 되면 working 에
--      새 상태가 자동 노출되지 않도록 정책이 status 리터럴로 못 박는 것이
--      핵심 — 단순 OR 차단.
--   3) 정책을 역할별로 분리 → 감사/권한 추적 시 어느 policy 로 row 가
--      열렸는지 식별 가능.
--   4) 기존 비즈니스 로직 (cross-store settlement ledger 생성 경로) 와
--      정합. service role BYPASSRLS 로 기존 API 무영향.
--
-- 정책 3종:
--
--   J1  select_jwt_origin_scope
--        → origin_store_uuid = JWT app_metadata.store_uuid
--        → status 제한 없음 (현재 단일 상태 pending, 미래 상태 추가 시에도
--          origin 은 원천 소유자로 전수 열람 유지).
--
--   J2  select_jwt_working_scope_pending
--        → working_store_uuid = JWT app_metadata.store_uuid
--        → AND status = 'pending'
--        → working 은 원천이 아직 pending 단계일 때만 가시.
--          미래에 post-pending 상태(예: settled/voided) 가 추가되면 명시
--          업데이트 없이는 노출되지 않도록 pending 리터럴로 고정.
--
--   J3  select_jwt_super_admin
--        → JWT app_metadata.is_super_admin = true → 전수 가시.
--
-- lifecycle 기준 설명:
--   pending : origin 이 cross-store 근무를 기록한 초기 상태. working 은
--             "내 매장에서 일한 외부 아가씨 근무 기록" 으로 참조 필요 →
--             노출.
--   (미래 상태) : working 에 계속 노출할지 정책 재확정 필요. 기본은
--             origin-private (J1 만 허용).
--
-- 잘못 설계했을 때 발생하는 문제:
--   ❌ `status IN ('confirmed','disputed')` (구 staff_work_logs 기준) 를
--      그대로 쓰면 현 스키마의 'pending' row 가 working 에 0건 반환 →
--      cross-store 운영 대시보드가 빈 페이지로 degrade.
--   ❌ 단순 OR (`store_uuid IN (origin, working)`) 로 합치면 미래 상태
--      추가 시 working 이 원치 않는 상태를 자동 열람 → 비즈니스 규칙 위반.
--   ❌ status 필터를 제외하면 voided/settled (미래) 가 working 에 노출.
--   ❌ super_admin 을 단일 조건에 섞으면 감사/해지 단위 불가.
--   ❌ JWT 캐스트 누락 시 UUID ↔ jsonb 타입 불일치로 silent 0 rows.
--
-- NULL-safety:
--   hook 비활성 / claim 부재 시 `((auth.jwt() -> 'app_metadata') ->> 'store_uuid')::uuid`
--   = NULL → `… = NULL` UNKNOWN → row 제외. super_admin claim 부재 시
--   `COALESCE(…::boolean, false)` = false. 모든 경우 fail-close.
--
-- 전제:
--   - service_role BYPASSRLS → 현 NOX 모든 route 무영향.
--   - 067 hook 활성 시 authenticated client JWT 에 app_metadata 주입.
--   - WRITE policy 정의하지 않음 — 기존 경로 (service_role) 그대로.
--
-- idempotent: DROP IF EXISTS + CREATE POLICY 이름 고정.
-- 라이브에 이미 070 의 구버전(staff_work_logs 기준 정책명) 이 동일 테이블
-- 에 적용됐을 가능성을 대비해 `select_jwt_working_scope_dispute_state` 도
-- DROP 목록에 포함.
-- ============================================================

ALTER TABLE cross_store_work_records ENABLE ROW LEVEL SECURITY;

-- 재실행 대비 본 라운드 policy cleanup
DROP POLICY IF EXISTS "select_jwt_origin_scope"                  ON cross_store_work_records;
DROP POLICY IF EXISTS "select_jwt_working_scope_dispute_state"   ON cross_store_work_records;
DROP POLICY IF EXISTS "select_jwt_working_scope_pending"         ON cross_store_work_records;
DROP POLICY IF EXISTS "select_jwt_super_admin"                   ON cross_store_work_records;

-- ── J1: origin scope — 전 lifecycle 가시 ───────────────────────
CREATE POLICY "select_jwt_origin_scope"
  ON cross_store_work_records
  FOR SELECT
  USING (
    cross_store_work_records.origin_store_uuid
      = ((auth.jwt() -> 'app_metadata') ->> 'store_uuid')::uuid
  );

-- ── J2: working scope — status='pending' 만 ────────────────────
CREATE POLICY "select_jwt_working_scope_pending"
  ON cross_store_work_records
  FOR SELECT
  USING (
    cross_store_work_records.working_store_uuid
      = ((auth.jwt() -> 'app_metadata') ->> 'store_uuid')::uuid
    AND cross_store_work_records.status = 'pending'
  );

-- ── J3: super_admin bypass ─────────────────────────────────────
CREATE POLICY "select_jwt_super_admin"
  ON cross_store_work_records
  FOR SELECT
  USING (
    COALESCE(
      ((auth.jwt() -> 'app_metadata') ->> 'is_super_admin')::boolean,
      false
    ) = true
  );

COMMENT ON POLICY "select_jwt_origin_scope" ON cross_store_work_records IS
  'RLS-phase-7: origin_store_uuid = JWT app_metadata.store_uuid → 전 lifecycle 가시. service role BYPASSRLS.';
COMMENT ON POLICY "select_jwt_working_scope_pending" ON cross_store_work_records IS
  'RLS-phase-7: working_store_uuid = JWT app_metadata.store_uuid AND status = pending. 미래 상태 추가 시 자동 노출 차단.';
COMMENT ON POLICY "select_jwt_super_admin" ON cross_store_work_records IS
  'RLS-phase-7: JWT app_metadata.is_super_admin=true → 전 row 가시.';

-- WRITE policy 없음. mutation 은 service_role 로만 (BYPASSRLS).
