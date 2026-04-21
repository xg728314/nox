-- 014_customers.sql
-- 손님(customer) 마스터 테이블 + room_session 연결 필드

-- 1. customers 테이블
CREATE TABLE IF NOT EXISTS customers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_uuid  UUID NOT NULL REFERENCES stores(id),
    name        TEXT NOT NULL,
    phone       TEXT,                          -- nullable, 정규화된 번호(숫자만)
    memo        TEXT,                          -- nullable
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_store ON customers(store_uuid);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(store_uuid, phone) WHERE phone IS NOT NULL;

-- 2. room_sessions에 손님 연결 필드 추가
ALTER TABLE room_sessions ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);
ALTER TABLE room_sessions ADD COLUMN IF NOT EXISTS customer_name_snapshot TEXT;
ALTER TABLE room_sessions ADD COLUMN IF NOT EXISTS customer_party_size INTEGER NOT NULL DEFAULT 0;
