-- SOS emergency events
--
-- 아가씨/실장이 방 안 응급/컴플레인/도움 필요 시 발동.
-- 매장 owner/manager 에게 즉시 push. 로그 남김 (분쟁 시 증거).
--
-- R-sos (2026-06-28).

CREATE TABLE IF NOT EXISTS public.sos_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_uuid UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    -- 발신자
    sender_user_id UUID NOT NULL REFERENCES public.profiles(id),
    sender_membership_id UUID REFERENCES public.store_memberships(id),
    sender_role TEXT,
    -- 방/세션 (있으면)
    room_uuid UUID REFERENCES public.rooms(id),
    session_id UUID REFERENCES public.room_sessions(id),
    -- 메시지 + 유형 (help/complaint/emergency)
    kind TEXT NOT NULL DEFAULT 'emergency',
    message TEXT,
    -- 상태 lifecycle
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'cancelled')),
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES public.profiles(id),
    resolved_note TEXT,
    -- 시각
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- 응답 시간 계산용
    first_notified_at TIMESTAMPTZ,
    notified_user_ids UUID[] DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_sos_store_active
    ON public.sos_events (store_uuid, created_at DESC)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_sos_sender
    ON public.sos_events (sender_user_id, created_at DESC);

-- RLS
ALTER TABLE public.sos_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sos_events_own_store" ON public.sos_events;
CREATE POLICY "sos_events_own_store"
    ON public.sos_events
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.store_memberships m
            WHERE m.profile_id = auth.uid()
              AND m.store_uuid = sos_events.store_uuid
              AND m.status = 'approved'
        )
    );

COMMENT ON TABLE public.sos_events IS
    'SOS emergency events — kind: help/complaint/emergency. R-sos 2026-06-28.';
