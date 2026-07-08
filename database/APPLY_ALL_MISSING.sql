-- ═══════════════════════════════════════════════════════════════
-- APPLY_ALL_MISSING.sql
--   Supabase 에 아직 안 적용된 5개 migration 을 순서대로 통합.
--   모든 CREATE TABLE 은 IF NOT EXISTS · 여러 번 실행해도 안전.
--
--   실행 방법:
--     1. https://supabase.com/dashboard/project/piboecawkeqahyqbcize/sql/new
--     2. 이 파일 전체 복사 → 붙여넣기 → RUN
--
--   포함 migration:
--     · 121_push_subscriptions  (Push 알림)
--     · 122_sos_events          (SOS 긴급호출)
--     · 130_marketplace_schema  (라운지/광고/파트너/초이스톡/포인트)
--     · 140_waiting_and_guests  (실시간 대기 · 손님 프로필)
--     · 150_autonomous_ops      (자율 오퍼레이션 루프)
-- ═══════════════════════════════════════════════════════════════

-- ─── 121: push_subscriptions ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    p256dh_key TEXT NOT NULL,
    auth_key TEXT NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_success_at TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    last_failure_code INT,
    UNIQUE (user_id, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
    ON public.push_subscriptions (user_id);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "push_subscriptions_own" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_own" ON public.push_subscriptions
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─── 122: sos_events ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sos_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_uuid UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    sender_user_id UUID NOT NULL REFERENCES public.profiles(id),
    sender_membership_id UUID REFERENCES public.store_memberships(id),
    sender_role TEXT,
    room_uuid UUID REFERENCES public.rooms(id),
    session_id UUID REFERENCES public.room_sessions(id),
    kind TEXT NOT NULL DEFAULT 'emergency',
    message TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'cancelled')),
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES public.profiles(id),
    resolved_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    first_notified_at TIMESTAMPTZ,
    notified_user_ids UUID[] DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_sos_store_active ON public.sos_events (store_uuid, created_at DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_sos_sender ON public.sos_events (sender_user_id, created_at DESC);
ALTER TABLE public.sos_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sos_events_own_store" ON public.sos_events;
CREATE POLICY "sos_events_own_store" ON public.sos_events FOR ALL USING (
    EXISTS (SELECT 1 FROM public.store_memberships m
        WHERE m.profile_id = auth.uid() AND m.store_uuid = sos_events.store_uuid AND m.status = 'approved')
);

-- ─── 130: marketplace (ads / community / choice_talk / partners / points) ──
CREATE TABLE IF NOT EXISTS public.ads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_uuid UUID REFERENCES public.stores(id) ON DELETE SET NULL,
    advertiser_user_id UUID NOT NULL REFERENCES public.profiles(id),
    title TEXT NOT NULL,
    body TEXT,
    category TEXT NOT NULL,
    region_top TEXT,
    region_sub TEXT,
    region_detail TEXT,
    tc_amount INT,
    tc_currency TEXT DEFAULT 'KRW',
    thumbnail_url TEXT,
    image_urls TEXT[] DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','paused','expired','banned')),
    start_at TIMESTAMPTZ DEFAULT NOW(),
    end_at TIMESTAMPTZ,
    view_count INT DEFAULT 0,
    like_count INT DEFAULT 0,
    contact_click_count INT DEFAULT 0,
    contact_phone TEXT,
    contact_kakao TEXT,
    show_business_info BOOLEAN DEFAULT TRUE,
    is_pinned BOOLEAN DEFAULT FALSE,
    pinned_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ads_status_category ON public.ads (status, category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ads_region ON public.ads (region_top, region_sub);
CREATE INDEX IF NOT EXISTS idx_ads_advertiser ON public.ads (advertiser_user_id, status);
CREATE INDEX IF NOT EXISTS idx_ads_pinned ON public.ads (is_pinned, pinned_until) WHERE is_pinned = TRUE;

CREATE TABLE IF NOT EXISTS public.community_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_user_id UUID NOT NULL REFERENCES public.profiles(id),
    author_nickname TEXT,
    board TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    image_urls TEXT[] DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',
    view_count INT DEFAULT 0,
    like_count INT DEFAULT 0,
    comment_count INT DEFAULT 0,
    is_notice BOOLEAN DEFAULT FALSE,
    is_hidden BOOLEAN DEFAULT FALSE,
    hidden_reason TEXT,
    hot_score NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_community_posts_board_time ON public.community_posts (board, created_at DESC) WHERE is_hidden = FALSE;
CREATE INDEX IF NOT EXISTS idx_community_posts_hot ON public.community_posts (hot_score DESC) WHERE is_hidden = FALSE;
CREATE INDEX IF NOT EXISTS idx_community_posts_author ON public.community_posts (author_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.community_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
    author_user_id UUID NOT NULL REFERENCES public.profiles(id),
    author_nickname TEXT,
    body TEXT NOT NULL,
    parent_comment_id UUID REFERENCES public.community_comments(id) ON DELETE CASCADE,
    like_count INT DEFAULT 0,
    is_hidden BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_community_comments_post ON public.community_comments (post_id, created_at ASC) WHERE is_hidden = FALSE;

CREATE TABLE IF NOT EXISTS public.community_likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('post','comment','ad')),
    target_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_community_likes_target ON public.community_likes (target_type, target_id);

CREATE TABLE IF NOT EXISTS public.community_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_user_id UUID NOT NULL REFERENCES public.profiles(id),
    target_type TEXT NOT NULL CHECK (target_type IN ('post','comment','ad','user')),
    target_id UUID NOT NULL,
    reason TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending','resolved','dismissed')),
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_community_reports_pending ON public.community_reports (created_at DESC) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.choice_talk_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    initiator_user_id UUID NOT NULL REFERENCES public.profiles(id),
    counterparty_user_id UUID REFERENCES public.profiles(id),
    ad_id UUID REFERENCES public.ads(id) ON DELETE SET NULL,
    region_tag TEXT,
    category_tag TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active','archived','blocked')),
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    initiator_unread INT DEFAULT 0,
    counterparty_unread INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_choice_talk_participant ON public.choice_talk_rooms (initiator_user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_choice_talk_counter ON public.choice_talk_rooms (counterparty_user_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.choice_talk_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES public.choice_talk_rooms(id) ON DELETE CASCADE,
    sender_user_id UUID NOT NULL REFERENCES public.profiles(id),
    body TEXT,
    image_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_choice_talk_messages_room ON public.choice_talk_messages (room_id, created_at ASC);

CREATE TABLE IF NOT EXISTS public.partner_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    icon TEXT,
    banner_url TEXT,
    color_hex TEXT,
    display_order INT DEFAULT 0,
    is_new BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS public.partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES public.partner_categories(id),
    name TEXT NOT NULL,
    description TEXT,
    long_description TEXT,
    address TEXT,
    region_top TEXT,
    region_sub TEXT,
    phone TEXT,
    kakao TEXT,
    website TEXT,
    thumbnail_url TEXT,
    banner_url TEXT,
    image_urls TEXT[] DEFAULT '{}',
    discount_percent INT,
    special_offer TEXT,
    tags TEXT[] DEFAULT '{}',
    is_featured BOOLEAN DEFAULT FALSE,
    is_new BOOLEAN DEFAULT FALSE,
    status TEXT DEFAULT 'active' CHECK (status IN ('active','paused','expired')),
    view_count INT DEFAULT 0,
    like_count INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_partners_category ON public.partners (category_id, is_featured DESC, created_at DESC) WHERE status = 'active';

INSERT INTO public.partner_categories (slug, name, icon, display_order, is_new, color_hex) VALUES
    ('hair', '헤어·메이크업', '💄', 1, FALSE, '#B197FC'),
    ('cosmetic', '성형·시술', '💉', 2, TRUE, '#FF87B2'),
    ('fashion', '홀복·패션', '👗', 3, TRUE, '#FF6B9D'),
    ('nail', '라이프 스타일', '💅', 4, TRUE, '#FFA94D'),
    ('event', '이벤트 & 혜택', '🎁', 5, TRUE, '#FFD43B'),
    ('review', '자유 톡 · 리뷰', '💬', 6, TRUE, '#4DABF7')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.advertiser_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    business_name TEXT,
    business_number TEXT,
    business_owner TEXT,
    business_address TEXT,
    business_address_detail TEXT,
    contact_phone TEXT,
    contact_kakao TEXT,
    logo_url TEXT,
    default_thumbnail_url TEXT,
    verified BOOLEAN DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    verification_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.points_balance (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    balance INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.points_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    amount INT NOT NULL,
    balance_after INT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('topup','ad_spend','pin_boost','refund','adjustment')),
    ref_type TEXT,
    ref_id UUID,
    memo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_points_tx_user ON public.points_transactions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.store_status_info (
    store_uuid UUID PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
    live_note TEXT,
    is_24h BOOLEAN DEFAULT FALSE,
    event_text TEXT,
    category_tags TEXT[] DEFAULT '{}',
    region_display TEXT,
    badge TEXT,
    entry_level TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_public_profiles (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    nickname TEXT UNIQUE,
    avatar_url TEXT,
    avatar_color TEXT,
    bio TEXT,
    region_top TEXT,
    role_tag TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    is_banned BOOLEAN DEFAULT FALSE,
    banned_until TIMESTAMPTZ,
    banned_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 130 RLS
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.choice_talk_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.choice_talk_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advertiser_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.points_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.points_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_status_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_public_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ads_read_public" ON public.ads;
CREATE POLICY "ads_read_public" ON public.ads FOR SELECT USING (status IN ('active','paused'));
DROP POLICY IF EXISTS "posts_read_public" ON public.community_posts;
CREATE POLICY "posts_read_public" ON public.community_posts FOR SELECT USING (is_hidden = FALSE);
DROP POLICY IF EXISTS "comments_read_public" ON public.community_comments;
CREATE POLICY "comments_read_public" ON public.community_comments FOR SELECT USING (is_hidden = FALSE);
DROP POLICY IF EXISTS "partners_read_public" ON public.partners;
CREATE POLICY "partners_read_public" ON public.partners FOR SELECT USING (status = 'active');
DROP POLICY IF EXISTS "user_public_read" ON public.user_public_profiles;
CREATE POLICY "user_public_read" ON public.user_public_profiles FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS "ads_own_write" ON public.ads;
CREATE POLICY "ads_own_write" ON public.ads FOR ALL USING (advertiser_user_id = auth.uid()) WITH CHECK (advertiser_user_id = auth.uid());
DROP POLICY IF EXISTS "posts_own_write" ON public.community_posts;
CREATE POLICY "posts_own_write" ON public.community_posts FOR ALL USING (author_user_id = auth.uid()) WITH CHECK (author_user_id = auth.uid());
DROP POLICY IF EXISTS "comments_own_write" ON public.community_comments;
CREATE POLICY "comments_own_write" ON public.community_comments FOR ALL USING (author_user_id = auth.uid()) WITH CHECK (author_user_id = auth.uid());
DROP POLICY IF EXISTS "likes_own" ON public.community_likes;
CREATE POLICY "likes_own" ON public.community_likes FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "advertiser_profiles_own" ON public.advertiser_profiles;
CREATE POLICY "advertiser_profiles_own" ON public.advertiser_profiles FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "points_balance_own" ON public.points_balance;
CREATE POLICY "points_balance_own" ON public.points_balance FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "points_tx_own" ON public.points_transactions;
CREATE POLICY "points_tx_own" ON public.points_transactions FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "choice_talk_participant" ON public.choice_talk_rooms;
CREATE POLICY "choice_talk_participant" ON public.choice_talk_rooms FOR ALL USING (initiator_user_id = auth.uid() OR counterparty_user_id = auth.uid());
DROP POLICY IF EXISTS "choice_talk_msg_participant" ON public.choice_talk_messages;
CREATE POLICY "choice_talk_msg_participant" ON public.choice_talk_messages FOR ALL USING (
    EXISTS (SELECT 1 FROM public.choice_talk_rooms r
        WHERE r.id = room_id AND (r.initiator_user_id = auth.uid() OR r.counterparty_user_id = auth.uid()))
);
DROP POLICY IF EXISTS "user_public_own_write" ON public.user_public_profiles;
CREATE POLICY "user_public_own_write" ON public.user_public_profiles FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ─── 140: waiting_requests + guest_profiles + guest_visits ────
CREATE TABLE IF NOT EXISTS public.waiting_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_uuid UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    requester_user_id UUID NOT NULL REFERENCES public.profiles(id),
    requester_membership_id UUID REFERENCES public.store_memberships(id),
    categories TEXT[] NOT NULL DEFAULT '{}',
    guest_count INT,
    room_count INT DEFAULT 1,
    tags TEXT[] DEFAULT '{}',
    guest_note TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'matched', 'cancelled', 'expired')),
    matched_at TIMESTAMPTZ,
    matched_by_user_id UUID REFERENCES public.profiles(id),
    matched_dispatch_id UUID,
    origin_chat_message_id UUID,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_waiting_active ON public.waiting_requests (created_at DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_waiting_store ON public.waiting_requests (store_uuid, created_at DESC);

CREATE TABLE IF NOT EXISTS public.guest_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_uuid UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    phone TEXT,
    tags TEXT[] DEFAULT '{}',
    style_prefs TEXT[] DEFAULT '{}',
    preferred_staff_ids UUID[] DEFAULT '{}',
    memo TEXT,
    visit_count INT DEFAULT 0,
    last_visit_at TIMESTAMPTZ,
    total_spent NUMERIC(14, 2) DEFAULT 0,
    is_blacklisted BOOLEAN DEFAULT FALSE,
    blacklist_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_guest_store_name ON public.guest_profiles (store_uuid, display_name);
CREATE INDEX IF NOT EXISTS idx_guest_phone ON public.guest_profiles (phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.guest_visits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guest_id UUID NOT NULL REFERENCES public.guest_profiles(id) ON DELETE CASCADE,
    store_uuid UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    session_id UUID REFERENCES public.room_sessions(id) ON DELETE SET NULL,
    business_day_id UUID REFERENCES public.store_operating_days(id),
    tags TEXT[] DEFAULT '{}',
    total_amount NUMERIC(14, 2),
    tc_count INT,
    memo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_visits_guest ON public.guest_visits (guest_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visits_session ON public.guest_visits (session_id) WHERE session_id IS NOT NULL;

ALTER TABLE public.waiting_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_visits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "waiting_read_active" ON public.waiting_requests;
CREATE POLICY "waiting_read_active" ON public.waiting_requests FOR SELECT USING (status = 'active');
DROP POLICY IF EXISTS "waiting_own_write" ON public.waiting_requests;
CREATE POLICY "waiting_own_write" ON public.waiting_requests FOR ALL USING (requester_user_id = auth.uid()) WITH CHECK (requester_user_id = auth.uid());
DROP POLICY IF EXISTS "guest_store_member" ON public.guest_profiles;
CREATE POLICY "guest_store_member" ON public.guest_profiles FOR ALL USING (
    EXISTS (SELECT 1 FROM public.store_memberships m
        WHERE m.profile_id = auth.uid() AND m.store_uuid = guest_profiles.store_uuid AND m.status = 'approved')
);
DROP POLICY IF EXISTS "visit_store_member" ON public.guest_visits;
CREATE POLICY "visit_store_member" ON public.guest_visits FOR ALL USING (
    EXISTS (SELECT 1 FROM public.store_memberships m
        WHERE m.profile_id = auth.uid() AND m.store_uuid = guest_visits.store_uuid AND m.status = 'approved')
);

-- ─── 150: 자율 오퍼레이션 (manager_aliases + chat_auto_actions + guest_auto_tags + store_broadcasts) ──
CREATE TABLE IF NOT EXISTS public.manager_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_uuid UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    membership_id UUID NOT NULL REFERENCES public.store_memberships(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    display_name TEXT NOT NULL,
    usage_count INT DEFAULT 0,
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (store_uuid, alias)
);
CREATE INDEX IF NOT EXISTS idx_manager_alias_lookup ON public.manager_aliases (alias, store_uuid);
CREATE INDEX IF NOT EXISTS idx_manager_alias_membership ON public.manager_aliases (membership_id);

CREATE TABLE IF NOT EXISTS public.chat_auto_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_message_id UUID NOT NULL,
    chat_room_id UUID,
    sender_user_id UUID REFERENCES public.profiles(id),
    action_type TEXT NOT NULL,
    parsed_json JSONB,
    ref_id UUID,
    ref_table TEXT,
    status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'skipped', 'failed')),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_auto_message ON public.chat_auto_actions (chat_message_id);
CREATE INDEX IF NOT EXISTS idx_chat_auto_recent ON public.chat_auto_actions (created_at DESC);

CREATE TABLE IF NOT EXISTS public.guest_auto_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.room_sessions(id) ON DELETE CASCADE,
    store_uuid UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    guest_note TEXT,
    tags TEXT[] DEFAULT '{}',
    guest_display_name TEXT,
    matched_guest_id UUID REFERENCES public.guest_profiles(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'matched', 'created', 'skipped')),
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_guest_auto_pending ON public.guest_auto_tags (created_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.store_broadcasts (
    store_uuid UUID PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
    waiting_staff_count INT DEFAULT 0,
    working_staff_count INT DEFAULT 0,
    empty_room_count INT DEFAULT 0,
    active_session_count INT DEFAULT 0,
    status_message TEXT,
    is_available BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID REFERENCES public.profiles(id)
);

ALTER TABLE public.manager_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_auto_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_auto_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_broadcasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manager_alias_read" ON public.manager_aliases;
CREATE POLICY "manager_alias_read" ON public.manager_aliases FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS "manager_alias_own_write" ON public.manager_aliases;
CREATE POLICY "manager_alias_own_write" ON public.manager_aliases FOR ALL USING (
    EXISTS (SELECT 1 FROM public.store_memberships m
        WHERE m.profile_id = auth.uid() AND m.store_uuid = manager_aliases.store_uuid AND m.status = 'approved' AND m.role IN ('owner', 'manager'))
);
DROP POLICY IF EXISTS "chat_auto_own_store" ON public.chat_auto_actions;
CREATE POLICY "chat_auto_own_store" ON public.chat_auto_actions FOR SELECT USING (
    sender_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.store_memberships m
        WHERE m.profile_id = auth.uid() AND m.status = 'approved' AND m.role IN ('owner', 'manager'))
);
DROP POLICY IF EXISTS "guest_auto_store" ON public.guest_auto_tags;
CREATE POLICY "guest_auto_store" ON public.guest_auto_tags FOR ALL USING (
    EXISTS (SELECT 1 FROM public.store_memberships m
        WHERE m.profile_id = auth.uid() AND m.store_uuid = guest_auto_tags.store_uuid AND m.status = 'approved')
);
DROP POLICY IF EXISTS "broadcast_read" ON public.store_broadcasts;
CREATE POLICY "broadcast_read" ON public.store_broadcasts FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS "broadcast_own_write" ON public.store_broadcasts;
CREATE POLICY "broadcast_own_write" ON public.store_broadcasts FOR ALL USING (
    EXISTS (SELECT 1 FROM public.store_memberships m
        WHERE m.profile_id = auth.uid() AND m.store_uuid = store_broadcasts.store_uuid AND m.status = 'approved' AND m.role IN ('owner', 'manager'))
);

-- ═══════════════════════════════════════════════════════════════
-- 완료. 확인:
--   SELECT COUNT(*) FROM push_subscriptions;   -- 0
--   SELECT COUNT(*) FROM sos_events;           -- 0
--   SELECT COUNT(*) FROM ads;                  -- 0
--   SELECT COUNT(*) FROM community_posts;      -- 0
--   SELECT COUNT(*) FROM partner_categories;   -- 6 (시드)
--   SELECT COUNT(*) FROM waiting_requests;     -- 0
--   SELECT COUNT(*) FROM guest_profiles;       -- 0
--   SELECT COUNT(*) FROM manager_aliases;      -- 0
-- ═══════════════════════════════════════════════════════════════
