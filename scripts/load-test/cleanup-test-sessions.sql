-- scripts/load-test/cleanup-test-sessions.sql
-- 2026-04-25: k6 쓰기 부하 테스트 이후 생성된 테스트 세션을 archive 처리.
--
-- 사용법:
--   1. preview / staging Supabase SQL Editor 에서 실행.
--   2. :test_room_uuid 와 :test_window_start 를 실제 값으로 교체.
--   3. 결과 건수 확인 후 COMMIT 또는 ROLLBACK.
--
-- 원칙: hard DELETE 아님. archived_at 만 찍어서 운영 UI 에서 숨김.
--   DB 에는 부하 테스트 흔적이 남지만 세법/분쟁용이 아니므로 추후
--   owner 판단에 따라 30일 이후 별도 purge 스크립트로 영구 삭제 가능.

BEGIN;

-- 대상: 특정 방에서 최근 N분 동안 생성된 세션 전부.
WITH target_sessions AS (
  SELECT id, store_uuid
  FROM room_sessions
  WHERE room_uuid = :'test_room_uuid'
    AND started_at >= :'test_window_start'::timestamptz
    AND archived_at IS NULL
)
SELECT count(*) AS will_archive_sessions FROM target_sessions;

-- 세션이 너무 많이 잡히면 ROLLBACK 후 조건 강화 필수.

-- 일괄 archive
WITH target_sessions AS (
  SELECT id, store_uuid
  FROM room_sessions
  WHERE room_uuid = :'test_room_uuid'
    AND started_at >= :'test_window_start'::timestamptz
    AND archived_at IS NULL
)
UPDATE room_sessions rs
   SET archived_at = now()
  FROM target_sessions t
 WHERE rs.id = t.id;

-- 관련 row 동반 archive
WITH target_sessions AS (
  SELECT id FROM room_sessions
  WHERE archived_at >= now() - interval '1 minute'
)
UPDATE session_participants sp
   SET archived_at = now()
  FROM target_sessions t
 WHERE sp.session_id = t.id AND sp.archived_at IS NULL;

WITH target_sessions AS (
  SELECT id FROM room_sessions
  WHERE archived_at >= now() - interval '1 minute'
)
UPDATE orders o
   SET archived_at = now()
  FROM target_sessions t
 WHERE o.session_id = t.id AND o.archived_at IS NULL;

WITH target_sessions AS (
  SELECT id FROM room_sessions
  WHERE archived_at >= now() - interval '1 minute'
)
UPDATE receipts r
   SET archived_at = now()
  FROM target_sessions t
 WHERE r.session_id = t.id AND r.archived_at IS NULL;

-- 결과 확인
SELECT
  (SELECT count(*) FROM room_sessions WHERE archived_at >= now() - interval '1 minute') AS archived_sessions,
  (SELECT count(*) FROM session_participants WHERE archived_at >= now() - interval '1 minute') AS archived_participants,
  (SELECT count(*) FROM orders WHERE archived_at >= now() - interval '1 minute') AS archived_orders,
  (SELECT count(*) FROM receipts WHERE archived_at >= now() - interval '1 minute') AS archived_receipts;

-- 숫자 확인 후 COMMIT 또는 ROLLBACK 선택.
-- COMMIT;
-- ROLLBACK;
