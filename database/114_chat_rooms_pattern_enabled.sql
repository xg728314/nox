-- 2026-06-25 R-chat-pattern-toggle
--
-- 운영자가 지정한 채팅방에서만 메이드 패턴 자동 인식 활성화.
--   기본 false — 채팅에 \"택헌 희주 버닝 퍼 완메\" 메시지 와도 \"확인\" 버튼 안 뜸.
--   true 인 채팅방에서만 ChatPatternAction 컴포넌트 렌더링 + 액션 가능.
--
-- 적용:
--   Supabase Studio → SQL Editor 에 본 파일 내용 붙여넣기 + Run.
--
-- 멱등: IF NOT EXISTS — 재실행 안전.

ALTER TABLE chat_rooms
  ADD COLUMN IF NOT EXISTS pattern_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN chat_rooms.pattern_enabled IS
  '운영자가 지정한 채팅방에서만 메이드 패턴 자동 인식 활성화 (true 면 ChatPatternAction 렌더). 기본 false.';
