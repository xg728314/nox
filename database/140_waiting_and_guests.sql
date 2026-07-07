-- ═══════════════════════════════════════════════════════════════
-- 실시간 대기 요청 + 손님 프로필 (2026-07-07)
--   카톡 실사 기반 신규 기능:
--     · waiting_requests (실시간 매장 간 대기 요청 게시판)
--     · guest_profiles + guest_visits (손님 방문 이력 + 태그)
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. 대기 요청 게시판 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.waiting_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_uuid UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    requester_user_id UUID NOT NULL REFERENCES public.profiles(id),
    requester_membership_id UUID REFERENCES public.store_memberships(id),
    -- 요청 종목 (여러 개 가능: 퍼블릭/하퍼/셔츠)
    categories TEXT[] NOT NULL DEFAULT '{}',
    -- 손님 인원 + 방 개수
    guest_count INT,
    room_count INT DEFAULT 1,
    -- 조건 태그 (땁/안본/사이즈만/인사x/장타/팁방/꿀방/착한/새방/일행추가 등)
    tags TEXT[] DEFAULT '{}',
    -- 손님 특징 자유 텍스트
    guest_note TEXT,
    -- 상태
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'matched', 'cancelled', 'expired')),
    matched_at TIMESTAMPTZ,
    matched_by_user_id UUID REFERENCES public.profiles(id),
    matched_dispatch_id UUID,
    -- 원본 채팅 메시지 참조 (있으면)
    origin_chat_message_id UUID,
    -- 자동 만료 (기본 15분)
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_waiting_active
    ON public.waiting_requests (created_at DESC)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_waiting_store
    ON public.waiting_requests (store_uuid, created_at DESC);

-- ─── 2. 손님 프로필 (매장별 재방문 관리) ────────────────────
CREATE TABLE IF NOT EXISTS public.guest_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_uuid UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    -- 손님 식별
    display_name TEXT NOT NULL,
    phone TEXT,
    -- 특징 태그
    tags TEXT[] DEFAULT '{}',
    -- 취향 힌트 (김다미 닮은, 어려보이는, 사이즈만 등)
    style_prefs TEXT[] DEFAULT '{}',
    -- 선호 스태프
    preferred_staff_ids UUID[] DEFAULT '{}',
    -- 자유 메모
    memo TEXT,
    -- 이력 요약 (visits 테이블에서 계산 → cache)
    visit_count INT DEFAULT 0,
    last_visit_at TIMESTAMPTZ,
    total_spent NUMERIC(14, 2) DEFAULT 0,
    -- 블랙 리스트
    is_blacklisted BOOLEAN DEFAULT FALSE,
    blacklist_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_guest_store_name
    ON public.guest_profiles (store_uuid, display_name);
CREATE INDEX IF NOT EXISTS idx_guest_phone
    ON public.guest_profiles (phone)
    WHERE phone IS NOT NULL;

-- ─── 3. 손님 방문 이력 (세션과 연결) ────────────────────────
CREATE TABLE IF NOT EXISTS public.guest_visits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guest_id UUID NOT NULL REFERENCES public.guest_profiles(id) ON DELETE CASCADE,
    store_uuid UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    session_id UUID REFERENCES public.room_sessions(id) ON DELETE SET NULL,
    business_day_id UUID REFERENCES public.store_operating_days(id),
    -- 방문 시 태그 (그날 손님 상태/기분)
    tags TEXT[] DEFAULT '{}',
    -- 매출 요약
    total_amount NUMERIC(14, 2),
    tc_count INT,
    -- 메모
    memo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_visits_guest
    ON public.guest_visits (guest_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visits_session
    ON public.guest_visits (session_id)
    WHERE session_id IS NOT NULL;

-- ─── 4. RLS ─────────────────────────────────────────────────
ALTER TABLE public.waiting_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_visits ENABLE ROW LEVEL SECURITY;

-- 대기 요청 — active 상태는 공개 읽기 (매장 간 공유가 목적)
DROP POLICY IF EXISTS "waiting_read_active" ON public.waiting_requests;
CREATE POLICY "waiting_read_active" ON public.waiting_requests
    FOR SELECT USING (status = 'active');

DROP POLICY IF EXISTS "waiting_own_write" ON public.waiting_requests;
CREATE POLICY "waiting_own_write" ON public.waiting_requests
    FOR ALL
    USING (requester_user_id = auth.uid())
    WITH CHECK (requester_user_id = auth.uid());

-- 손님 프로필 — 매장 멤버만 접근
DROP POLICY IF EXISTS "guest_store_member" ON public.guest_profiles;
CREATE POLICY "guest_store_member" ON public.guest_profiles
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.store_memberships m
            WHERE m.profile_id = auth.uid()
              AND m.store_uuid = guest_profiles.store_uuid
              AND m.status = 'approved'
        )
    );

DROP POLICY IF EXISTS "visit_store_member" ON public.guest_visits;
CREATE POLICY "visit_store_member" ON public.guest_visits
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.store_memberships m
            WHERE m.profile_id = auth.uid()
              AND m.store_uuid = guest_visits.store_uuid
              AND m.status = 'approved'
        )
    );

COMMENT ON TABLE public.waiting_requests IS
    '실시간 매장 간 대기 요청 게시판. 카톡 대체 시도. R-waiting 2026-07-07.';
COMMENT ON TABLE public.guest_profiles IS
    '손님 재방문 프로필 (매장 단위). R-guests 2026-07-07.';
COMMENT ON TABLE public.guest_visits IS
    '손님 방문 이력 (세션과 연결). R-guests 2026-07-07.';
