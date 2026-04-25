-- ============================================================
-- 071_rls_room_sessions_jwt.sql  (DRAFT — not yet applied to live)
--
-- RLS 8차 — room_sessions 를 JWT claim 기반 SELECT 로 보호.
--
-- 스키마 근거 (002_actual_schema.sql:107-121):
--   room_sessions (
--     id UUID PK,
--     store_uuid UUID NOT NULL,
--     room_uuid UUID NOT NULL,
--     business_day_id UUID NOT NULL,
--     status TEXT DEFAULT 'active',
--     started_at, ended_at, opened_by, closed_by, notes,
--     created_at, updated_at, deleted_at
--   )
--   → 단일 store_uuid 축. cross-store 개념 없음.
--
-- 의존:
--   - 067 (custom_access_token_hook) 활성 전제 — JWT 에 app_metadata.store_uuid /
--     is_super_admin 주입.
--   - useRooms 가 authed client (createAuthedClient) 로 전환 완료 (이전 라운드).
--
-- 정책 2종 (068/069 와 동형):
--   J1  select_jwt_store_uuid   — JWT app_metadata.store_uuid 일치 SELECT.
--   J2  select_jwt_super_admin  — JWT app_metadata.is_super_admin=true → 전 row.
--
-- WRITE policy 미정의. service_role BYPASSRLS 로 기존 경로 무영향.
-- idempotent: DROP IF EXISTS + CREATE POLICY.
-- ============================================================

ALTER TABLE room_sessions ENABLE ROW LEVEL SECURITY;

-- 레거시 / 재실행 정리
DROP POLICY IF EXISTS "disabled_for_mvp"       ON room_sessions;
DROP POLICY IF EXISTS "select_jwt_store_uuid"  ON room_sessions;
DROP POLICY IF EXISTS "select_jwt_super_admin" ON room_sessions;

CREATE POLICY "select_jwt_store_uuid"
  ON room_sessions
  FOR SELECT
  USING (
    room_sessions.store_uuid
      = ((auth.jwt() -> 'app_metadata') ->> 'store_uuid')::uuid
  );

CREATE POLICY "select_jwt_super_admin"
  ON room_sessions
  FOR SELECT
  USING (
    COALESCE(
      ((auth.jwt() -> 'app_metadata') ->> 'is_super_admin')::boolean,
      false
    ) = true
  );

COMMENT ON POLICY "select_jwt_store_uuid" ON room_sessions IS
  'RLS-phase-8: authed JWT app_metadata.store_uuid same-store SELECT. service role BYPASSRLS.';
COMMENT ON POLICY "select_jwt_super_admin" ON room_sessions IS
  'RLS-phase-8: JWT app_metadata.is_super_admin=true → 전 row 가시.';
