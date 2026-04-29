-- 103_finance_expenses_freeform_category.sql
-- R-Finance (2026-04-29 v2): store_expenses.category 자유 입력 허용.
--
-- 운영자 피드백:
--   "월세, 카드값 등 직접 등록하고싶은 거 등록할 수 있게 해줘"
--
-- 변경:
--   - store_expenses_category_check (enum 제약) 제거.
--   - 빈 문자열 만 차단 (NOT NULL + length>0 CHECK 추가).
--   - store_purchases 는 분류 자체가 inventory 통계 키 라서 enum 유지.
--
-- 마이그레이션 후 동작:
--   기존 7가지 (utility/fruit/salary/tip/transport/rent_extra/other) 데이터는
--   그대로 유효. 신규 row 는 임의의 한글/영문 문자열 허용.

ALTER TABLE store_expenses
  DROP CONSTRAINT IF EXISTS store_expenses_category_check;

-- 빈 문자열 차단 (length>0). NULL 은 NOT NULL 가 이미 차단.
ALTER TABLE store_expenses
  ADD CONSTRAINT store_expenses_category_nonempty
  CHECK (length(trim(category)) > 0);

COMMENT ON COLUMN store_expenses.category IS
  'R-Finance v2: 자유 입력 (월세/카드값/공과금/잡비 등). 빈 문자열만 차단.';
