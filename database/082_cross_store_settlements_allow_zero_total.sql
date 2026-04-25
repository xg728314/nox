-- ============================================================
-- 082_cross_store_settlements_allow_zero_total.sql
--
-- 목적:
--   cross_store_settlements.chk_css_total_pos 를 제거하고 >= 0 CHECK 로 대체.
--   aggregate route 가 "header 먼저 (total=0) 생성 → items insert → 총액 UPDATE"
--   패턴을 사용하므로 `> 0` 은 첫 INSERT 에서 항상 위반 → HEADER_INSERT_FAILED.
--
-- 배경:
--   `chk_css_total_pos` 원 의도는 "음수 금지" 였을 가능성이 큼 (헤더 금액
--   이상치 차단). aggregate 의 "빈 헤더 먼저 만들고 items 합계로 UPDATE"
--   CQRS 패턴과 충돌. >= 0 은 음수 차단을 유지하면서 workflow 허용.
--
-- 원칙:
--   - 제약 1개만 교체. 다른 CHECK (paid_nonneg, remaining_nonneg, status,
--     not_self) 전부 유지.
--   - 데이터 / route / 계산 로직 무변경.
--
-- 멱등: IF EXISTS + IF NOT EXISTS 가드.
-- ============================================================

ALTER TABLE public.cross_store_settlements
  DROP CONSTRAINT IF EXISTS chk_css_total_pos;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_css_total_nonneg'
  ) THEN
    ALTER TABLE public.cross_store_settlements
      ADD CONSTRAINT chk_css_total_nonneg
      CHECK (total_amount >= 0);
  END IF;
END $$;
