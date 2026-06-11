-- ============================================================
-- 112. chat 테이블에 deleted_at 컬럼 추가 (trigger compat)
-- ============================================================
-- 2026-06-12 R-chat-trigger-fix:
--   production DB 의 chat_messages INSERT trigger 가 deleted_at 컬럼을
--   참조하는데, chat_participants / chat_rooms 에 해당 컬럼이 없어서
--   42703 (column "deleted_at" does not exist) 에러로 메시지 전송 실패.
--
--   해당 trigger 가 어느 migration 으로 추가됐는지 local 에 추적 없음
--   (Supabase 대시보드에서 직접 추가됐을 가능성). trigger 정의 수정 대신
--   안전한 방법 — 두 테이블에 deleted_at 컬럼만 추가하여 trigger 가
--   참조해도 통과하게 한다. soft-delete 시멘틱 도 일치 (NULL = active).
--
-- 향후
--   - chat_participants 는 기존에 left_at 으로 soft-delete 표현. deleted_at 은
--     hard-delete 마커 또는 admin force-remove 용으로 활용 가능.
--   - chat_rooms 는 closed_at 으로 종료 표현. deleted_at 은 별도 archive 용도.
--
-- 적용
--   Supabase 대시보드 SQL 에디터에서 1회 실행.
-- ============================================================

ALTER TABLE chat_participants
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE chat_rooms
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- chat_messages 는 이미 005 에서 deleted_at 컬럼 있음. 안전 검증.
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 인덱스 — active row 빠른 조회 (옵션)
CREATE INDEX IF NOT EXISTS idx_chat_participants_active
  ON chat_participants(chat_room_id)
  WHERE deleted_at IS NULL AND left_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_chat_rooms_active
  ON chat_rooms(store_uuid)
  WHERE deleted_at IS NULL AND is_active = true;
