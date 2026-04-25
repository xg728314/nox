-- 083_floor_no_check.sql
-- 2026-04-24 P1 fix: floor_no 가 건물 유효 범위(5~8) 밖 값으로 저장되는 것을 막음.
--   이전에는 rooms.floor_no / stores.floor 에 CHECK 제약이 없어서
--   migration 실수 or 직접 INSERT 로 floor=99 같은 값이 들어갈 수 있었다.
--   scopeResolver 는 5~8 정규식만 파싱하므로 이상값이 있으면 모니터/리포트
--   에서 무시되고 데이터 유령 상태가 됨.
--
-- 적용 대상: rooms.floor_no
--   - stores 테이블의 floor 컬럼명/범위는 별도 마이그레이션에서 조정 (존재 여부
--     확인 후 추가).
--
-- 롤백: DROP CONSTRAINT rooms_floor_no_range_chk;
--
-- 주의: 기존 데이터에 위반 값이 있으면 ADD CONSTRAINT 가 실패한다. 실패 시
--   SELECT floor_no, COUNT(*) FROM rooms WHERE floor_no NOT BETWEEN 5 AND 8
--     AND deleted_at IS NULL GROUP BY 1;
--   로 확인 후 데이터 정정 선행.

BEGIN;

-- 선행 점검: 위반 건 표시 (있으면 migration 중단 후 수동 조치)
DO $$
DECLARE
  bad_count int;
BEGIN
  SELECT count(*) INTO bad_count
  FROM rooms
  WHERE floor_no IS NOT NULL
    AND floor_no NOT BETWEEN 5 AND 8
    AND deleted_at IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'floor_no 범위 위반 레코드 %건. 먼저 정정 후 재실행.', bad_count;
  END IF;
END $$;

ALTER TABLE rooms
  ADD CONSTRAINT rooms_floor_no_range_chk
  CHECK (floor_no IS NULL OR floor_no BETWEEN 5 AND 8);

COMMIT;
