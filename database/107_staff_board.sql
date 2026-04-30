-- 107_staff_board.sql
-- R-Staff-Board (2026-05-01): 매장간 스태프 요청·응답 보드.
--
-- 운영자 의도:
--   "지금까지 카톡 그룹채팅으로 매장간 스태프 요청을 했다.
--    같은 메시지가 매분 도배되어 진짜 정보가 묻히고, 응답도 추적 안 된다.
--    NOX 안에 구조화된 보드를 만들어서 매장당 1행만 update, 다른 매장에서
--    한눈에 본다. 알림은 끄고 켤 수 있어야 한다."
--
-- 설계 원칙:
--   1) 매장당 1 active row per kind (need=요청 / available=가용)
--      → 카톡 도배 패턴 차단. 갱신은 update, 새 row 생성 X.
--   2) 자동 만료 (expires_at, default 15분)
--      → 잊혀진 요청 stale 방지. cron / client-side 검증.
--   3) 응답 추적 (staff_request_responses)
--      → "ㄱㅇ" 누가 누구한테? matching_id 자동 기록.
--   4) 알림 on/off 운영자별 (notification_preferences)
--      → board_new_request / board_response / sound / desktop / push 별도 토글.
--
-- 도메인 어휘 (service_types / tags):
--   service_types: '퍼블릭', '셔츠', '하퍼' (배열 — 다중 가능)
--   tags         : '새방', '안본인원', '초이스가능', '1빵', '인사안함' 등
--                   자유 형식. 운영 중 패턴 보고 표준 list 정리.
--
-- RLS 상태:
--   service-role 만 쓰기. 일반 user JWT 는 차단 (app route 가 service-role
--   key 로 우회 — 기존 NOX 패턴과 동일).

-- ============================================================
-- 1. staff_request_board — 매장별 활성 요청·가용 카드
-- ============================================================

CREATE TABLE IF NOT EXISTS staff_request_board (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  /* 매장 (요청·가용 등록 매장) */
  store_uuid uuid NOT NULL REFERENCES stores(id),

  /* 종류:
       'need'      = 우리 매장 스태프 부족 → 다른 매장에 요청
       'available' = 우리 매장 호스티스 가용 → 다른 매장에 보낼 수 있음 */
  request_kind text NOT NULL CHECK (request_kind IN ('need', 'available')),

  /* 종목 배열. 예: ['퍼블릭', '셔츠'] 다중 가능 (한 손님에 두 종목 등). */
  service_types text[] NOT NULL DEFAULT '{}',

  /* 인원 수 (손님). 1~20 합리 범위. */
  party_size int NOT NULL CHECK (party_size > 0 AND party_size <= 20),

  /* 태그 배열. 자유 형식.
     예: ['새방', '안본인원', '초이스가능', '1빵'] */
  tags text[] NOT NULL DEFAULT '{}',

  /* 자유 메모 (운영자가 추가 설명). 카톡의 "사이즈 좀 보셔요" 같은 짧은 글. */
  memo text,

  /* 등록자 (audit) */
  posted_by_user_id uuid NOT NULL REFERENCES profiles(id),
  posted_by_membership_id uuid NOT NULL REFERENCES store_memberships(id),

  /* 상태:
       'active'    = 활성 (보드에 노출)
       'fulfilled' = 매칭 완료 (요청자가 confirm 응답을 수락)
       'cancelled' = 취소 (등록자가 close)
       'expired'   = 자동 만료 (expires_at 경과 + cron 또는 client 처리) */
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'fulfilled', 'cancelled', 'expired')),

  posted_at timestamptz NOT NULL DEFAULT now(),
  /* 자동 만료 — default 15분 후. 운영자가 갱신하면 update 됨. */
  expires_at timestamptz NOT NULL DEFAULT (now() + INTERVAL '15 minutes'),

  fulfilled_at timestamptz,
  fulfilled_by_store_uuid uuid REFERENCES stores(id),
  cancelled_at timestamptz,

  /* 갱신 횟수 (운영자가 같은 카드 update 한 횟수). 통계용. */
  update_count int NOT NULL DEFAULT 0
);

