-- ============================================================
-- 173_nfc_room_tags
-- ============================================================
-- 2026-07-29 R-nfc-phase3:
--   NFC 아크릴 태그 시스템. 각 매장 방마다 룸 태그 + 매장 공통 웨이터/사입/화장실
--   태그 부착. 아가씨/직원 폰 (Android PWA) 으로 터치 → 자동 이벤트 생성 · 실장
--   확인 or 1분 후 자동확인 → 담당 채팅방에 매크로 발행.
--
--   Phase 3 scope: 15매장 전면 도입 · 4가지 태그 종류.
-- ============================================================

-- ── 1. NFC 태그 (아크릴 스티커) ──
CREATE TABLE IF NOT EXISTS room_nfc_tags (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    -- 태그 인코딩 값 (URL: https://nox.ai.kr/nfc?tag=<tag_uuid>).
    -- unique · 재발급 시 새 uuid 로 교체 · 기존 tag 는 deactivated.
    tag_uuid UUID NOT NULL UNIQUE,
    store_uuid UUID NOT NULL REFERENCES stores(id),
    -- room_uuid : tag_type='room' 일 때만 필수 · 기타는 NULL
    room_uuid UUID REFERENCES rooms(id),
    -- 태그 종류
    tag_type TEXT NOT NULL CHECK (tag_type IN ('room', 'waiter_call', 'purchase', 'toilet', 'manager_call')),
    label TEXT NOT NULL,  -- 표시명: '3번방', '웨이터 호출', '사입', '화장실', '실장 호출'
    is_active BOOLEAN NOT NULL DEFAULT true,
    -- 태그 위치 note (아크릴 어디에 붙였나 · 문 앞 · 테이블 · 벽 등)
    location_note TEXT,
    -- 서명 HMAC (위조 방지 · optional · Phase 3 확대 시 활성)
    signature TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deactivated_at TIMESTAMPTZ,
    deactivated_reason TEXT,
    -- room 타입은 room_uuid 필수 · 기타는 NULL 허용
    CHECK (
      (tag_type = 'room' AND room_uuid IS NOT NULL)
      OR (tag_type <> 'room' AND room_uuid IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_room_nfc_tags_store_active
    ON room_nfc_tags (store_uuid, tag_type)
    WHERE is_active = true AND deactivated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_room_nfc_tags_room
    ON room_nfc_tags (room_uuid)
    WHERE room_uuid IS NOT NULL AND is_active = true;

COMMENT ON TABLE room_nfc_tags IS 'R-nfc-phase3: NFC 아크릴 태그 정의. 각 매장 방/서비스 별 부착.';
COMMENT ON COLUMN room_nfc_tags.tag_type IS 'room=방번호 · waiter_call=웨이터호출 · purchase=사입 · toilet=화장실 · manager_call=실장호출';

-- ── 2. NFC 터치 이벤트 로그 ──
CREATE TABLE IF NOT EXISTS nfc_scan_events (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tag_id UUID NOT NULL REFERENCES room_nfc_tags(id),
    tag_uuid UUID NOT NULL,  -- 편의성 · tag rotation 후에도 로그 유지
    store_uuid UUID NOT NULL REFERENCES stores(id),
    room_uuid UUID REFERENCES rooms(id),
    tag_type TEXT NOT NULL,
    -- 터치한 사람 (로그인 세션 기반 · JWT 로 인증)
    actor_membership_id UUID REFERENCES store_memberships(id),
    actor_role TEXT,  -- hostess / waiter / manager 등 snapshot
    -- 연결된 세션/참여자 (tag_type='room' 인 경우 자동 매칭)
    session_id UUID REFERENCES room_sessions(id),
    participant_id UUID REFERENCES session_participants(id),
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- 상태 흐름:
    --   pending      → 스캔 직후 · 1분 대기
    --   confirmed    → 실장이 즉시 [확인] 클릭
    --   auto_confirmed → 1분 지나 자동 확인 (cron)
    --   rejected     → 실장이 [오차/취소] 클릭
    --   expired      → 처리 안 되고 30분+ 방치 (관측용)
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
      status IN ('pending', 'confirmed', 'auto_confirmed', 'rejected', 'expired')
    ),
    confirmed_at TIMESTAMPTZ,
    confirmed_by_membership_id UUID REFERENCES store_memberships(id),
    reject_reason TEXT,
    -- 매크로 채팅 발행 완료 여부
    chat_broadcast_at TIMESTAMPTZ,
    chat_room_id UUID REFERENCES chat_rooms(id),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nfc_scan_events_pending
    ON nfc_scan_events (store_uuid, scanned_at DESC)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_nfc_scan_events_actor
    ON nfc_scan_events (actor_membership_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_nfc_scan_events_session
    ON nfc_scan_events (session_id, scanned_at DESC)
    WHERE session_id IS NOT NULL;
-- Debounce: 같은 (actor, tag) 15초 내 재스캔 방지용 lookup
CREATE INDEX IF NOT EXISTS idx_nfc_scan_events_debounce
    ON nfc_scan_events (actor_membership_id, tag_id, scanned_at DESC);

COMMENT ON TABLE nfc_scan_events IS 'R-nfc-phase3: NFC 태그 터치 이벤트 · 상태 추적 + 매크로 채팅 발행 결과';
