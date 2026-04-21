CREATE TABLE IF NOT EXISTS pre_settlements (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    store_uuid UUID NOT NULL REFERENCES stores(id),
    session_id UUID NOT NULL REFERENCES room_sessions(id),
    business_day_id UUID REFERENCES store_operating_days(id),

    amount INTEGER NOT NULL DEFAULT 0,
    memo TEXT,

    requester_membership_id UUID NOT NULL REFERENCES store_memberships(id),
    executor_membership_id UUID NOT NULL REFERENCES store_memberships(id),

    status TEXT NOT NULL DEFAULT 'active',
    deducted_at TIMESTAMPTZ,
    deducted_receipt_id UUID REFERENCES receipts(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pre_settlements_session
    ON pre_settlements(session_id, store_uuid);
CREATE INDEX IF NOT EXISTS idx_pre_settlements_store
    ON pre_settlements(store_uuid, status);

ALTER TABLE receipts ADD COLUMN IF NOT EXISTS pre_settlement_total INTEGER NOT NULL DEFAULT 0;
