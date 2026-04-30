-- 104_audit_impersonation.sql
-- 2026-04-30: super_admin 의 매장/역할 override 추적성 확보.
--
-- 배경:
--   xg728314 등 super_admin 이 active context cookie 로 다른 매장/역할로
--   "view" 모드 진입 가능 (active-context API). audit_events 의
--   actor_role 은 override 된 값 (예: 'manager') 으로 기록되지만, 실제
--   본인의 base role (대부분 'owner') 은 추적 불가. impersonation 식별이
--   user_id 비교로만 가능 → 운영자가 본인 매장/역할로 행한 것인지,
--   다른 매장/역할 view 중에 행한 것인지 즉시 구분 어려움.
--
-- 변경:
--   audit_events 에 두 컬럼 추가:
--     - actor_actual_role text NULL : impersonation 시 base role.
--       NULL 이면 actor_role 이 곧 actual_role (정상 사용자).
--     - is_super_admin_view boolean NOT NULL DEFAULT false : 운영자가
--       active context cookie 로 진입한 작업인지 여부.
--
-- 정책:
--   - logAuditEvent helper 가 ctx 검사하여 자동 set:
--       is_super_admin && (active_store cookie || active_role cookie)
--       → is_super_admin_view = true
--       → actor_actual_role = "owner" (base 가정)
--   - 비-super_admin 작업은 두 필드 모두 default. 동작 변화 X.
--
-- 인덱스:
--   - is_super_admin_view = true 인 row 만 빠르게 추출 (감사 검토용).

ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS actor_actual_role text,
  ADD COLUMN IF NOT EXISTS is_super_admin_view boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_audit_super_admin_view
  ON audit_events (created_at DESC)
  WHERE is_super_admin_view = true;

COMMENT ON COLUMN audit_events.actor_actual_role IS
  'super_admin 의 base role (override 시 NULL 아님). 정상 사용자는 NULL.';
COMMENT ON COLUMN audit_events.is_super_admin_view IS
  'super_admin 이 active context override 중에 행한 작업이면 true.';
