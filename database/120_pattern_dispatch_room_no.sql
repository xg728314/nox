-- 120: chat_pattern_dispatches.room_no — 채팅 메시지의 "1번방" prefix 보존
--
-- parser 가 라인 시작 "1번방" 등을 인식해 dispatch 시 그 방의 active session
-- 으로 라우팅. 같은 방 식구는 한 session 으로 묶여 그룹 채팅도 자동 통합.
--
-- NULL = 방번호 미지정 (dispatch route 가 빈 방 자동 선택, 기존 동작).

ALTER TABLE chat_pattern_dispatches
  ADD COLUMN IF NOT EXISTS room_no TEXT;

COMMENT ON COLUMN chat_pattern_dispatches.room_no IS
  '채팅 메시지의 "1번방" prefix — 그 방의 active session 으로 dispatch 라우팅';
