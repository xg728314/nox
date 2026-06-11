-- ============================================================
-- 113. hostesses.origin_store_uuid 컬럼 추가
-- ============================================================
-- 2026-06-12 R-hostess-origin-fix:
--   production DB 의 hostesses 테이블에 origin_store_uuid 컬럼이 없어서
--   /api/manager/hostesses 가 500 ('column hostesses.origin_store_uuid
--   does not exist') 으로 실패. 모바일 앱 홈에서 "식구 목록을 불러올
--   수 없습니다" 빨간 에러로 표시됨.
--
--   해당 컬럼은 CLAUDE.md 의 Day 2.5 라운드부터 코드에서 사용 (cross-store
--   처리에 필수: 식구의 원소속 매장 = 정산 받는 매장) 하지만 ALTER TABLE
--   migration 이 적용 안 됨.
--
-- 적용 후 효과:
--   - /api/manager/hostesses 정상 (식구 목록 표시).
--   - cross-store 정산 정확성 (origin_store_uuid 기준 정산).
--
-- 기존 row 의 origin_store_uuid 는 NULL (= 원소속 = working store) 유지.
--   필요 시 별도 backfill 스크립트로 채울 수 있음.
-- ============================================================

ALTER TABLE hostesses
  ADD COLUMN IF NOT EXISTS origin_store_uuid UUID REFERENCES stores(id);

-- cross-store 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_hostesses_origin_store
  ON hostesses(origin_store_uuid)
  WHERE deleted_at IS NULL AND origin_store_uuid IS NOT NULL;
