-- ============================================================
-- 069_rls_select_jwt_expand.sql
--
-- RLS 6차 — rooms JWT pilot 패턴을 hostesses / store_memberships 로 확장.
--
-- 목적:
--   068 에서 rooms 에 적용해 E2E 검증 완료한 JWT-claim 기반 SELECT policy
--   (same-store + super_admin) 를 동일 구조로 hostesses / store_memberships
--   에 확장. 기존 064 의 `select_by_store_uuid` (current_setting GUC 기반)
--   는 그대로 유지되어 OR union 으로 공존 (점진 전환).
--
-- 전제 / 불변식:
--   - service_role 은 BYPASSRLS → 현 NOX 전 route 동작 무영향.
--   - Custom Access Token Hook (067) 활성 가정 — 비활성이어도
--     `(auth.jwt() -> 'app_metadata' ->> 'store_uuid')::uuid` = NULL 이므로
--     정책이 row 를 허용하지 않음 (fail-close).
--   - hostesses.store_uuid / store_memberships.store_uuid 존재 (002 schema).
--
-- WRITE (INSERT/UPDATE/DELETE):
--   본 migration 에서 WRITE policy 는 **절대 정의하지 않음**. service role
--   로만 mutation 이 이루어지므로 현행 경로에 영향 없음. authenticated
--   client 의 WRITE 는 policy 부재로 거부되지만 NOX 는 그 경로를 쓰지 않음.
--
-- 추가 레거시 cleanup:
--   001 의 `disabled_for_mvp` (USING true, 모든 역할에 전권 읽기/쓰기) 가
--   과거 prod 에 적용됐을 가능성에 대비해 DROP IF EXISTS 로 재확인.
--   064 에서 이미 제거했지만 멱등성 차원에서 한 번 더 보장.
--
-- 멱등: DROP IF EXISTS + CREATE POLICY.
-- ============================================================

-- ── hostesses ──────────────────────────────────────────────
ALTER TABLE hostesses ENABLE ROW LEVEL SECURITY;

-- 레거시 / 재실행 정리
DROP POLICY IF EXISTS "disabled_for_mvp"       ON hostesses;
DROP POLICY IF EXISTS "select_jwt_store_uuid"  ON hostesses;
DROP POLICY IF EXISTS "select_jwt_super_admin" ON hostesses;

-- Policy A: JWT app_metadata.store_uuid 일치 (same-store)
--   NULL-safe: hook 비활성 / claim 부재 → UUID 캐스트 NULL → 미매칭.
CREATE POLICY "select_jwt_store_uuid"
  ON hostesses
  FOR SELECT
  USING (
    hostesses.store_uuid = ((auth.jwt() -> 'app_metadata') ->> 'store_uuid')::uuid
  );

-- Policy B: JWT super_admin 바이패스
CREATE POLICY "select_jwt_super_admin"
  ON hostesses
  FOR SELECT
  USING (
    COALESCE(
      ((auth.jwt() -> 'app_metadata') ->> 'is_super_admin')::boolean,
      false
    ) = true
  );

COMMENT ON POLICY "select_jwt_store_uuid" ON hostesses IS
  'RLS-phase-6: authed client 의 JWT app_metadata.store_uuid 기반 same-store read. service role BYPASSRLS. 064 current_setting policy 와 OR union.';
COMMENT ON POLICY "select_jwt_super_admin" ON hostesses IS
  'RLS-phase-6: JWT app_metadata.is_super_admin=true → 전 row 읽기.';

-- ── store_memberships ──────────────────────────────────────
ALTER TABLE store_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "disabled_for_mvp"       ON store_memberships;
DROP POLICY IF EXISTS "select_jwt_store_uuid"  ON store_memberships;
DROP POLICY IF EXISTS "select_jwt_super_admin" ON store_memberships;

CREATE POLICY "select_jwt_store_uuid"
  ON store_memberships
  FOR SELECT
  USING (
    store_memberships.store_uuid = ((auth.jwt() -> 'app_metadata') ->> 'store_uuid')::uuid
  );

CREATE POLICY "select_jwt_super_admin"
  ON store_memberships
  FOR SELECT
  USING (
    COALESCE(
      ((auth.jwt() -> 'app_metadata') ->> 'is_super_admin')::boolean,
      false
    ) = true
  );

COMMENT ON POLICY "select_jwt_store_uuid" ON store_memberships IS
  'RLS-phase-6: authed client 의 JWT app_metadata.store_uuid 기반 same-store read. service role BYPASSRLS. 064 current_setting policy 와 OR union.';
COMMENT ON POLICY "select_jwt_super_admin" ON store_memberships IS
  'RLS-phase-6: JWT app_metadata.is_super_admin=true → 전 row 읽기.';

-- WRITE policy 추가 없음. 기존 WRITE 경로 (service_role BYPASSRLS) 유지.
