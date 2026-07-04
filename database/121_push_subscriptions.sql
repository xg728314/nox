-- Push notification subscriptions
--
-- Web Push (VAPID) subscribe endpoint 를 사용자별로 저장.
-- 브라우저마다 endpoint 다름 → user + endpoint 조합 unique.
--
-- 정책:
--   - 사용자가 여러 기기 (폰/PC/태블릿) 로그인 → 각각 별도 row.
--   - 사용자가 브라우저 데이터 지우면 endpoint 재발급됨 → 옛 row 는 stale.
--   - server 가 push 전송 실패 (410 Gone) 시 그 row 삭제.
--
-- R-push (2026-06-28): 임박 알림 + dispatch 알림 + 정산 push 인프라.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    p256dh_key TEXT NOT NULL,
    auth_key TEXT NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- 마지막 push 성공 / 실패
    last_success_at TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    last_failure_code INT,
    UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
    ON public.push_subscriptions (user_id);

-- RLS — 각 사용자 본인 row 만 조회/수정. service_role 은 모두.
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_subscriptions_own" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_own"
    ON public.push_subscriptions
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE public.push_subscriptions IS
    'Web Push (VAPID) subscribe endpoints per user. R-push 2026-06-28.';
