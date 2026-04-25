-- 096_settlement_tree_confirmation.sql
-- R29 (2026-04-26): 정산 트리 "정산 완료 → 48시간 뒤 자동 리셋".
--
-- 사용자 시나리오:
--   1. 운영자가 정산 트리에서 받을돈/줄돈 확인 + 지급 처리
--   2. 모든 처리가 끝나면 "정산 완료 처리" 버튼 클릭 → confirmed_at = now()
--   3. UI 는 "✓ 정산 완료 (X시간 후 자동 리셋)" 표시
--   4. 48시간 뒤 → tree 에서 자동 제외 (다음 정산 사이클로 이동)
--
-- 구현:
--   confirmed_at timestamptz 컬럼 추가. NULL = 진행 중, NOT NULL = 완료 후 X시간.
--   /api/reports/settlement-tree* 가 confirmed_at IS NULL OR confirmed_at > now() - 48h 만 반환.
-- 096_settlement_tree_confirmation.sql
ALTER TABLE cross_store_settlements
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

ALTER TABLE cross_store_settlement_items
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_cross_store_settlements_confirmed_open
  ON cross_store_settlements (confirmed_at)
  WHERE deleted_at IS NULL
    AND confirmed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cross_store_settlement_items_confirmed_at
  ON cross_store_settlement_items (confirmed_at);

COMMENT ON COLUMN cross_store_settlements.confirmed_at IS
  'R29: 정산 완료 시각. NULL=진행중. now()-48h 이전이면 트리에서 자동 제외.';

COMMENT ON COLUMN cross_store_settlement_items.confirmed_at IS
  'R29: 정산 완료 시각. NULL=진행중. now()-48h 이전이면 트리에서 자동 제외.';

DO $$
BEGIN
  RAISE NOTICE '✓ migration 096 적용. settlement confirmed_at 컬럼 추가.';
END $$;