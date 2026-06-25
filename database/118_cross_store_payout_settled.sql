-- 118: session_participants.payout_settled_at / payout_settled_by
--
-- 타매장 식구 정산 완료 표시. working_store 의 실장이 origin_store 측에
-- 현금/계좌로 줄돈 (= hostess_payout_amount) 을 실제로 전달한 시점.
-- 그룹 단위 일괄 토글 — origin_store + origin_manager 그룹의 모든 row 를 한번에 stamp.
-- 토글 가능 (정산완료 ↔ 미정산) — 실수 시 되돌릴 수 있도록.

ALTER TABLE session_participants
  ADD COLUMN IF NOT EXISTS payout_settled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payout_settled_by UUID;

COMMENT ON COLUMN session_participants.payout_settled_at IS
  '타매장 식구 줄돈 정산 완료 시각. NULL = 미정산. 그룹 단위 토글.';
COMMENT ON COLUMN session_participants.payout_settled_by IS
  '정산완료 표시한 사용자 (auth.users.id) — working_store 실장.';

-- 그룹 조회 hot path 인덱스 (정산 안된 row 빠르게 찾기)
CREATE INDEX IF NOT EXISTS idx_session_participants_payout_unsettled
  ON session_participants (store_uuid, origin_store_uuid, payout_settled_at)
  WHERE deleted_at IS NULL AND origin_store_uuid IS NOT NULL;
