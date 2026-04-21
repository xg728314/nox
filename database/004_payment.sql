-- ============================================================
-- 결제 방식 (Payment Method) 확장
-- receipts 테이블에 결제 정보 컬럼 추가
-- store_settings 테이블에 카드수수료율 추가
-- ============================================================

-- 1. receipts: 결제 방식 + 금액 분배 + 카드수수료
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS payment_method TEXT;
  -- 'cash' | 'card' | 'credit' | 'mixed'

ALTER TABLE receipts ADD COLUMN IF NOT EXISTS cash_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS card_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS credit_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS card_fee_rate NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS card_fee_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS manager_card_margin INTEGER NOT NULL DEFAULT 0;
  -- 실장 추가마진 (카드결제 시)

-- 외상 연결
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS credit_id UUID REFERENCES credits(id);

-- 2. store_settings: 매장별 카드수수료율
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS card_fee_rate NUMERIC NOT NULL DEFAULT 0.05;
  -- 기본 5%
