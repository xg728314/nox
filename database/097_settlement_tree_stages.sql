-- 097_settlement_tree_stages.sql
-- R29 (2026-04-26): 정산 트리 3단계 자동 보관/삭제 모델.
--
-- 사용자 정책:
--   Stage 1 (보관 1일): 생성 직후. 다음날 17:00 KST 까지.
--   Stage 2 (보관 2일): Stage 1 에서 자동 이동. 17:00 KST 기준 2일 보관.
--   Stage 3 (보관 3일): Stage 2 에서 자동 이동. 17:00 KST 기준 3일 보관.
--   - 종료: Stage 3 에서 3일 경과 → soft delete.
--   - 정산 완료(remaining_amount=0) 항목 → 즉시 soft delete (단계 무관).
--
-- 진행 cron: /api/cron/settlement-tree-advance — 매일 17:00 KST (08:00 UTC).
-- 기존 m096 의 confirmed_at 컬럼은 그대로 둠 (수동 완료 처리는 호환 유지).

ALTER TABLE cross_store_settlements
  ADD COLUMN IF NOT EXISTS tree_stage smallint NOT NULL DEFAULT 1
    CHECK (tree_stage IN (1, 2, 3));

ALTER TABLE cross_store_settlements
  ADD COLUMN IF NOT EXISTS stage_advanced_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE cross_store_settlement_items
  ADD COLUMN IF NOT EXISTS tree_stage smallint NOT NULL DEFAULT 1
    CHECK (tree_stage IN (1, 2, 3));

ALTER TABLE cross_store_settlement_items
  ADD COLUMN IF NOT EXISTS stage_advanced_at timestamptz NOT NULL DEFAULT now();

-- m096 의 partial index 는 confirmed_at 기반 → 새 stage 모델에 맞게 교체.
DROP INDEX IF EXISTS idx_cross_store_settlements_active;

CREATE INDEX IF NOT EXISTS idx_cross_store_settlements_stage
  ON cross_store_settlements (store_uuid, tree_stage)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cross_store_settlements_advance
  ON cross_store_settlements (tree_stage, stage_advanced_at)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN cross_store_settlements.tree_stage IS
  'R29: 정산 트리 단계 (1=오늘, 2=이틀보관, 3=삼일보관). cron 이 매일 17:00 KST 에 진행.';
COMMENT ON COLUMN cross_store_settlements.stage_advanced_at IS
  'R29: 현재 단계로 진입한 시각. cron 의 다음 단계 진행 기준.';

DO $$ BEGIN RAISE NOTICE '✓ migration 097 적용. tree_stage 컬럼 추가.'; END $$;
