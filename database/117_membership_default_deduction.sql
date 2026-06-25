-- 117: store_memberships.default_manager_deduction
--
-- 식구별 "1타임당 실장수익" 기본값. 새 participation 생성 시 이 값이 자동 적용.
-- 범위: 0 ~ 10000 (0원 / 5천원 / 1만원 / 그 외 재량).
-- 실장이 스태프 상세 페이지에서 설정.

ALTER TABLE store_memberships
  ADD COLUMN IF NOT EXISTS default_manager_deduction INTEGER NOT NULL DEFAULT 0
    CHECK (default_manager_deduction >= 0 AND default_manager_deduction <= 100000);

COMMENT ON COLUMN store_memberships.default_manager_deduction IS
  '1타임당 실장이 가져갈 금액(원) — 0~1만원 권장, 새 session_participant 의 manager_payout_amount 기본값.';
