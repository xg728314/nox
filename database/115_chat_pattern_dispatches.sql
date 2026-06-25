-- 2026-06-25 R-chat-pattern-mutual-confirm
--
-- 채팅 메시지 자동 인식 → 임시 등록 + 다자간 교차 확인 시스템.
--
-- 흐름:
--   1. 발신자가 "버 지수 신 지연 파 은비 하 완메" 같은 메시지 전송
--   2. parseStaffChat 으로 entries 추출 (target_store + hostess + cat + time × N)
--   3. 발신자가 "✓ 확인" 클릭 → 각 entry 마다 chat_pattern_dispatches row INSERT
--      (status='pending', target_confirmed_by=null)
--   4. 메시지 카드에 "임시 등록 — N개 매장 확인 대기 (0/N)" 표시
--   5. 각 target store 의 매니저가 자기 entry 의 "확인" 클릭 →
--      target_confirmed_by/at 채움 → 카운트 증가
--   6. 같은 chat_message_id 의 모든 dispatch 가 target_confirmed 채워지면
--      → status='approved' 일괄 변경 + 실제 dispatch 실행 (server-side)
--
-- 적용: Supabase Studio SQL Editor 에 본 파일 내용 붙여넣기 + Run.
-- 멱등: IF NOT EXISTS — 재실행 안전.

CREATE TABLE IF NOT EXISTS chat_pattern_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  chat_room_id UUID NOT NULL REFERENCES chat_rooms(id),

  -- 대상 정보
  target_store_uuid UUID NOT NULL REFERENCES stores(id),
  hostess_membership_id UUID NOT NULL REFERENCES store_memberships(id),
  category TEXT NOT NULL,
  time_type TEXT NOT NULL,

  -- 발신자 (즉시 자동 sender_confirmed)
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 수신측 매니저 확인
  target_confirmed_by UUID REFERENCES auth.users(id),
  target_confirmed_at TIMESTAMPTZ,

  -- 상태
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  rejected_reason TEXT,

  -- 실제 실행 결과 (status='approved' 시 채움)
  executed_session_id UUID REFERENCES room_sessions(id),
  executed_participant_id UUID REFERENCES session_participants(id),
  executed_at TIMESTAMPTZ,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_chat_pattern_dispatches_message
  ON chat_pattern_dispatches(chat_message_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_pattern_dispatches_target_pending
  ON chat_pattern_dispatches(target_store_uuid, status)
  WHERE status = 'pending' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_pattern_dispatches_room_pending
  ON chat_pattern_dispatches(chat_room_id, status)
  WHERE status = 'pending' AND deleted_at IS NULL;

COMMENT ON TABLE chat_pattern_dispatches IS
  '채팅 패턴 인식 → 임시 등록 + 다자간 확인. 발신자 + 수신측 매니저 양쪽 확인 후 dispatch 실행.';
