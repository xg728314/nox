-- 093_session_race_prevention.sql
-- R28-fix (2026-04-26): 체크인 race condition 차단 + 사장 정산 노출 가드.
--
-- 문제 (hidden audit agent 발견):
--   sessions/checkin/route.ts 가 SELECT (active 세션 존재 여부) → INSERT 패턴.
--   두 카운터 PC 가 동시에 같은 방 체크인 시 둘 다 SELECT 통과 → 두 active
--   세션 생성. application 레벨 conflict guard 만으론 race 차단 불가.
--
-- 해결: room_sessions(room_uuid) WHERE status='active' AND archived_at IS NULL
--   partial unique index. DB 가 하드 보장.

-- 같은 방에 active 세션 1개만. archive 된 행은 unique 검사 제외 (정상 흐름).
CREATE UNIQUE INDEX IF NOT EXISTS uq_room_active_session
  ON room_sessions (room_uuid)
  WHERE status = 'active' AND archived_at IS NULL;

COMMENT ON INDEX uq_room_active_session IS
  'R28-fix: 같은 방 동시 체크인 race 차단. 두 INSERT 동시 시 한쪽만 성공 → 23505 unique_violation.';

-- 클라이언트는 23505 를 SESSION_CONFLICT 로 변환해서 사용자에게 동일 메시지 표시 가능.
