-- ═══════════════════════════════════════════════════════════════
-- Marketplace Layer — 채용 광고 · 커뮤니티 · 초이스톡 · 플레이스
--   미드나잇테라스 / 버블알바 기능 통합.
--   R-marketplace (2026-07-05).
-- ═══════════════════════════════════════════════════════════════

-- ─── 1. 채용/업소 광고 (버블알바 홍보 게시판) ─────────────────
CREATE TABLE IF NOT EXISTS public.ads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_uuid UUID REFERENCES public.stores(id) ON DELETE SET NULL,
    advertiser_user_id UUID NOT NULL REFERENCES public.profiles(id),
    title TEXT NOT NULL,
    body TEXT,
    -- 종목 (텐쩜오/룸싸롱/퍼블릭/하이퍼블릭/호스트/기타)
    category TEXT NOT NULL,
    -- 지역 (서울/부산/… + 세부 구/동)
    region_top TEXT,        -- '서울'
    region_sub TEXT,        -- '강남구'
    region_detail TEXT,     -- '역삼동'
    -- 금액 (티씨)
    tc_amount INT,          -- 만원 단위
    tc_currency TEXT DEFAULT 'KRW',
    -- 미디어
    thumbnail_url TEXT,
    image_urls TEXT[] DEFAULT '{}',
    -- 라이프사이클
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('draft','active','paused','expired','banned')),
    start_at TIMESTAMPTZ DEFAULT NOW(),
    end_at TIMESTAMPTZ,
    -- 지표
    view_count INT DEFAULT 0,
    like_count INT DEFAULT 0,
    contact_click_count INT DEFAULT 0,
    -- 연락 (별도 노출 컨트롤)
    contact_phone TEXT,
    contact_kakao TEXT,
    show_business_info BOOLEAN DEFAULT TRUE,
    -- pin/추천
    is_pinned BOOLEAN DEFAULT FALSE,
    pinned_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ads_status_category
    ON public.ads (status, category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ads_region
    ON public.ads (region_top, region_sub);
CREATE INDEX IF NOT EXISTS idx_ads_advertiser
    ON public.ads (advertiser_user_id, status);
CREATE INDEX IF NOT EXISTS idx_ads_pinned
    ON public.ads (is_pinned, pinned_until)
    WHERE is_pinned = TRUE;

-- ─── 2. 커뮤니티 게시판 (라운지) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.community_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_user_id UUID NOT NULL REFERENCES public.profiles(id),
    author_nickname TEXT,
    -- 게시판 slug — free/hot/promo/corporate/life 등
    board TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    image_urls TEXT[] DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',
    -- 지표
    view_count INT DEFAULT 0,
    like_count INT DEFAULT 0,
    comment_count INT DEFAULT 0,
    -- 상태
    is_notice BOOLEAN DEFAULT FALSE,
    is_hidden BOOLEAN DEFAULT FALSE,
    hidden_reason TEXT,
    -- 인기 계산용 (score = f(likes, comments, views, time))
    hot_score NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_community_posts_board_time
    ON public.community_posts (board, created_at DESC)
    WHERE is_hidden = FALSE;
CREATE INDEX IF NOT EXISTS idx_community_posts_hot
    ON public.community_posts (hot_score DESC)
    WHERE is_hidden = FALSE;
CREATE INDEX IF NOT EXISTS idx_community_posts_author
    ON public.community_posts (author_user_id, created_at DESC);

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
CREATE INDEX IF NOT EXISTS idx_community_comments_post
    ON public.community_comments (post_id, created_at ASC)
    WHERE is_hidden = FALSE;

CREATE TABLE IF NOT EXISTS public.community_likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('post','comment','ad')),
    target_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_community_likes_target
    ON public.community_likes (target_type, target_id);

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
CREATE INDEX IF NOT EXISTS idx_community_reports_pending
    ON public.community_reports (created_at DESC)
    WHERE status = 'pending';

