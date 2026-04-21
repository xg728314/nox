-- 012: room_sessions에 담당 실장 컬럼 추가
-- 우리 가게 실장: manager_membership_id (FK), manager_name 함께 저장
-- 외부 실장: manager_membership_id NULL, manager_name만 저장, is_external_manager=true

ALTER TABLE room_sessions
  ADD COLUMN IF NOT EXISTS manager_membership_id UUID REFERENCES store_memberships(id),
  ADD COLUMN IF NOT EXISTS manager_name          TEXT,
  ADD COLUMN IF NOT EXISTS is_external_manager   BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN room_sessions.manager_membership_id IS '담당 실장 멤버십 ID (우리 가게 실장일 때)';
COMMENT ON COLUMN room_sessions.manager_name          IS '담당 실장 이름 (표시용, 외부 실장일 때 직접 입력)';
COMMENT ON COLUMN room_sessions.is_external_manager   IS '외부 실장 여부 (true면 manager_membership_id NULL)';
