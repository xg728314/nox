-- ============================================================
-- rollback for 071 / 072 / 073
--
-- 071_rls_room_sessions_jwt.sql
-- 072_rls_session_participants_jwt.sql
-- 073_rls_orders_jwt.sql
--
-- 이 스크립트는 위 3개 migration 이 적용된 상태에서 **정책만 제거**한다.
-- RLS 자체는 DISABLE 하지 않음 — live 에 다른 policy 가 동시 존재할 수
-- 있으니, RLS 를 강제로 끄면 해당 정책들도 무력화된다. 필요 시 ALTER
-- TABLE ... DISABLE ROW LEVEL SECURITY 를 아래 "전체 해제" 블록에서
-- 주석 해제해 수동 실행.
--
-- 순서:
--   1) 정책 이름 기반 DROP IF EXISTS — 멱등, 안전.
--   2) (선택) RLS 자체 OFF.
--
-- 실행 전 체크:
--   - service_role 로 실행할 것 (owner/superuser 권한 필요).
--   - RLS OFF 블록 사용 시 다른 정책 (064/068/069/070) 과의 상호작용
--     직접 확인.
-- ============================================================

-- ── 1) room_sessions 정책 제거 ─────────────────────────────────
DROP POLICY IF EXISTS "select_jwt_store_uuid"  ON room_sessions;
DROP POLICY IF EXISTS "select_jwt_super_admin" ON room_sessions;

-- ── 2) session_participants 정책 제거 ──────────────────────────
DROP POLICY IF EXISTS "select_jwt_working_scope"             ON session_participants;
DROP POLICY IF EXISTS "select_jwt_origin_scope_cross_store"  ON session_participants;
DROP POLICY IF EXISTS "select_jwt_super_admin"               ON session_participants;
-- 본 라운드 초안에선 미사용이지만 호환 위해 구 이름도 포함:
DROP POLICY IF EXISTS "select_jwt_store_uuid"                ON session_participants;

-- ── 3) orders 정책 제거 ────────────────────────────────────────
DROP POLICY IF EXISTS "select_jwt_store_uuid"  ON orders;
DROP POLICY IF EXISTS "select_jwt_super_admin" ON orders;

-- ── (선택) RLS 자체 OFF ────────────────────────────────────────
-- 필요 시 주석 해제. 주의: 본 테이블들에 **다른 migration 이 만든
-- policy 가 존재하는 경우 그것도 동시 무력화**된다. 로그를 pg_policies
-- 로 먼저 확인.
-- ALTER TABLE room_sessions         DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE session_participants  DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE orders                DISABLE ROW LEVEL SECURITY;

-- ── 검증 쿼리 (rollback 후 실행 권장) ──────────────────────────
-- SELECT schemaname, tablename, policyname, cmd, qual
--   FROM pg_policies
--  WHERE tablename IN ('room_sessions','session_participants','orders')
--  ORDER BY tablename, policyname;
