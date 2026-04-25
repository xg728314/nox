-- ============================================================
-- 068_rls_rooms_jwt_pilot.sql
--
-- RLS 4차 — rooms 테이블 pilot: JWT claim 기반 SELECT policy.
--
-- 설계:
--   RLS 는 여러 policy 의 **union** (모든 PERMISSIVE policy 중 하나라도
--   true 면 row 가시). 따라서 기존 `select_by_store_uuid` (064) 를
--   제거하지 않고 **JWT-claim 기반 policy 를 추가**로 얹어 점진 전환.
--
--   결과:
--     - service_role (현 모든 route 기본)     → BYPASSRLS, 변화 없음
--     - authed client + JWT(app_metadata)      → JWT claim policy 통과
--     - anon + 구 GUC 방식 (현재 미구현)        → current_setting policy (무효)
--     - anon + JWT 없음                          → 어느 policy 도 통과 못함 → 0 rows
--
-- 전제:
--   - 067 의 `custom_access_token_hook` 가 Supabase Auth 에 enable 되어야
--     JWT 에 app_metadata.store_uuid / is_super_admin 이 실제 포함됨.
--   - 활성화 전이어도 본 migration 은 안전: JWT 에 app_metadata 없으면
--     `auth.jwt() -> 'app_metadata'` 가 NULL → `NULL ->> '...'` NULL →
--     `::uuid` 캐스트 NULL → `col = NULL` UNKNOWN → policy 미통과.
--     (기존 `select_by_store_uuid` 가 동일 이유로 NULL GUC 시 미통과
--      하는 동작과 정합. service role 의 BYPASS 가 유일한 열린 경로.)
--
-- pilot scope:
--   - rooms 1개 테이블만 적용. hostesses / store_memberships 는 064 의
--     current_setting policy 만 유지. 이번 라운드에서 더 확장하지 않음.
--
-- 멱등: DROP IF EXISTS + CREATE POLICY.
-- ============================================================

-- RLS 는 064 에서 이미 ENABLED. 재확인 차원으로만 명시.
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

-- 레거시 중복 cleanup (있을 경우)
DROP POLICY IF EXISTS "select_jwt_store_uuid" ON rooms;
DROP POLICY IF EXISTS "select_jwt_super_admin" ON rooms;

-- ── Policy A: JWT app_metadata.store_uuid 일치 ──────────────
--   custom_access_token_hook 이 주입한 claim 을 읽는다.
--   NULL-safe: hook 비활성 / app_metadata 누락 시 UUID 캐스트가 NULL →
--   `rooms.store_uuid = NULL` UNKNOWN → row 제외.
CREATE POLICY "select_jwt_store_uuid"
  ON rooms
  FOR SELECT
  USING (
    rooms.store_uuid = ((auth.jwt() -> 'app_metadata') ->> 'store_uuid')::uuid
  );

-- ── Policy B: JWT super_admin 바이패스 ─────────────────────
--   app_metadata.is_super_admin = true 인 JWT 는 전 row 가시.
--   COALESCE 로 누락/NULL → false.
CREATE POLICY "select_jwt_super_admin"
  ON rooms
  FOR SELECT
  USING (
    COALESCE(
      ((auth.jwt() -> 'app_metadata') ->> 'is_super_admin')::boolean,
      false
    ) = true
  );

COMMENT ON POLICY "select_jwt_store_uuid" ON rooms IS
  'RLS-phase-4 pilot: authed client 의 JWT app_metadata.store_uuid 로 same-store read 허용. service role 은 BYPASSRLS. 064 policy 와 OR union.';
COMMENT ON POLICY "select_jwt_super_admin" ON rooms IS
  'RLS-phase-4 pilot: JWT app_metadata.is_super_admin=true → 전 row 읽기.';
