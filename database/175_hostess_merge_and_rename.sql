-- ============================================================
-- Migration 175 (2026-08-23): 아가씨 rename + merge 인프라
-- ============================================================
--
-- 배경:
--   - 채팅 파싱 자동 등록 → 오탈자로 등록되는 경우 발생 ("마블 미언" ← 원래 "미연")
--   - 다른 매장에서 별도 등록 시 1명이 2명으로 분리 → 정산 오류
--
-- 목적:
--   1. rename: 이름만 바꿀 때 alias_learnings 자동 학습
--   2. merge: 2개 membership 을 1개로 통합 · 감사 로그 남김
--
-- ============================================================

-- ── 1. hostess_merge_history ──
-- 아가씨 병합 감사 로그. 롤백 참조용 스냅샷 포함.
CREATE TABLE IF NOT EXISTS hostess_merge_history (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    -- 병합된(사라지는) 쪽
    from_membership_id UUID NOT NULL,       -- soft-deleted 이므로 FK 참조 안 함
    from_profile_id UUID NOT NULL,
    from_hostess_id UUID,                    -- hostesses 테이블 row id (있으면)
    from_store_uuid UUID NOT NULL,
    from_name TEXT NOT NULL,
    -- 유지되는(target) 쪽
    into_membership_id UUID NOT NULL REFERENCES store_memberships(id),
    into_profile_id UUID NOT NULL REFERENCES profiles(id),
    into_hostess_id UUID,
    into_store_uuid UUID NOT NULL REFERENCES stores(id),
    into_name TEXT NOT NULL,
    -- 소급 카운트 (감사)
    reassigned_participants INTEGER NOT NULL DEFAULT 0,
    reassigned_cross_store_records INTEGER NOT NULL DEFAULT 0,
    reassigned_payout_states INTEGER NOT NULL DEFAULT 0,
    reassigned_pattern_dispatches INTEGER NOT NULL DEFAULT 0,
    reassigned_aliases INTEGER NOT NULL DEFAULT 0,
    -- who / when
    merged_by_membership_id UUID NOT NULL REFERENCES store_memberships(id),
    merged_by_profile_id UUID NOT NULL REFERENCES profiles(id),
    merged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason TEXT,
    -- 스냅샷 (JSONB · 롤백 참조용)
    from_snapshot JSONB
);

CREATE INDEX IF NOT EXISTS idx_hostess_merge_history_from
    ON hostess_merge_history (from_membership_id);
CREATE INDEX IF NOT EXISTS idx_hostess_merge_history_into
    ON hostess_merge_history (into_membership_id);
CREATE INDEX IF NOT EXISTS idx_hostess_merge_history_store_time
    ON hostess_merge_history (into_store_uuid, merged_at DESC);

COMMENT ON TABLE hostess_merge_history IS
    '아가씨 membership 병합 감사 로그. from → into 방향. from 은 soft-deleted 후 유지.';

-- ── 2. profiles / memberships / hostesses 에 merged_into 컬럼 ──
-- (soft delete 만으로는 왜 지워졌는지 안 보임 · pointer 추가)
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS merged_into_membership_id UUID REFERENCES store_memberships(id);

ALTER TABLE store_memberships
    ADD COLUMN IF NOT EXISTS merged_into_membership_id UUID REFERENCES store_memberships(id);

-- hostesses 테이블 존재하면
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'hostesses') THEN
        EXECUTE 'ALTER TABLE hostesses ADD COLUMN IF NOT EXISTS merged_into_membership_id UUID REFERENCES store_memberships(id)';
    END IF;
END $$;

COMMENT ON COLUMN profiles.merged_into_membership_id IS
    'null 아님 = 이 profile 은 병합됨 · 실제 데이터는 참조된 membership 소속 profile 에';

-- ── 끝 ──
