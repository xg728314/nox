-- ═══════════════════════════════════════════════════════════════
-- Phase C — 자율 오퍼레이션 루프 (2026-07-08)
--   카톡 완전 대체 목표. 채팅 → 자동 등록 → Push → dispatch → 손님 태그.
--
-- 신규 테이블:
--   · manager_aliases   (실장 별칭 사전, 예: 이=이부장/중=중권실장/창=창훈)
--   · chat_auto_actions (채팅 자동 처리 이력 · 감사)
--   · guest_auto_tags   (세션 → 손님 프로필 자동 태그 파이프)
--   · store_broadcasts  (매장 실시간 상태 브로드캐스트)
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. 실장 별칭 사전 ────────────────────────────────────────
-- 파서에서 카톡의 `이 은비`, `중 단비`, `창 단아` 같은 짧은 표기를
-- 실장 → 매장 → 아가씨로 자동 해석하기 위한 사전.
CREATE TABLE IF NOT EXISTS public.manager_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_uuid UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    membership_id UUID NOT NULL REFERENCES public.store_memberships(id) ON DELETE CASCADE,
    -- 1-3자 별칭 (이, 중, 창, 연성, 재환, 준우 등)
    alias TEXT NOT NULL,
    -- 표시 이름 (풀네임)
    display_name TEXT NOT NULL,
    -- 사용 빈도 (파서 tie-break)
    usage_count INT DEFAULT 0,
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (store_uuid, alias)
);
CREATE INDEX IF NOT EXISTS idx_manager_alias_lookup
    ON public.manager_aliases (alias, store_uuid);
CREATE INDEX IF NOT EXISTS idx_manager_alias_membership
    ON public.manager_aliases (membership_id);

-- ─── 2. 채팅 자동 처리 이력 (감사) ──────────────────────────
-- 채팅 메시지 → 자동 실행된 액션들 로그. 오작동 추적용.
CREATE TABLE IF NOT EXISTS public.chat_auto_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_message_id UUID NOT NULL,
    chat_room_id UUID,
    sender_user_id UUID REFERENCES public.profiles(id),
    -- 액션 유형: 'waiting_request', 'dispatch', 'guest_tag', 'session_event'
    action_type TEXT NOT NULL,
    -- 파서 결과 원본 (디버깅)
    parsed_json JSONB,
    -- 생성된 리소스 참조
    ref_id UUID,
    ref_table TEXT,
    -- 실행 결과
    status TEXT NOT NULL DEFAULT 'success'
        CHECK (status IN ('success', 'skipped', 'failed')),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_auto_message
    ON public.chat_auto_actions (chat_message_id);
CREATE INDEX IF NOT EXISTS idx_chat_auto_recent
    ON public.chat_auto_actions (created_at DESC);

-- ─── 3. 손님 자동 태그 큐 (세션 → 손님 프로필 파이프) ──────
-- 세션 종료 시 트리거로 자동 삽입 또는 API 에서 동기 처리.
CREATE TABLE IF NOT EXISTS public.guest_auto_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.room_sessions(id) ON DELETE CASCADE,
    store_uuid UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    -- 세션 원본 정보 (손님 노트 · 태그)
    guest_note TEXT,
    tags TEXT[] DEFAULT '{}',
    -- 채팅 메시지에서 언급된 손님 표기 (예: '50대 사장님')
    guest_display_name TEXT,
    -- 매칭된 손님 프로필 (있으면)
    matched_guest_id UUID REFERENCES public.guest_profiles(id) ON DELETE SET NULL,
    -- 처리 상태
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'matched', 'created', 'skipped')),
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_guest_auto_pending
    ON public.guest_auto_tags (created_at)
    WHERE status = 'pending';

-- ─── 4. 매장 실시간 브로드캐스트 (인터콤) ───────────────────
-- 각 매장이 현재 상태 broadcast → 모든 실장 즉시 확인.
-- 5분마다 자동 갱신 또는 이벤트 발생 시.
CREATE TABLE IF NOT EXISTS public.store_broadcasts (
    store_uuid UUID PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
    -- 현재 상태
    waiting_staff_count INT DEFAULT 0,      -- 지금 대기 스태프
    working_staff_count INT DEFAULT 0,      -- 일하는 중
    empty_room_count INT DEFAULT 0,         -- 빈 방
    active_session_count INT DEFAULT 0,     -- 진행 세션
    -- 자유 상태 메시지 (예: '오늘 신입 3명 있음')
    status_message TEXT,
    is_available BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES public.profiles(id)
);

-- ─── 5. RLS ─────────────────────────────────────────────────
ALTER TABLE public.manager_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_auto_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_auto_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_broadcasts ENABLE ROW LEVEL SECURITY;

-- 실장 별칭 공개 읽기 (파서에서 조회)
DROP POLICY IF EXISTS "manager_alias_read" ON public.manager_aliases;
CREATE POLICY "manager_alias_read" ON public.manager_aliases
    FOR SELECT USING (TRUE);

-- 본인 매장 알리아스만 write
DROP POLICY IF EXISTS "manager_alias_own_write" ON public.manager_aliases;
CREATE POLICY "manager_alias_own_write" ON public.manager_aliases
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.store_memberships m
            WHERE m.profile_id = auth.uid()
              AND m.store_uuid = manager_aliases.store_uuid
              AND m.status = 'approved'
              AND m.role IN ('owner', 'manager')
        )
    );

-- chat_auto_actions — 본인 매장 감사
DROP POLICY IF EXISTS "chat_auto_own_store" ON public.chat_auto_actions;
CREATE POLICY "chat_auto_own_store" ON public.chat_auto_actions
    FOR SELECT USING (
        sender_user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.store_memberships m
            WHERE m.profile_id = auth.uid()
              AND m.status = 'approved'
              AND m.role IN ('owner', 'manager')
        )
    );

-- guest_auto_tags — 본인 매장만
DROP POLICY IF EXISTS "guest_auto_store" ON public.guest_auto_tags;
CREATE POLICY "guest_auto_store" ON public.guest_auto_tags
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.store_memberships m
            WHERE m.profile_id = auth.uid()
              AND m.store_uuid = guest_auto_tags.store_uuid
              AND m.status = 'approved'
        )
    );

-- 브로드캐스트 — 공개 읽기 (매장 간 공유가 목적)
DROP POLICY IF EXISTS "broadcast_read" ON public.store_broadcasts;
CREATE POLICY "broadcast_read" ON public.store_broadcasts
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "broadcast_own_write" ON public.store_broadcasts;
CREATE POLICY "broadcast_own_write" ON public.store_broadcasts
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.store_memberships m
            WHERE m.profile_id = auth.uid()
              AND m.store_uuid = store_broadcasts.store_uuid
              AND m.status = 'approved'
              AND m.role IN ('owner', 'manager')
        )
    );

COMMENT ON TABLE public.manager_aliases IS
    '실장 별칭 사전. 파서에서 이/중/창 → 실장 매핑. R-auto-ops 2026-07-08.';
COMMENT ON TABLE public.chat_auto_actions IS
    '채팅 자동 처리 감사 로그. R-auto-ops 2026-07-08.';
COMMENT ON TABLE public.guest_auto_tags IS
    '세션 종료 시 손님 프로필 자동 태그 큐. R-auto-ops 2026-07-08.';
COMMENT ON TABLE public.store_broadcasts IS
    '매장 실시간 상태 브로드캐스트. R-auto-ops 2026-07-08.';
