-- ═══════════════════════════════════════════════════════════════
-- Inter-Store 통합 채팅방 (2026-07-08)
--   매장 간 통합 채팅 — 카톡 완전 대체 목적.
--   store_uuid NULL 허용 + type='inter_store' 신규.
--   ALL owner/manager 자동 접근 (chat_participants JOIN 불필요, validator 에서 처리).
-- ═══════════════════════════════════════════════════════════════

-- 1. store_uuid NULL 허용
ALTER TABLE public.chat_rooms
    ALTER COLUMN store_uuid DROP NOT NULL;

-- 2. inter_store type 유니크 (한 개만 존재)
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_rooms_inter_store_unique
    ON public.chat_rooms ((1))
    WHERE type = 'inter_store' AND is_active = TRUE;

-- 3. 통합 채팅방 시드 (하나만)
INSERT INTO public.chat_rooms (
    id,
    store_uuid,
    type,
    name,
    is_active,
    created_at,
    updated_at
)
SELECT
    gen_random_uuid(),
    NULL,
    'inter_store',
    '🏢 실장 통합 톡 (전 매장)',
    TRUE,
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM public.chat_rooms
    WHERE type = 'inter_store' AND is_active = TRUE
);

-- pattern_enabled 컬럼 있으면 활성화
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'chat_rooms'
          AND column_name = 'pattern_enabled'
    ) THEN
        UPDATE public.chat_rooms
        SET pattern_enabled = TRUE
        WHERE type = 'inter_store';
    END IF;
END $$;

COMMENT ON INDEX public.idx_chat_rooms_inter_store_unique IS
    'inter_store 채팅방은 시스템 전체에 오직 하나만 존재 (활성).';

-- 확인:
--   SELECT id, type, store_uuid, name FROM chat_rooms WHERE type = 'inter_store';
