-- ============================================================
-- 075_cross_store_work_record_settlement_items.sql
--
-- 목적:
--   cross_store_settlement_items 가 cross_store_work_records(id) 를 직접
--   참조할 수 있도록 신규 컬럼 + 파셜 UNIQUE 인덱스를 추가한다. 기존 060
--   에서 만든 `staff_work_log_id` 컬럼은 **남겨둔다** — legacy row 가 살아
--   있고 FK 대상 테이블(staff_work_logs) 부재로 drop 경로가 복잡하다.
--   본 라운드는 nullable legacy 컬럼으로 취급하며 신규 aggregate 는
--   cross_store_work_record_id 만 채운다.
--
-- 수정 원칙:
--   - staff_work_logs 재생성 금지.
--   - cross_store_work_records 에 manager_membership_id / category /
--     work_type 추가 금지.
--   - 기존 레거시 데이터 강제 삭제 금지.
--   - partial index 는 `deleted_at IS NULL` 조건.
--
-- 컬럼 추가:
--   cross_store_settlement_items.cross_store_work_record_id
--     UUID REFERENCES cross_store_work_records(id)
--     nullable. 기존 manager 집계 라인과 staff_work_log_id legacy 라인은
--     NULL. 신규 aggregate 생성 item 은 NOT NULL 로 채워짐.
--
-- 인덱스:
--   uq_cssi_cross_store_work_record    partial UNIQUE — idempotency 기반
--   idx_cssi_cross_store_work_record   역조회
--
-- 멱등: ALTER TABLE ADD COLUMN IF NOT EXISTS / CREATE ... IF NOT EXISTS
-- ============================================================

-- 1) 컬럼 추가
ALTER TABLE cross_store_settlement_items
  ADD COLUMN IF NOT EXISTS cross_store_work_record_id UUID;

-- 2) FK 추가 (중복 생성 방지를 위해 존재 체크)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'cssi_cswr_fk'
  ) THEN
    ALTER TABLE cross_store_settlement_items
      ADD CONSTRAINT cssi_cswr_fk
      FOREIGN KEY (cross_store_work_record_id)
      REFERENCES cross_store_work_records(id);
  END IF;
END $$;

-- 3) 파셜 UNIQUE — 근무기록 1건당 아이템 1건 (soft-delete 제외)
CREATE UNIQUE INDEX IF NOT EXISTS uq_cssi_cross_store_work_record
  ON cross_store_settlement_items (cross_store_work_record_id)
  WHERE cross_store_work_record_id IS NOT NULL AND deleted_at IS NULL;

-- 4) 역조회 인덱스
CREATE INDEX IF NOT EXISTS idx_cssi_cross_store_work_record
  ON cross_store_settlement_items (cross_store_work_record_id)
  WHERE cross_store_work_record_id IS NOT NULL AND deleted_at IS NULL;

-- 5) 주석
COMMENT ON COLUMN cross_store_settlement_items.cross_store_work_record_id IS
  'Phase 9 (2026-04-24): cross_store_work_records(id) 역참조. 신규 aggregate 가 생성한 item 은 NOT NULL. 기존 manager 집계 라인 / legacy staff_work_log_id 라인은 NULL.';

-- staff_work_log_id 는 본 migration 에서 drop 하지 않는다. 레거시 관찰용.
-- 향후 라운드에서 traffic 확인 후 별도 migration 으로 drop 고려.
