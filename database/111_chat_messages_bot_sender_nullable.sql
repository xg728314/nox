-- 111_chat_messages_bot_sender_nullable.sql
--
-- R37 (2026-09-09): 봇 답장(message_type='bot_reply') sender_membership_id NULL 허용.
--
-- 배경: R36/R37 봇 인프라 발송 시 sender_membership_id=NULL 로 삽입 → NOT NULL 위반.
--       봇은 특정 membership 소속이 아니라 시스템 자체.
--
-- 안전: 사람 메시지의 필수 여부는 여전히 앱 레이어 validateMessageInput 에서 강제.
--       DB 레벨은 nullable 로 완화.
--
-- 되돌리기: ALTER TABLE chat_messages ALTER COLUMN sender_membership_id SET NOT NULL;
--   (그 전에 message_type='bot_reply' 행 확인 · 필요 시 삭제)

ALTER TABLE chat_messages
  ALTER COLUMN sender_membership_id DROP NOT NULL;

COMMENT ON COLUMN chat_messages.sender_membership_id IS
  'R37: 봇 답장(message_type=bot_reply)은 sender_membership_id NULL. 사람 메시지는 여전히 앱에서 필수.';
