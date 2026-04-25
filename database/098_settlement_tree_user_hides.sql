-- 098_settlement_tree_user_hides.sql
-- R29 (2026-04-26): 정산 트리 매장 숨김 — 사용자(실장) 시점만.
--
-- 정책:
--   "내역삭제" 버튼은 본인 시점에서만 매장을 숨김. 다른 실장은 그대로 봄.
--   글로벌 삭제는 cron 의 stage 3 만료 (3일 경과) → cross_store_settlements.deleted_at.
--
-- 모델:
--   PK = (user_id, counterpart_store_uuid). 한 사용자가 같은 매장 두 번 숨김 시 hidden_at 갱신.
--   매장 스코프 보호 — store_uuid 도 함께 저장 (사용자가 매장 옮겨다닐 때 분리).
--
-- 자동 정리:
--   cross_store_settlements 에 해당 counterpart 의 active row 가 0 이 되면
--   이 hide row 도 무의미. 그러나 정리 cron 은 별도 라운드 — 일단 누적 허용.
--   100K row 까지는 무해 (성능 영향 무).

CREATE TABLE IF NOT EXISTS settlement_tree_user_hides (
  user_id                 uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  store_uuid              uuid NOT NULL,
  counterpart_store_uuid  uuid NOT NULL,
  hidden_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, store_uuid, counterpart_store_uuid)
);

CREATE INDEX IF NOT EXISTS idx_settlement_tree_hides_user_store
  ON settlement_tree_user_hides (user_id, store_uuid);

-- RLS — service-role 만. 일반 user JWT 차단.
ALTER TABLE settlement_tree_user_hides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hide_service_only ON settlement_tree_user_hides;
CREATE POLICY hide_service_only ON settlement_tree_user_hides
  FOR ALL TO public USING (false) WITH CHECK (false);

COMMENT ON TABLE settlement_tree_user_hides IS
  'R29: 정산 트리에서 사용자(실장)별 매장 숨김 목록. 글로벌 삭제 X.';

DO $$ BEGIN RAISE NOTICE '✓ migration 098 적용. settlement_tree_user_hides 생성.'; END $$;
