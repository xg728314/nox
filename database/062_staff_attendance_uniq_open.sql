-- ============================================================
-- 062_staff_attendance_uniq_open.sql
--
-- ROUND-STAFF-3: staff_attendance 중복 출근 방지 UNIQUE partial index.
--
-- 목적:
--   수동 /api/attendance POST 와 BLE /api/cron/ble-attendance-sync 가
--   동시에 같은 (store_uuid, business_day_id, membership_id) 에 대해
--   checkin INSERT 를 시도할 때 race 로 중복 행이 생기는 것을 DB 레벨에서
--   차단한다. 이미 application-layer 에서 SELECT-then-INSERT 체크는
--   존재하지만, 동시 트랜잭션에서 경합이 발생할 수 있다.
--
-- 규약:
--   - 오직 "진행 중" 출근 (checked_out_at IS NULL) 에만 UNIQUE 제약.
--     checkout 된 행은 historical append 로 쌓일 수 있도록 제외.
--   - 같은 날 퇴근 후 재출근 케이스: 이전 행은 checked_out_at 이 NOT NULL
--     이므로 UNIQUE 범위 밖 → 새 행 INSERT 허용.
--
-- 안전성:
--   - schema 변경 없음 (컬럼 추가/변경 없음, index-only).
--   - 기존 데이터: "진행 중" 행이 이미 중복돼 있으면 index 생성이
--     실패한다. 프로덕션 배포 전 아래 진단 쿼리로 확인할 것.
--
-- 진단:
--   SELECT store_uuid, business_day_id, membership_id, count(*)
--   FROM staff_attendance
--   WHERE checked_out_at IS NULL
--   GROUP BY 1,2,3 HAVING count(*) > 1;
--   0건이어야 이 migration 적용 가능.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_attendance_open
  ON staff_attendance (store_uuid, business_day_id, membership_id)
  WHERE checked_out_at IS NULL;

COMMENT ON INDEX uq_staff_attendance_open IS
  'Open-attendance uniqueness: prevents double checkin from manual + BLE races (ROUND-STAFF-3).';
