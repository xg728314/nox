-- 096_room_service_calls.sql — 방 서비스 콜
-- 카톡의 "@담당실장 재떨이/담배/안주" 톡 대체
-- 실장이 방에서 콜 → 웨이터/카운터가 접수 → 완료

CREATE TABLE IF NOT EXISTS room_service_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES room_sessions(id),
  store_uuid UUID NOT NULL REFERENCES stores(id),
  room_uuid UUID REFERENCES rooms(id),  -- 방번호 표시 편의 (session 에서 lookup 가능하지만 index 용)

  -- 콜 스펙
  request_type TEXT NOT NULL,           -- 'menu'|'drink'|'smoke'|'temp'|'blanket'|'ashtray'|'mic'|'battery'|'water'|'other'
  detail TEXT,                          -- '딥브라운 1개', '짜파2 국물라면2 씬피자1', '온도 24도'

  -- 상태
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','in_progress','done','cancelled')),
  requested_by_membership_id UUID NOT NULL REFERENCES store_memberships(id),
  assigned_to_membership_id UUID REFERENCES store_memberships(id),
  progress_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_svc_active
  ON room_service_calls(store_uuid, status, created_at DESC)
  WHERE status IN ('requested', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_svc_session
  ON room_service_calls(session_id, created_at DESC);

ALTER TABLE room_service_calls ENABLE ROW LEVEL SECURITY;
