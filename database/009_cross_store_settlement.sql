CREATE TABLE IF NOT EXISTS cross_store_work_records (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES room_sessions(id),
    business_day_id UUID REFERENCES store_operating_days(id),
    working_store_uuid UUID NOT NULL REFERENCES stores(id),
    origin_store_uuid UUID NOT NULL REFERENCES stores(id),
    hostess_membership_id UUID NOT NULL REFERENCES store_memberships(id),
    requested_by UUID REFERENCES profiles(id),
    approved_by UUID REFERENCES profiles(id),
    approved_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cswr_working ON cross_store_work_records(working_store_uuid, status);
CREATE INDEX IF NOT EXISTS idx_cswr_origin ON cross_store_work_records(origin_store_uuid, status);
CREATE INDEX IF NOT EXISTS idx_cswr_session ON cross_store_work_records(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cswr_unique
    ON cross_store_work_records(session_id, hostess_membership_id) WHERE deleted_at IS NULL;

ALTER TABLE session_participants ADD COLUMN IF NOT EXISTS origin_store_uuid UUID REFERENCES stores(id);
