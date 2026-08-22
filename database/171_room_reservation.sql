-- ============================================================
-- 171_room_reservation
-- ============================================================
-- 방 예약 (R30-A · 2026-07-24)
--
-- 목적:
--   프로토타입 외부조판의 "이 방 내가 쓴다" 흐름. 실장이 아가씨 배정 전
--   빈방을 자기 몫으로 잡아둘 수 있음. 다른 실장이 같은 방에 체크인 못하도록
--   UI 에서 예약 표시.
--
-- 스키마 원칙:
--   - session_id 는 관여 안 함 (예약은 사전 단계, 체크인 시 예약 자동 해제)
--   - reserved_by_membership_id — FK (예약자 신원), NULL = 예약 없음
--   - reserved_at — 예약 시각. auto-expire (예: 30분) 은 앱/cron 처리 여지.
--   - reserved_by_name — 이름 스냅샷. JOIN 없이 화면 표시 (SSOT 는 profiles)
--
-- 안전:
--   - 기존 데이터 무변경 (컬럼 신규만).
--   - IF NOT EXISTS 로 재실행 안전.
-- ============================================================

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS reserved_by_membership_id UUID REFERENCES store_memberships(id),
  ADD COLUMN IF NOT EXISTS reserved_by_name TEXT,
  ADD COLUMN IF NOT EXISTS reserved_at TIMESTAMPTZ;

-- 예약된 방 빠른 조회 인덱스 (partial — 예약된 방만).
CREATE INDEX IF NOT EXISTS idx_rooms_reserved
  ON rooms (store_uuid, reserved_at DESC)
  WHERE reserved_by_membership_id IS NOT NULL AND deleted_at IS NULL;

-- 활성 세션이 있는 방은 예약될 수 없음 (application-level 강제, DB constraint
-- 은 room_sessions 상태 조인이 필요해서 트리거 없이 앱에서 처리).
COMMENT ON COLUMN rooms.reserved_by_membership_id IS 'R30-A: 방 예약자 (store_memberships.id). NULL = 미예약. 체크인 성공 시 앱에서 NULL 로 clear.';
COMMENT ON COLUMN rooms.reserved_by_name IS 'R30-A: 예약자 이름 스냅샷 (JOIN 없이 표시). SSOT = profiles.full_name.';
COMMENT ON COLUMN rooms.reserved_at IS 'R30-A: 예약 시각. auto-expire 정책은 앱에서.';
