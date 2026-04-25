-- ============================================================
-- 081_manager_prepayments_allow_intra.sql
--
-- 목적:
--   `manager_prepayments` 의 cross-store 전용 CHECK 제약을 제거하여
--   같은 매장(intra-store) 실장 선지급도 저장 가능하게 한다.
--
-- 배경:
--   043_manager_prepayments.sql 은 `chk_manager_prepayments_cross_store`
--   (store_uuid <> target_store_uuid) 제약을 하드코딩했다. 그러나 이후
--   운영 요구상 같은 매장 실장 선지급도 필요해졌고, route 는 intra-store
--   경로를 이미 허용하도록 작성되어 있었다 (app/api/payouts/manager-prepayment).
--   route 의도 vs DB 제약이 충돌하여 intra-store INSERT 가 23514 로 실패.
--
-- 원칙:
--   - CHECK 제약 1개만 DROP. 다른 스키마 / 인덱스 / 다른 CHECK 전부 유지.
--   - amount > 0, status enum, FK 전부 불변.
--   - route 코드 수정하지 않음.
--   - settlement / payout 계산 로직 불변.
--
-- 멱등: IF EXISTS 로 가드.
-- ============================================================

ALTER TABLE public.manager_prepayments
  DROP CONSTRAINT IF EXISTS chk_manager_prepayments_cross_store;
