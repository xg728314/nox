-- 100_manager_permissions.sql
--
-- R-manager-perms (2026-09-04): 사장이 실장별로 세부 권한 설정.
-- "사장이 지금 모든 권한을 특정 실장한테 모두 넘길수도 있게 하자.
--  채팅만볼수있게, 외부조판 건들일수있게, 정산, 세부적인 권한 설정할수있게"
--
-- Storage: JSONB on store_memberships
--   NULL          → 기존 실장 default (backward compat, 채팅+조판+외부조판+정산+외상+재고+리포트)
--   { "chat.view": true, ... } → 명시된 것만
--
-- Semantics:
--   - role='owner' 는 이 컬럼 무시 (implicit 전권)
--   - role='manager' + permissions NULL → default set 적용
--   - role='manager' + permissions {} → 아무것도 못 함 (완전 잠금)
--   - role='manager' + permissions { ...specific } → 지정된 것만
--
-- 사장급 permission (store.settings, managers.manage) 은 오직 사장이 명시적
-- 위임할 때만 부여. 「사장 대행」 프리셋에 포함.

ALTER TABLE store_memberships
  ADD COLUMN IF NOT EXISTS permissions JSONB;

COMMENT ON COLUMN store_memberships.permissions IS
  'Granular manager permissions (owner-set). NULL = default manager permissions. Owner role bypasses this column. Structure: { "chat.view": true, "roster.manage": true, ... }';

-- GIN index for future queries (WHERE permissions ?& array['staff.manage'])
CREATE INDEX IF NOT EXISTS idx_store_memberships_permissions
  ON store_memberships USING GIN (permissions)
  WHERE permissions IS NOT NULL;
