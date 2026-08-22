-- ============================================================
-- 174_chat_types_and_learning
-- ============================================================
-- 2026-07-29 Sprint 1 — 자동 등록 + 3-column 채팅 UI + 학습 기반 파싱
--
-- 1) chat_messages.message_type 확장 — 3-column 정렬용 매크로 종류
-- 2) chat_messages.macro_context — 매크로 종류별 메타 (JSON)
-- 3) chat_messages.undo_deadline_at — 5분 매크로 유예 (실장 취소 가능)
-- 4) chat_messages.superseded_at — 초이스톡 replaced 상태 (신규 발행 시 이전 것 감춤)
-- 5) alias_learnings — 실장/매장 별 오타·별칭 매핑 학습
-- 6) store_choice_state — 매장별 대기 인원 상태 트래킹 (spam 방지)
-- 7) broadcast_queue — rate limit + 배치 발행
-- ============================================================

-- ── 1. chat_messages 확장 ──
-- 기존 CHECK 제약 (있으면) drop 후 재정의.
ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS macro_context JSONB,
    ADD COLUMN IF NOT EXISTS undo_deadline_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES room_sessions(id);

-- message_type CHECK 재정의 (기존 값 유지 + 신규 추가)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname LIKE 'chat_messages_message_type%'
          AND conrelid = 'chat_messages'::regclass
    ) THEN
        EXECUTE 'ALTER TABLE chat_messages DROP CONSTRAINT ' || (
            SELECT conname FROM pg_constraint
            WHERE conname LIKE 'chat_messages_message_type%'
              AND conrelid = 'chat_messages'::regclass
            LIMIT 1
        );
    END IF;
END $$;

ALTER TABLE chat_messages
    ADD CONSTRAINT chat_messages_message_type_check
    CHECK (message_type IN (
        'text',            -- 일반 대화 (좌측 · 사람)
        'system',          -- 시스템 알림 (중앙 · 작음)
        'macro_maid',      -- 메이드 등록 매크로 (우측 카드)
        'macro_end',       -- 종료 매크로 (우측 카드 · 회색)
        'macro_choice',    -- 초이스 상태 (중앙 sticky · edit 형)
        'macro_confirm',   -- 확인 요청 · pending (중앙 강조)
        'macro_nfc',       -- NFC 이벤트 매크로 (우측 카드)
        'macro_extend'     -- 연장 매크로 (우측 카드)
    ));

COMMENT ON COLUMN chat_messages.macro_context IS
    'Sprint1: 매크로 종류별 세부 (참여자·방·종목·티켓·confidence 등)';
COMMENT ON COLUMN chat_messages.undo_deadline_at IS
    'Sprint1: 매크로 실장 취소 가능 시간 (통상 발행 후 5분)';
COMMENT ON COLUMN chat_messages.superseded_at IS
    'Sprint1: 초이스톡 replaced · 신규 발행 시 이전 것 감춤 (list 에서 제외)';

CREATE INDEX IF NOT EXISTS idx_chat_messages_active_choice
    ON chat_messages (chat_room_id, created_at DESC)
    WHERE message_type = 'macro_choice' AND superseded_at IS NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_undo_pending
    ON chat_messages (undo_deadline_at)
    WHERE undo_deadline_at IS NOT NULL AND deleted_at IS NULL;

-- ── 2. alias_learnings ──
-- 파싱 신뢰도 학습: 실장 A가 자주 쓰는 오타·별칭
CREATE TABLE IF NOT EXISTS alias_learnings (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    scope TEXT NOT NULL CHECK (scope IN ('manager', 'store', 'global')),
    -- scope='manager' → membership_id · 'store' → store_uuid · 'global' → NULL
    scope_id UUID,
    from_text TEXT NOT NULL,  -- "지스"
    resolved_type TEXT NOT NULL CHECK (resolved_type IN ('hostess', 'store', 'category', 'ticket')),
    resolved_id UUID,          -- hostess: membership_id · store: store_uuid · 카테고리/티켓은 NULL
    resolved_value TEXT NOT NULL,  -- "지수" or "신세계" or "퍼블릭"
    confirmed_count INTEGER NOT NULL DEFAULT 1,
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (scope, scope_id, from_text, resolved_type)
);

CREATE INDEX IF NOT EXISTS idx_alias_learnings_lookup
    ON alias_learnings (from_text, scope, scope_id);

COMMENT ON TABLE alias_learnings IS
    'Sprint1: 파서 학습 · 오타/별칭 → 실제 hostess/매장/카테고리 매핑';

-- ── 3. store_choice_state ──
-- 매장별 대기 아가씨 인원 상태 트래킹 (spam 방지)
CREATE TABLE IF NOT EXISTS store_choice_state (
    store_uuid UUID PRIMARY KEY REFERENCES stores(id),
    available_count INTEGER NOT NULL DEFAULT 0,
    by_category JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {P:2,H:1,S:3}
    last_state_hash TEXT,  -- 상태 변경 감지용
    last_broadcast_message_id UUID REFERENCES chat_messages(id),
    last_broadcast_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE store_choice_state IS
    'Sprint2: 매장별 대기 인원 상태 · 상태 변경 시만 macro_choice 재발행';

-- ── 4. broadcast_queue ──
-- Rate limit + 배치 발행용
CREATE TABLE IF NOT EXISTS broadcast_queue (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    chat_room_id UUID NOT NULL REFERENCES chat_rooms(id),
    store_uuid UUID NOT NULL REFERENCES stores(id),
    message_type TEXT NOT NULL,
    macro_context JSONB,
    content TEXT NOT NULL,
    priority SMALLINT NOT NULL DEFAULT 2,  -- 1=긴급 · 2=일반 · 3=배치용
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 seconds'),
    sent_at TIMESTAMPTZ,
    batched_into_message_id UUID REFERENCES chat_messages(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_broadcast_queue_pending
    ON broadcast_queue (store_uuid, scheduled_at)
    WHERE sent_at IS NULL;

COMMENT ON TABLE broadcast_queue IS
    'Sprint2: 매크로 발행 대기열 · rate limit + 배치 처리';
