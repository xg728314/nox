-- 011: session_participants에 차3/반티 금액 컬럼 추가
-- 차3 = 30,000원 고정, 반티 = 종목 단가의 절반, 완티(기본) = 종목 단가
-- price_amount는 기존과 동일 (resolvedTimeType 기준 조회 결과)
-- cha3_amount, banti_amount는 해당 참여자의 종목 기준 고정 참조값

ALTER TABLE session_participants
  ADD COLUMN IF NOT EXISTS cha3_amount   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS banti_amount  INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN session_participants.cha3_amount  IS '차3 단가 (종목 무관 30,000원 고정)';
COMMENT ON COLUMN session_participants.banti_amount IS '반티 단가 (종목별 기본 단가의 절반)';

-- 기존 데이터 백필: 종목별 기본 단가 기준으로 banti_amount 계산
-- 차3은 항상 30,000원
UPDATE session_participants sp
SET
  cha3_amount  = 30000,
  banti_amount = COALESCE(
    (SELECT sst.price / 2
     FROM store_service_types sst
     WHERE sst.store_uuid    = sp.store_uuid
       AND sst.service_type  = sp.category
       AND sst.time_type     = '기본'
       AND sst.is_active     = true
     LIMIT 1),
    0
  )
WHERE sp.deleted_at IS NULL;