/* 매장당 같은 종류의 active row 1개만. 카톡 도배 차단의 핵심. */
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_board_per_store_kind
  ON staff_request_board (store_uuid, request_kind)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_board_active_posted
  ON staff_request_board (status, posted_at DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_board_store_recent
  ON staff_request_board (store_uuid, posted_at DESC);

COMMENT ON TABLE staff_request_board IS
  'R-Staff-Board: 매장간 스태프 요청·가용 보드. 카톡 도배 패턴 대체. 매장당 1 active row per kind.';

-- ============================================================
-- 2. staff_request_responses — 응답·매칭 추적
-- ============================================================

CREATE TABLE IF NOT EXISTS staff_request_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  request_id uuid NOT NULL REFERENCES staff_request_board(id),

  /* 응답 매장 (요청자 매장과 다름) */
  responder_store_uuid uuid NOT NULL REFERENCES stores(id),
  responder_user_id uuid NOT NULL REFERENCES profiles(id),
  responder_membership_id uuid NOT NULL REFERENCES store_memberships(id),

  /* 응답 종류:
       'confirm'  = 보낼 수 있음 / 받을 수 있음 (긍정)
       'question' = 추가 질문 / 정보 요청
       'decline'  = 거절 (보낼 수 없음 등 — 추적용) */
  response_kind text NOT NULL CHECK (response_kind IN ('confirm', 'question', 'decline')),

  /* 응답 메시지 (선택). 카톡의 "ㄱㅇ", "하퍼 가요" 같은 짧은 글. */
  message text,

  /* 추천 호스티스 (있으면). cross_store_work_records 자동 연결 후보. */
  suggested_hostess_membership_id uuid REFERENCES store_memberships(id),

  responded_at timestamptz NOT NULL DEFAULT now(),

  /* 매칭 처리 — 요청자가 이 응답을 받아들였을 때 stamp.
     이후 cross_store_work_records 자동 생성 trigger 가능 (다음 라운드). */
  matched_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_responses_request
  ON staff_request_responses (request_id, responded_at DESC);

CREATE INDEX IF NOT EXISTS idx_responses_responder
  ON staff_request_responses (responder_store_uuid, responded_at DESC);

COMMENT ON TABLE staff_request_responses IS
  'R-Staff-Board: 보드 요청에 대한 매장간 응답. 카톡 "ㄱㅇ" 매칭 추적 가능.';

-- ============================================================
-- 3. notification_preferences — 운영자별 알림 on/off
-- ============================================================

CREATE TABLE IF NOT EXISTS notification_preferences (
  membership_id uuid PRIMARY KEY REFERENCES store_memberships(id),

  /* 보드 새 요청 (다른 매장이 등록 / 갱신) 알림 */
  board_new_request boolean NOT NULL DEFAULT true,

  /* 본인 매장 요청에 응답 들어왔을 때 알림 */
  board_response boolean NOT NULL DEFAULT true,

  /* in-app 사운드 (브라우저 audio 재생) */
  sound_enabled boolean NOT NULL DEFAULT true,

  /* 데스크톱 알림 (Notification API — 브라우저 native popup) */
  desktop_notification boolean NOT NULL DEFAULT false,

  /* PWA push (Service Worker 백그라운드 알림 — 다음 라운드) */
  push_enabled boolean NOT NULL DEFAULT false,

  /* 카카오 알림톡 push (사업자 채널 연동 — 향후 라운드) */
  kakao_alimtalk boolean NOT NULL DEFAULT false,

  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE notification_preferences IS
  'R-Staff-Board: 운영자별 알림 채널 on/off. 보드/응답 × in-app/desktop/push/kakao.';

-- ============================================================
-- 4. RLS — service-role only (NOX 표준 패턴)
-- ============================================================

ALTER TABLE staff_request_board ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_request_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'staff_board_service_only') THEN
    CREATE POLICY staff_board_service_only ON staff_request_board
      FOR ALL TO public USING (false) WITH CHECK (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'staff_responses_service_only') THEN
    CREATE POLICY staff_responses_service_only ON staff_request_responses
      FOR ALL TO public USING (false) WITH CHECK (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'notif_prefs_service_only') THEN
    CREATE POLICY notif_prefs_service_only ON notification_preferences
      FOR ALL TO public USING (false) WITH CHECK (false);
  END IF;
END $$;
