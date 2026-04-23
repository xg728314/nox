-- ============================================================
-- 060_cross_store_items_work_log_link.sql
-- Phase 3/4 — staff_work_logs → cross_store_settlement_items 편입.
--
-- cross_store_settlement_items 에 로그 역참조 + 종목/근무형태 + 아가씨
-- 참조 컬럼을 추가한다. items 는 (기존) manager 단위 집계 라인 +
-- (신규) 개별 로그 단위 라인 양쪽 모두 수용한다. manager_membership_id
-- 는 migration 036 에서 추가된 기존 컬럼을 그대로 사용한다.
--
-- 정책:
--   - staff_work_log_id 는 nullable. 기존 "manager 집계" line 은 NULL.
--   - 한 로그가 중복 편입되지 않도록 UNIQUE (staff_work_log_id) — Phase 4
--     aggregate API 의 idempotency 기반.
--   - hostess_membership_id 는 감사/조회 편의용. 기존 집계 라인도 NULL 허용.
--
-- 인덱스:
--   - uq_cssi_staff_work_log    : idempotent insert 의 기반 (partial unique)
--   - idx_cssi_staff_work_log   : 로그 → item 역조회
--   - idx_cssi_hostess          : 아가씨 → item 역조회 (정산 현황 UI)
-- ============================================================

ALTER TABLE cross_store_settlement_items
  ADD COLUMN IF NOT EXISTS staff_work_log_id UUID REFERENCES staff_work_logs(id),
  ADD COLUMN IF NOT EXISTS hostess_membership_id UUID REFERENCES store_memberships(id),
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS work_type TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cssi_staff_work_log
  ON cross_store_settlement_items (staff_work_log_id)
  WHERE staff_work_log_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cssi_staff_work_log
  ON cross_store_settlement_items (staff_work_log_id)
  WHERE staff_work_log_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cssi_hostess
  ON cross_store_settlement_items (hostess_membership_id)
  WHERE hostess_membership_id IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN cross_store_settlement_items.staff_work_log_id IS
  'Phase 4: 로그 → item 1:1 연결. NULL 이면 기존 manager 집계 라인.';
COMMENT ON COLUMN cross_store_settlement_items.hostess_membership_id IS
  'Phase 4: 아가씨 역참조. NULL 이면 집계 라인.';
