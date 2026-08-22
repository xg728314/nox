-- ============================================================
-- Migration 176 (2026-08-23): 초이스 요청 (choice_requests)
-- ============================================================
--
-- 배경:
--   실장이 카톡에 "3인 하퍼 초이스 있어요" · "5인 셔츠 초이스" 반복 도배.
--   기존 store_choice_state 는 매장 대기 aunt 상태 (공급 관점).
--   신규 choice_requests 는 손님 요청 (수요 관점) · 매칭될 때까지 pending.
--
-- 도배 방지 흐름:
--   1. 채팅 파싱 → CHOICE_REQUEST event 감지 → API 호출
--   2. 서버: 같은 매장 · 같은 (categories+party_size) 요청이 30초 내 존재 → skip
--   3. 신규 요청이면 INSERT · status=pending
--   4. 매장 대기 aunt 매칭 (dispatch confirm) 시 → status=matched
--   5. 조판/외부조판 상단 sticky 에 pending 요청 표시
--
-- ============================================================

CREATE TABLE IF NOT EXISTS choice_requests (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    store_uuid UUID NOT NULL REFERENCES stores(id),
    -- 요청 파티 크기 (손님 인원)
    party_size INTEGER NOT NULL DEFAULT 0,
    -- 필요 카테고리 (예: ["퍼블릭","셔츠","하퍼"] · 하나 이상)
    categories TEXT[] NOT NULL DEFAULT '{}',
    -- 원문 채팅 텍스트 (감사 · 재파싱용)
    raw_text TEXT,
    -- pending / matched / cancelled / expired
    status TEXT NOT NULL DEFAULT 'pending',
    -- 요청한 실장 (누가 손님 응대 중인지)
    requested_by_membership_id UUID REFERENCES store_memberships(id),
    -- 발생 채팅 메시지 (있으면 링크)
    source_chat_message_id UUID,
    -- 매칭 완료 시 · 배정된 세션
    matched_session_id UUID,
    matched_at TIMESTAMPTZ,
    -- 자동 만료 (기본 · 요청 후 30분 지나면 expired)
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 minutes'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    cancelled_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_choice_requests_store_pending
    ON choice_requests (store_uuid, status, created_at DESC)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_choice_requests_source_msg
    ON choice_requests (source_chat_message_id)
    WHERE source_chat_message_id IS NOT NULL;

COMMENT ON TABLE choice_requests IS
    'Sprint2 확장: 실장이 채팅으로 요청한 초이스 대기 목록. 도배 방지 + 매장 sticky 표시용.';
COMMENT ON COLUMN choice_requests.categories IS
    '요청 카테고리 배열. 예: {퍼블릭} · {셔츠,하퍼} · {퍼블릭,셔츠,하퍼}';
