-- ============================================================
-- credits (외상)
-- 3종 구조: 방 + 담당실장 + 손님정보(이름, 연락처)
-- closing 이후에도 외상으로 전환 가능
-- 고객 DB로 활용 가능
-- ============================================================
CREATE TABLE IF NOT EXISTS credits (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    store_uuid UUID NOT NULL REFERENCES stores(id),
    session_id UUID REFERENCES room_sessions(id),
    receipt_id UUID REFERENCES receipts(id),
    business_day_id UUID REFERENCES store_operating_days(id),

    -- 3종 구조
    room_uuid UUID NOT NULL REFERENCES rooms(id),
    manager_membership_id UUID NOT NULL REFERENCES store_memberships(id),
    customer_name TEXT NOT NULL,
    customer_phone TEXT,

    -- 금액
    amount INTEGER NOT NULL DEFAULT 0,
    memo TEXT,

    -- 상태: pending(미회수) → collected(회수완료) / cancelled(취소)
    status TEXT NOT NULL DEFAULT 'pending',

    collected_at TIMESTAMPTZ,
    collected_by UUID REFERENCES profiles(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- 매장별 외상 조회 인덱스
CREATE INDEX IF NOT EXISTS idx_credits_store_uuid ON credits(store_uuid);
CREATE INDEX IF NOT EXISTS idx_credits_status ON credits(store_uuid, status);
CREATE INDEX IF NOT EXISTS idx_credits_customer ON credits(store_uuid, customer_name);