-- ─── 3. 초이스톡 (매칭 채팅) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.choice_talk_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    initiator_user_id UUID NOT NULL REFERENCES public.profiles(id),
    counterparty_user_id UUID REFERENCES public.profiles(id),
    ad_id UUID REFERENCES public.ads(id) ON DELETE SET NULL,
    -- 태그 (지역/종목/조건) — 매칭 필터용
    region_tag TEXT,
    category_tag TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active','archived','blocked')),
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    initiator_unread INT DEFAULT 0,
    counterparty_unread INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_choice_talk_participant
    ON public.choice_talk_rooms (initiator_user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_choice_talk_counter
    ON public.choice_talk_rooms (counterparty_user_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.choice_talk_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES public.choice_talk_rooms(id) ON DELETE CASCADE,
    sender_user_id UUID NOT NULL REFERENCES public.profiles(id),
    body TEXT,
    image_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_choice_talk_messages_room
    ON public.choice_talk_messages (room_id, created_at ASC);

-- ─── 4. 플레이스 (파트너 서비스 카테고리) ─────────────────────
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
CREATE INDEX IF NOT EXISTS idx_partners_category
    ON public.partners (category_id, is_featured DESC, created_at DESC)
    WHERE status = 'active';

-- 기본 6개 카테고리 시드
INSERT INTO public.partner_categories (slug, name, icon, display_order, is_new, color_hex)
VALUES
    ('hair', '헤어·메이크업', '💄', 1, FALSE, '#B197FC'),
    ('cosmetic', '성형·시술', '💉', 2, TRUE, '#FF87B2'),
    ('fashion', '홀복·패션', '👗', 3, TRUE, '#FF6B9D'),
    ('nail', '라이프 스타일', '💅', 4, TRUE, '#FFA94D'),
    ('event', '이벤트 & 혜택', '🎁', 5, TRUE, '#FFD43B'),
    ('review', '자유 톡 · 리뷰', '💬', 6, TRUE, '#4DABF7')
ON CONFLICT (slug) DO NOTHING;

-- ─── 5. 광고주 프로필 · 사업자 정보 ───────────────────────────
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

-- ─── 6. 포인트 (광고비 / 유료 노출) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.points_balance (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    balance INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.points_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    amount INT NOT NULL,       -- + 충전 / - 사용
    balance_after INT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('topup','ad_spend','pin_boost','refund','adjustment')),
    ref_type TEXT,             -- 'ad' / 'partner' 등
    ref_id UUID,
    memo TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_points_tx_user
    ON public.points_transactions (user_id, created_at DESC);

-- ─── 7. 실시간현황 확장 — store_status_info ──────────────────
-- 기존 stores 재사용 + 실시간 표시 정보 저장.
CREATE TABLE IF NOT EXISTS public.store_status_info (
    store_uuid UUID PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
    -- '9시 전 +1 / 24시 영업 / 일요일 헤메 무료' 같은 자유 텍스트
    live_note TEXT,
    -- 24h 영업 여부
    is_24h BOOLEAN DEFAULT FALSE,
    -- 오늘 이벤트 (배너 텍스트)
    event_text TEXT,
    -- 종목 태그 (multiple)
    category_tags TEXT[] DEFAULT '{}',
    -- 지역 표시 (강남 선릉, 강남 논현 등)
    region_display TEXT,
    -- NEW / HOT badge
    badge TEXT,
    -- 시급/초중 표시 ('초중 5이상' 등)
    entry_level TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 8. 사용자 프로필 확장 — 닉네임 · 아바타 · 지역 ──────────
-- 커뮤니티/광고에서 사용할 익명 표기용.
CREATE TABLE IF NOT EXISTS public.user_public_profiles (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    nickname TEXT UNIQUE,
    avatar_url TEXT,
    avatar_color TEXT,
    bio TEXT,
    region_top TEXT,
    role_tag TEXT,             -- '실장','아가씨','업소','일반'
    is_verified BOOLEAN DEFAULT FALSE,
    is_banned BOOLEAN DEFAULT FALSE,
    banned_until TIMESTAMPTZ,
    banned_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 9. RLS ─────────────────────────────────────────────────
-- 앱은 service-role 로 접근 → 실제 정책은 read-only 유저 대비 관대하게.
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

-- 공개 읽기 (ads active / posts 공개 / partners active)
DROP POLICY IF EXISTS "ads_read_public" ON public.ads;
CREATE POLICY "ads_read_public" ON public.ads FOR SELECT
    USING (status IN ('active','paused'));

DROP POLICY IF EXISTS "posts_read_public" ON public.community_posts;
CREATE POLICY "posts_read_public" ON public.community_posts FOR SELECT
    USING (is_hidden = FALSE);

DROP POLICY IF EXISTS "comments_read_public" ON public.community_comments;
CREATE POLICY "comments_read_public" ON public.community_comments FOR SELECT
    USING (is_hidden = FALSE);

DROP POLICY IF EXISTS "partners_read_public" ON public.partners;
CREATE POLICY "partners_read_public" ON public.partners FOR SELECT
    USING (status = 'active');

DROP POLICY IF EXISTS "user_public_read" ON public.user_public_profiles;
CREATE POLICY "user_public_read" ON public.user_public_profiles FOR SELECT
    USING (TRUE);

-- 본인 소유 write
DROP POLICY IF EXISTS "ads_own_write" ON public.ads;
CREATE POLICY "ads_own_write" ON public.ads FOR ALL
    USING (advertiser_user_id = auth.uid())
    WITH CHECK (advertiser_user_id = auth.uid());

DROP POLICY IF EXISTS "posts_own_write" ON public.community_posts;
CREATE POLICY "posts_own_write" ON public.community_posts FOR ALL
    USING (author_user_id = auth.uid())
    WITH CHECK (author_user_id = auth.uid());

DROP POLICY IF EXISTS "comments_own_write" ON public.community_comments;
CREATE POLICY "comments_own_write" ON public.community_comments FOR ALL
    USING (author_user_id = auth.uid())
    WITH CHECK (author_user_id = auth.uid());

DROP POLICY IF EXISTS "likes_own" ON public.community_likes;
CREATE POLICY "likes_own" ON public.community_likes FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "advertiser_profiles_own" ON public.advertiser_profiles;
CREATE POLICY "advertiser_profiles_own" ON public.advertiser_profiles FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "points_balance_own" ON public.points_balance;
CREATE POLICY "points_balance_own" ON public.points_balance FOR SELECT
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "points_tx_own" ON public.points_transactions;
CREATE POLICY "points_tx_own" ON public.points_transactions FOR SELECT
    USING (user_id = auth.uid());

-- 초이스톡 참여자만
DROP POLICY IF EXISTS "choice_talk_participant" ON public.choice_talk_rooms;
CREATE POLICY "choice_talk_participant" ON public.choice_talk_rooms FOR ALL
    USING (initiator_user_id = auth.uid() OR counterparty_user_id = auth.uid());

DROP POLICY IF EXISTS "choice_talk_msg_participant" ON public.choice_talk_messages;
CREATE POLICY "choice_talk_msg_participant" ON public.choice_talk_messages FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.choice_talk_rooms r
            WHERE r.id = room_id
              AND (r.initiator_user_id = auth.uid() OR r.counterparty_user_id = auth.uid())
        )
    );

DROP POLICY IF EXISTS "user_public_own_write" ON public.user_public_profiles;
CREATE POLICY "user_public_own_write" ON public.user_public_profiles FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE public.ads IS 'Marketplace: 매장/업소 채용/홍보 광고. R-marketplace 2026-07-05.';
COMMENT ON TABLE public.community_posts IS 'Marketplace: 라운지/커뮤니티 게시글.';
COMMENT ON TABLE public.choice_talk_rooms IS 'Marketplace: 초이스톡 매칭 1:1 채팅방.';
COMMENT ON TABLE public.partners IS 'Marketplace: 플레이스 파트너 (헤어/성형/네일/이벤트/리뷰 등).';
COMMENT ON TABLE public.advertiser_profiles IS 'Marketplace: 광고주 사업자 정보.';
COMMENT ON TABLE public.points_balance IS 'Marketplace: 광고비 포인트 잔액.';
COMMENT ON TABLE public.store_status_info IS 'Marketplace: 매장 실시간현황 표시 정보.';
COMMENT ON TABLE public.user_public_profiles IS 'Marketplace: 익명 커뮤니티 프로필 (닉네임/아바타).';
