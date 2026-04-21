-- 013: Add exit_type to session_participants
-- Distinguishes between 'kicked' (< 12min, not counted in settlement)
-- and 'left' (≥ 12min, counted in settlement)
-- NULL means participant is still active or exited before this migration.

ALTER TABLE session_participants
  ADD COLUMN IF NOT EXISTS exit_type TEXT;

COMMENT ON COLUMN session_participants.exit_type IS
  'kicked = 팅김 (< 12분, 정산 미반영), left = 퇴실 (≥ 12분, 정산 반영)';
