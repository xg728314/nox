-- 102_finance_purchases_expenses.sql
-- R-Finance (2026-04-29): 사장 P&L / 손익분기점을 위한 매입/지출 ledger.
--
-- 설계:
--   store_purchases  — 박스 단위 매입 (양주/소주/맥주/와인/과일/기타)
--   store_expenses   — 일반 지출 (월세/공과금/과일/급여/잡비)
--
--   사장 고정지출 (월세/공과금/잡비) 는 이미 store_settings 의
--   monthly_rent / monthly_utilities / monthly_misc 컬럼에 존재.
--   본 마이그레이션은 일별 변동 매입/지출 만 담당.
--
-- 회계 정책 (v1):
--   - 발생주의: 매입 시점에 비용 인식 (store_purchases.total_won 합).
--   - orders.unit_price × qty 는 PnL 변동비 계산에 사용 X (이중 계산 회피).
--   - 매입과 판매 시점 차이로 월별 비용이 출렁일 수 있음. 정확한 매출원가
--     주의는 별도 라운드 (재고 ↔ 매입 연결).
--
-- 권한:
--   - RLS 활성 + service-only 정책. app 측 owner-only API 가드.
--   - paper_ledger_access_grants 와 동일 패턴 (R-Auth).

-- ─── 1. 박스 단위 매입 ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS store_purchases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_uuid      uuid NOT NULL REFERENCES stores(id),
  business_day_id uuid REFERENCES store_operating_days(id),  -- 영업일 닫혔어도 입력 가능
  business_date   date NOT NULL,
  /* 분류 */
  category        text NOT NULL CHECK (category IN ('liquor','soju','beer','wine','fruit','other')),
  item_name       text NOT NULL,                  -- 예: "발렌타인 17년 1박스 (12병)"
  /* 단가 + 수량 */
  unit_price_won  bigint NOT NULL,                -- 박스당
  qty             int NOT NULL DEFAULT 1,
  total_won       bigint NOT NULL,                -- = unit_price_won × qty (앱이 계산)
  /* 메타 */
  vendor          text,                           -- 매입처
  receipt_url     text,                           -- 영수증 사진 (Storage)
  memo            text,
  inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  /* 흐름 제어 */
  status          text NOT NULL DEFAULT 'approved'
    CHECK (status IN ('pending','approved','rejected')),
  created_by      uuid NOT NULL REFERENCES profiles(id),
  approved_by     uuid REFERENCES profiles(id),
  approved_at     timestamptz,
  /* lifecycle */
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_purchases_store_date
  ON store_purchases (store_uuid, business_date DESC)
  WHERE deleted_at IS NULL AND status = 'approved';

CREATE INDEX IF NOT EXISTS idx_purchases_category
  ON store_purchases (store_uuid, category, business_date DESC)
  WHERE deleted_at IS NULL AND status = 'approved';

ALTER TABLE store_purchases ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'store_purchases_service_only') THEN
    CREATE POLICY store_purchases_service_only ON store_purchases
      FOR ALL TO public USING (false) WITH CHECK (false);
  END IF;
END $$;

COMMENT ON TABLE store_purchases IS
  'R-Finance: 박스 단위 매입 (변동비). 발생주의로 PnL 변동비 합산. orders.unit_price 와 중복 계산 X.';

-- ─── 2. 일반 지출 ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS store_expenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_uuid      uuid NOT NULL REFERENCES stores(id),
  business_day_id uuid REFERENCES store_operating_days(id),
  business_date   date NOT NULL,
  /* 분류 */
  category        text NOT NULL CHECK (category IN ('utility','fruit','salary','tip','transport','rent_extra','other')),
  /* 금액 */
  amount_won      bigint NOT NULL,
  /* 메타 */
  description     text,
  receipt_url     text,
  memo            text,
  /* 흐름 제어 */
  status          text NOT NULL DEFAULT 'approved'
    CHECK (status IN ('pending','approved','rejected')),
  created_by      uuid NOT NULL REFERENCES profiles(id),
  approved_by     uuid REFERENCES profiles(id),
  approved_at     timestamptz,
  /* lifecycle */
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_expenses_store_date
  ON store_expenses (store_uuid, business_date DESC)
  WHERE deleted_at IS NULL AND status = 'approved';

CREATE INDEX IF NOT EXISTS idx_expenses_category
  ON store_expenses (store_uuid, category, business_date DESC)
  WHERE deleted_at IS NULL AND status = 'approved';

ALTER TABLE store_expenses ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'store_expenses_service_only') THEN
    CREATE POLICY store_expenses_service_only ON store_expenses
      FOR ALL TO public USING (false) WITH CHECK (false);
  END IF;
END $$;

COMMENT ON TABLE store_expenses IS
  'R-Finance: 일반 일별 지출 (변동비). 월세 등 고정비는 store_settings.monthly_* 사용.';
