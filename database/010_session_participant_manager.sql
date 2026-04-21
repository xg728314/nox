-- migration: 010_session_participant_manager.sql
-- session_participants에 세션 단위 담당실장 컬럼 추가

ALTER TABLE session_participants
  ADD COLUMN manager_membership_id UUID REFERENCES store_memberships(id);

-- 인덱스: 실장별 세션 참여자 조회용
CREATE INDEX idx_session_participants_manager
  ON session_participants(manager_membership_id)
  WHERE manager_membership_id IS NOT NULL;

COMMENT ON COLUMN session_participants.manager_membership_id IS
  '이 세션에서 이 참여자를 담당하는 실장의 membership_id. NULL이면 hostesses.manager_membership_id fallback.';
