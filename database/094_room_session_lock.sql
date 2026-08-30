-- R-room-lock (2026-08-31): 방(세션) 잠금 기능.
-- 같은 매장 실장이 다른 실장 방을 실수로 수정하는 사고 방지.
-- 잠근 사람만 (그리고 owner/super_admin) 조작 가능.
--
-- 잠금 대상: room_sessions (active 세션 단위)
--   - session 종료 시 자동 해제 (row 자체가 closed 되어 lock 무의미)
--   - 별도 rooms 컬럼이 아닌 이유: 빈 방을 lock 할 이유 없음.
--
-- Guard: lib/session/lockGuard.ts
-- Toggle: POST /api/sessions/[session_id]/lock

ALTER TABLE room_sessions
  ADD COLUMN IF NOT EXISTS locked_by_membership_id UUID REFERENCES store_memberships(id),
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

-- 조회 편의 index — lock 확인 시 매장 단위 스캔 방지 (locked_by 있을 때만 hit).
CREATE INDEX IF NOT EXISTS idx_room_sessions_locked_by
  ON room_sessions (store_uuid, locked_by_membership_id)
  WHERE locked_by_membership_id IS NOT NULL;

COMMENT ON COLUMN room_sessions.locked_by_membership_id IS
  'R-room-lock: 이 세션에 대한 편집 잠금 소유자 (같은 매장 실장 사고 방지).';
COMMENT ON COLUMN room_sessions.locked_at IS
  'R-room-lock: 잠금 설정 시각.';
