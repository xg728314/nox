-- 116: store_memberships.payout_method
--
-- 식구별 지급 방식 — 계좌 송금(account) / 현금(cash).
-- 실장이 스태프 상세 페이지에서 선택. 정산 finalize 시 참고용.
-- 기본값 'cash' — 다수 식구가 현금 수령 선호.

ALTER TABLE store_memberships
  ADD COLUMN IF NOT EXISTS payout_method TEXT NOT NULL DEFAULT 'cash'
    CHECK (payout_method IN ('account', 'cash'));

COMMENT ON COLUMN store_memberships.payout_method IS
  '지급 방식 — account(계좌) / cash(현금). 기본 cash.';
