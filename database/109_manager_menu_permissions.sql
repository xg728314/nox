-- 109_manager_menu_permissions.sql
-- R-Manager-Permissions (2026-05-01): 실장별 메뉴 단위 권한 토글.
--
-- 운영자 의도 (사용자 결정):
--   "실장마다 권한 부여 가능. 전부 ON 으로 해놓고 나중에 사장이 OFF 토글 가능."
--
-- 정책:
--   - row 없거나 permissions={} → 모든 메뉴 ON (default ON 정책).
--   - permissions[menu_key] === false → 그 메뉴만 OFF.
--   - permissions[menu_key] === true 또는 undefined → ON.
--
-- 메뉴 key (ManagerBottomNav 의 9탭):
--   counter / attendance / my_settlement / my_ledger / payouts /
--   customers / staff_ledger / chat / my_info
--
-- Phase 1 (이번): UI hide 만. URL 직접 입력은 통과 (middleware 미적용).
-- Phase 2 (다음): middleware + API server-side 검증 (보안 완전).

CREATE TABLE IF NOT EXISTS manager_menu_permissions (
  store_uuid    uuid NOT NULL REFERENCES stores(id),
  membership_id uuid NOT NULL REFERENCES store_memberships(id),

  /* 권한 jsonb. 예:
     { "counter": true, "payouts": false, "customers": true }
     undefined / true → ON (default).
     false → OFF (사장이 명시적으로 차단).
   */
  permissions   jsonb NOT NULL DEFAULT '{}'::jsonb,

  /* 변경 audit */
  updated_by_user_id       uuid REFERENCES profiles(id),
  updated_by_membership_id uuid REFERENCES store_memberships(id),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (store_uuid, membership_id)
);

CREATE INDEX IF NOT EXISTS idx_mmp_membership
  ON manager_menu_permissions (membership_id);

COMMENT ON TABLE manager_menu_permissions IS
  'R-Manager-Permissions (2026-05-01): 실장별 메뉴 단위 권한. row 없거나 빈 jsonb=모든 메뉴 ON. false 만 OFF.';

ALTER TABLE manager_menu_permissions ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'mmp_service_only') THEN
    CREATE POLICY mmp_service_only ON manager_menu_permissions
      FOR ALL TO public USING (false) WITH CHECK (false);
  END IF;
END $$;
