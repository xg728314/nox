-- 100_paper_ledger_access_grants.sql
-- R-Auth (2026-04-28): 종이장부 도메인의 일일 권한 제어 layer.
--
-- 모델:
--   - default 는 role 기반 (helper 의 RECONCILE_ROLE_DEFAULTS).
--     owner / manager → view+edit+review allow.
--     waiter / staff / hostess → all deny.
--   - grant 는 default 위에 덮어쓰는 control layer:
--     - kind='extend'   : default 가 deny 인데 명시 허용
--     - kind='restrict' : default 가 allow 인데 명시 차단 (사고 후 회수)
--     - kind='require_review' : 허용 유지하지만 변경 시 검수 필요 (R-C 에서 적용)
--   - owner 는 grant 무관 — 항상 모든 action 허용.
--   - 모든 grant 는 expires_at 필수 (영구 grant 금지).
--
-- 디자인 원칙 (사용자 정책 반영):
--   - 평상시 owner 부담 0 (grant 없이 manager 정상 작업)
--   - 예외 케이스 (제한 / 위임 / 검수 모드) 만 grant 로 표현
--   - 같은 (membership, action, business_date) 에 restrict + extend 충돌 시
--     restrict 우선 (safer default)

CREATE TABLE IF NOT EXISTS paper_ledger_access_grants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_uuid      uuid NOT NULL REFERENCES stores(id),
  membership_id   uuid NOT NULL REFERENCES store_memberships(id) ON DELETE CASCADE,

  /* 제어 종류 */
  kind            text NOT NULL CHECK (kind IN ('extend', 'restrict', 'require_review')),

  /* 어느 action 에 적용 */
  action          text NOT NULL CHECK (action IN ('view', 'edit', 'review')),

  /* 어느 business_date 에 유효 */
  scope_type      text NOT NULL CHECK (scope_type IN ('single_date', 'date_range', 'all_dates')),
  business_date   date,                          -- single_date 시
  date_start      date,                          -- date_range 시작 (inclusive)
  date_end        date,                          -- date_range 끝 (inclusive)

  granted_by      uuid NOT NULL REFERENCES profiles(id),
  granted_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,          -- 영구 grant 금지 (사용자 정책)
  revoked_at      timestamptz,
  revoked_by      uuid REFERENCES profiles(id),
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now(),

  /* scope_type 별 필드 일관성 강제 */
  CONSTRAINT paper_grant_scope_chk CHECK (
    (scope_type = 'single_date' AND business_date IS NOT NULL AND date_start IS NULL AND date_end IS NULL)
    OR
    (scope_type = 'date_range'  AND business_date IS NULL AND date_start IS NOT NULL AND date_end IS NOT NULL AND date_start <= date_end)
    OR
    (scope_type = 'all_dates'   AND business_date IS NULL AND date_start IS NULL AND date_end IS NULL)
  )
);

-- helper 의 fetchActiveGrants 가 hot path: membership_id + 매장 + 만료 안 된 것
CREATE INDEX IF NOT EXISTS idx_paper_grants_lookup
  ON paper_ledger_access_grants (membership_id, store_uuid, expires_at)
  WHERE revoked_at IS NULL;

-- owner 의 admin 화면용: 매장 단위 최신순
CREATE INDEX IF NOT EXISTS idx_paper_grants_admin
  ON paper_ledger_access_grants (store_uuid, granted_at DESC)
  WHERE revoked_at IS NULL;

-- RLS — service-role 만 접근 (helper 가 service-role client 로 조회)
ALTER TABLE paper_ledger_access_grants ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'paper_grant_service_only') THEN
    CREATE POLICY paper_grant_service_only ON paper_ledger_access_grants
      FOR ALL TO public USING (false) WITH CHECK (false);
  END IF;
END $$;

COMMENT ON TABLE paper_ledger_access_grants IS
  'R-Auth: 종이장부 일일 권한 제어. default(role) 위에 extend/restrict/require_review 덮어쓰기. owner 는 grant 무관 통과.';
