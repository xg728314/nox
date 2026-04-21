-- DEPRECATED: 이 파일은 폐기됨.
-- 실제 스키마는 002_actual_schema.sql 참조
--
-- NOX MVP Initial Schema
-- Based on: NOX_ERD_MVP.md (LOCKED)
-- RLS: disabled for MVP
-- All tables use UUID primary keys
-- store_uuid scope enforced on all business tables

-- ============================================================
-- 1. users
-- ============================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    display_name TEXT NOT NULL,
    auth_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (auth_status IN ('pending', 'approved', 'rejected', 'suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);

-- ============================================================
-- 2. stores
-- ============================================================
CREATE TABLE stores (
    store_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. store_memberships
-- ============================================================
CREATE TABLE store_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    store_uuid UUID NOT NULL REFERENCES stores(store_uuid),
    role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'hostess')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 4. floors
-- ============================================================
CREATE TABLE floors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_uuid UUID NOT NULL REFERENCES stores(store_uuid),
    floor_no INTEGER NOT NULL,
    floor_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 5. rooms
-- ============================================================
CREATE TABLE rooms (
    room_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_uuid UUID NOT NULL REFERENCES stores(store_uuid),
    floor_id UUID NOT NULL REFERENCES floors(id),
    room_no INTEGER NOT NULL,
    room_name TEXT,
    room_status TEXT NOT NULL DEFAULT 'empty'
        CHECK (room_status IN ('empty', 'occupied')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 6. sessions
-- ============================================================
CREATE TABLE sessions (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_uuid UUID NOT NULL REFERENCES stores(store_uuid),
    room_uuid UUID NOT NULL REFERENCES rooms(room_uuid),
    business_date DATE NOT NULL,
    session_status TEXT NOT NULL DEFAULT 'active'
        CHECK (session_status IN ('active', 'ended')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id),
    ended_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Constraint: 동일 room_uuid에 active session 중복 금지
CREATE UNIQUE INDEX uq_sessions_active_room
    ON sessions (room_uuid)
    WHERE session_status = 'active';

-- ============================================================
-- 7. session_participants
-- ============================================================
CREATE TABLE session_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(session_id),
    store_uuid UUID NOT NULL REFERENCES stores(store_uuid),
    participant_type TEXT NOT NULL
        CHECK (participant_type IN ('customer', 'hostess', 'manager')),
    membership_id UUID REFERENCES store_memberships(id),
    display_name TEXT,
    customer_headcount INTEGER,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at TIMESTAMPTZ,
    participant_status TEXT NOT NULL DEFAULT 'active'
        CHECK (participant_status IN ('active', 'left')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 8. menu_items
-- ============================================================
CREATE TABLE menu_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_uuid UUID NOT NULL REFERENCES stores(store_uuid),
    item_name TEXT NOT NULL,
    item_type TEXT NOT NULL
        CHECK (item_type IN ('liquor', 'beer', 'beverage')),
    unit_price INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 9. orders
-- ============================================================
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(session_id),
    store_uuid UUID NOT NULL REFERENCES stores(store_uuid),
    business_date DATE NOT NULL,
    menu_item_id UUID NOT NULL REFERENCES menu_items(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price_snapshot INTEGER NOT NULL,
    line_total INTEGER NOT NULL,
    ordered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 10. settlements
-- ============================================================
CREATE TABLE settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(session_id),
    store_uuid UUID NOT NULL REFERENCES stores(store_uuid),
    business_date DATE NOT NULL,
    total_duration_minutes INTEGER NOT NULL DEFAULT 0,
    customer_payment INTEGER NOT NULL DEFAULT 0,
    hostess_payout INTEGER NOT NULL DEFAULT 0,
    manager_share INTEGER NOT NULL DEFAULT 0,
    owner_profit INTEGER NOT NULL DEFAULT 0,
    pricing_rule_snapshot JSONB,
    settlement_status TEXT NOT NULL DEFAULT 'draft'
        CHECK (settlement_status IN ('draft', 'finalized')),
    settled_at TIMESTAMPTZ,
    settled_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Constraint: 동일 session_id에 settlement 중복 금지
CREATE UNIQUE INDEX uq_settlements_session
    ON settlements (session_id);

-- ============================================================
-- 11. action_logs
-- ============================================================
CREATE TABLE action_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_uuid UUID NOT NULL REFERENCES stores(store_uuid),
    business_date DATE NOT NULL,
    actor_membership_id UUID REFERENCES store_memberships(id),
    action_type TEXT NOT NULL,
    target_type TEXT,
    target_id UUID,
    action_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 12. INDEXES (ERD Section 7)
-- ============================================================
CREATE INDEX idx_store_memberships_user_store
    ON store_memberships (user_id, store_uuid);

CREATE INDEX idx_rooms_store
    ON rooms (store_uuid, room_uuid);

CREATE INDEX idx_rooms_store_no
    ON rooms (store_uuid, room_no);

CREATE INDEX idx_sessions_store_room_status
    ON sessions (store_uuid, room_uuid, session_status);

CREATE INDEX idx_sessions_store_date
    ON sessions (store_uuid, business_date);

CREATE INDEX idx_orders_store_session
    ON orders (store_uuid, session_id);

CREATE INDEX idx_settlements_store_session
    ON settlements (store_uuid, session_id);

CREATE INDEX idx_action_logs_store_date
    ON action_logs (store_uuid, business_date);

-- ============================================================
-- RLS: disabled for MVP
-- ============================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY "disabled_for_mvp" ON users USING (true) WITH CHECK (true);

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores FORCE ROW LEVEL SECURITY;
CREATE POLICY "disabled_for_mvp" ON stores USING (true) WITH CHECK (true);

ALTER TABLE store_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY "disabled_for_mvp" ON store_memberships USING (true) WITH CHECK (true);

ALTER TABLE floors ENABLE ROW LEVEL SECURITY;
ALTER TABLE floors FORCE ROW LEVEL SECURITY;
CREATE POLICY "disabled_for_mvp" ON floors USING (true) WITH CHECK (true);

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms FORCE ROW LEVEL SECURITY;
CREATE POLICY "disabled_for_mvp" ON rooms USING (true) WITH CHECK (true);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY "disabled_for_mvp" ON sessions USING (true) WITH CHECK (true);

ALTER TABLE session_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_participants FORCE ROW LEVEL SECURITY;
CREATE POLICY "disabled_for_mvp" ON session_participants USING (true) WITH CHECK (true);

ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items FORCE ROW LEVEL SECURITY;
CREATE POLICY "disabled_for_mvp" ON menu_items USING (true) WITH CHECK (true);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;
CREATE POLICY "disabled_for_mvp" ON orders USING (true) WITH CHECK (true);

ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements FORCE ROW LEVEL SECURITY;
CREATE POLICY "disabled_for_mvp" ON settlements USING (true) WITH CHECK (true);

ALTER TABLE action_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY "disabled_for_mvp" ON action_logs USING (true) WITH CHECK (true);
