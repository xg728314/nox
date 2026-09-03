-- 095_waitlist_requests.sql — 매장 대기 board
-- 카톡 도배 원인 제거 · 매장별 대기 요청 + 매장 간 열람 + 매칭

CREATE TABLE IF NOT EXISTS waitlist_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_uuid UUID NOT NULL REFERENCES stores(id),
  author_membership_id UUID NOT NULL REFERENCES store_memberships(id),

  -- 요청 스펙
  category TEXT NOT NULL,                    -- '퍼블릭' | '하퍼' | '셔츠' | 'any'
  party_size INT NOT NULL CHECK (party_size BETWEEN 1 AND 30),
  room_count INT NOT NULL DEFAULT 1 CHECK (room_count BETWEEN 1 AND 10),
  is_new_room BOOL NOT NULL DEFAULT true,    -- 새방 or 체인지
  seen_policy TEXT NOT NULL DEFAULT 'any',   -- 'unseen_only' | 'any'
  tags TEXT[] NOT NULL DEFAULT '{}',         -- ['착함','장타','노터치','일본어','매너']
  note TEXT,                                 -- 자유 메모

  -- 상태
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','matched','cancelled','expired')),
  matched_at TIMESTAMPTZ,
  matched_by_membership_id UUID REFERENCES store_memberships(id),
  matched_target_store_uuid UUID REFERENCES stores(id),  -- 어느 매장에서 매칭됐는지

  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_active
  ON waitlist_requests(store_uuid, status, expires_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_waitlist_created
  ON waitlist_requests(created_at DESC);

-- RLS: service role 만 (앱 route 는 service key 사용)
ALTER TABLE waitlist_requests ENABLE ROW LEVEL SECURITY;
