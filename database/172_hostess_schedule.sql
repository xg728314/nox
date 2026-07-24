-- ============================================================
-- 172_hostess_schedule
-- ============================================================
-- 2026-07-24 R-hostess-detail:
--   아가씨 일정 관리표 (휴가/오프/특이사항) · 같은 매장 실장/사장 간 공유.
--
--   지급 방식 (payout_method + 계좌 정보) 는 이미 store_memberships +
--   membership_bank_accounts 로 구현되어 있음 (see /api/manager/hostesses/[id]/info).
--   이 파일은 schedule 만.
-- ============================================================

CREATE TABLE IF NOT EXISTS hostess_schedules (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    hostess_membership_id UUID NOT NULL REFERENCES store_memberships(id) ON DELETE CASCADE,
    store_uuid UUID NOT NULL REFERENCES stores(id),
    schedule_type TEXT NOT NULL CHECK (schedule_type IN ('vacation', 'off', 'sick', 'other')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    note TEXT,
    created_by_membership_id UUID NOT NULL REFERENCES store_memberships(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_hostess_schedules_hostess_active
    ON hostess_schedules (hostess_membership_id, start_date DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hostess_schedules_store_active
    ON hostess_schedules (store_uuid, end_date DESC)
    WHERE deleted_at IS NULL;

COMMENT ON TABLE hostess_schedules IS 'R-hostess-detail: 아가씨 일정 (휴가/오프/특이사항). 실장간 공유.';
COMMENT ON COLUMN hostess_schedules.schedule_type IS 'vacation=휴가 · off=오프 · sick=병가 · other=기타';
