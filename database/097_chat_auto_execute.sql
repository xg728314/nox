-- 097_chat_auto_execute.sql — 채팅 자동 실행 매장 설정
-- default false · 사용자가 매장 설정에서 명시적 ON 해야 실행됨

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS chat_auto_execute BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN store_settings.chat_auto_execute IS
  '채팅 톡의 연장/끝 이벤트 자동 실행 여부 (R-chat-auto-execute · 2026-09-04)';
