-- ============================================================
-- NOX Actual DB Schema
-- Extracted from: Supabase REST API OpenAPI spec
-- Date: 2026-04-11
-- Total tables: 23
-- NOTE: This reflects the REAL Supabase DB, not the old
--       001_initial_schema.sql which is outdated.
-- ============================================================

-- ============================================================
-- 1. profiles
-- ============================================================
CREATE TABLE profiles (
    id UUID NOT NULL PRIMARY KEY,
    full_name TEXT,
    phone TEXT,
    nickname TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- ============================================================
-- 2. stores
-- ============================================================
CREATE TABLE stores (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    store_name TEXT NOT NULL,
    store_code TEXT,
    floor INTEGER,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- ============================================================
-- 3. store_memberships
-- ============================================================
CREATE TABLE store_memberships (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    profile_id UUID NOT NULL REFERENCES profiles(id),
    store_uuid UUID NOT NULL REFERENCES stores(id),
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    is_primary BOOLEAN NOT NULL DEFAULT true,
    approved_by UUID REFERENCES profiles(id),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- ============================================================
-- 4. store_settings
-- ============================================================
CREATE TABLE store_settings (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    store_uuid UUID NOT NULL REFERENCES stores(id),
    tc_rate NUMERIC NOT NULL DEFAULT 0.2,
    manager_payout_rate NUMERIC NOT NULL DEFAULT 0.7,
    hostess_payout_rate NUMERIC NOT NULL DEFAULT 0.1,
    payout_basis TEXT NOT NULL DEFAULT 'netOfTC',
    rounding_unit INTEGER NOT NULL DEFAULT 1000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- ============================================================
-- 5. store_operating_days
-- ============================================================
CREATE TABLE store_operating_days (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    store_uuid UUID NOT NULL REFERENCES stores(id),
    business_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ,
    opened_by UUID REFERENCES profiles(id),
    closed_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- ============================================================
-- 6. rooms
-- ============================================================
CREATE TABLE rooms (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    store_uuid UUID NOT NULL REFERENCES stores(id),
    room_no TEXT NOT NULL,
    room_name TEXT,
    floor_no INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- ============================================================
-- 7. room_sessions
-- ============================================================
CREATE TABLE room_sessions (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    store_uuid UUID NOT NULL REFERENCES stores(id),
    room_uuid UUID NOT NULL REFERENCES rooms(id),
    business_day_id UUID NOT NULL REFERENCES store_operating_days(id),
    status TEXT NOT NULL DEFAULT 'active',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    opened_by UUID REFERENCES profiles(id),
    closed_by UUID REFERENCES profiles(id),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- ============================================================
-- 8. managers
-- ============================================================
CREATE TABLE managers (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    store_uuid UUID NOT NULL REFERENCES stores(id),
    membership_id UUID NOT NULL REFERENCES store_memberships(id),
    name TEXT NOT NULL,
    nickname TEXT,
    phone TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- ============================================================
-- 9. hostesses
-- ============================================================
CREATE TABLE hostesses (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    store_uuid UUID NOT NULL REFERENCES stores(id),
    membership_id UUID NOT NULL REFERENCES store_memberships(id),
    manager_membership_id UUID REFERENCES store_memberships(id),
    name TEXT NOT NULL,
    stage_name TEXT,
    category TEXT,
    phone TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- ============================================================
-- 10. transfer_requests
-- ============================================================
CREATE TABLE transfer_requests (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    hostess_membership_id UUID NOT NULL REFERENCES store_memberships(id),
    from_store_uuid UUID NOT NULL REFERENCES stores(id),
    to_store_uuid UUID NOT NULL REFERENCES stores(id),
    business_day_id UUID REFERENCES store_operating_days(id),
    status TEXT NOT NULL DEFAULT 'pending',
    from_store_approved_by UUID REFERENCES profiles(id),
    from_store_approved_at TIMESTAMPTZ,
    to_store_approved_by UUID REFERENCES profiles(id),
    to_store_approved_at TIMESTAMPTZ,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 11. session_participants
-- ============================================================
CREATE TABLE session_participants (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES room_sessions(id),
    store_uuid UUID NOT NULL REFERENCES stores(id),
    membership_id UUID NOT NULL REFERENCES store_memberships(id),
    transfer_request_id UUID REFERENCES transfer_requests(id),
    role TEXT NOT NULL,
    category TEXT,
    time_minutes INTEGER NOT NULL DEFAULT 0,
    price_amount INTEGER NOT NULL DEFAULT 0,
    manager_payout_amount INTEGER NOT NULL DEFAULT 0,
    hostess_payout_amount INTEGER NOT NULL DEFAULT 0,
    margin_amount INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at TIMESTAMPTZ,
    memo TEXT,
    manager_membership_id UUID REFERENCES store_memberships(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- ============================================================
-- 12. participant_time_segments
-- WARNING: 코드 미참조 테이블. 삭제 전 확인 필요
-- ============================================================
CREATE TABLE participant_time_segments (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    participant_id UUID NOT NULL REFERENCES session_participants(id),
    session_id UUID NOT NULL REFERENCES room_sessions(id),
    store_uuid UUID NOT NULL REFERENCES stores(id),
    room_uuid UUID NOT NULL REFERENCES rooms(id),
    entered_at TIMESTAMPTZ NOT NULL,
    exited_at TIMESTAMPTZ,
    source TEXT NOT NULL,
    category TEXT,
    time_minutes INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 13. orders
-- ============================================================
CREATE TABLE orders (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES room_sessions(id),
    store_uuid UUID NOT NULL REFERENCES stores(id),
    business_day_id UUID NOT NULL REFERENCES store_operating_days(id),
    item_name TEXT,
    order_type TEXT,
    qty INTEGER NOT NULL DEFAULT 1,
    unit_price INTEGER NOT NULL DEFAULT 0,
    ordered_by UUID REFERENCES profiles(id),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- ============================================================
-- 14. receipts
-- ============================================================
CREATE TABLE receipts (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES room_sessions(id),
    store_uuid UUID NOT NULL REFERENCES stores(id),
    business_day_id UUID NOT NULL REFERENCES store_operating_days(id),
    version INTEGER NOT NULL DEFAULT 1,
    gross_total INTEGER NOT NULL DEFAULT 0,
    tc_amount INTEGER NOT NULL DEFAULT 0,
    manager_amount INTEGER NOT NULL DEFAULT 0,
    hostess_amount INTEGER NOT NULL DEFAULT 0,
    margin_amount INTEGER NOT NULL DEFAULT 0,
    order_total_amount INTEGER NOT NULL DEFAULT 0,
    participant_total_amount INTEGER NOT NULL DEFAULT 0,
    discount_amount INTEGER NOT NULL DEFAULT 0,
    service_amount INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    finalized_at TIMESTAMPTZ,
    finalized_by UUID REFERENCES profiles(id),
    snapshot JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 15. receipt_snapshots
-- ============================================================
CREATE TABLE receipt_snapshots (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES room_sessions(id),
    store_uuid UUID NOT NULL REFERENCES stores(id),
    room_uuid UUID NOT NULL REFERENCES rooms(id),
    receipt_id UUID REFERENCES receipts(id),
    snapshot JSONB NOT NULL,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 16. closing_reports
-- ============================================================
CREATE TABLE closing_reports (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    store_uuid UUID NOT NULL REFERENCES stores(id),
    business_day_id UUID NOT NULL REFERENCES store_operating_days(id),
    status TEXT NOT NULL DEFAULT 'confirmed',
    summary JSONB NOT NULL,
    notes TEXT,
    created_by UUID REFERENCES profiles(id),
    confirmed_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- ============================================================
-- 17. audit_events
-- ============================================================
CREATE TABLE audit_events (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    store_uuid UUID NOT NULL REFERENCES stores(id),
    actor_profile_id UUID NOT NULL REFERENCES profiles(id),
    actor_membership_id UUID REFERENCES store_memberships(id),
    actor_role TEXT NOT NULL,
    actor_type TEXT,
    session_id UUID REFERENCES room_sessions(id),
    room_uuid UUID REFERENCES rooms(id),
    entity_table TEXT NOT NULL,
    entity_id UUID NOT NULL,
    action TEXT NOT NULL,
    before JSONB,
    after JSONB,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 18. ble_gateways
-- ============================================================
CREATE TABLE ble_gateways (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    store_uuid UUID NOT NULL REFERENCES stores(id),
    gateway_id TEXT NOT NULL,
    gateway_secret TEXT NOT NULL,
    room_uuid UUID REFERENCES rooms(id),
    display_name TEXT,
    gateway_type TEXT NOT NULL DEFAULT 'room',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 19. ble_tags
-- ============================================================
CREATE TABLE ble_tags (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    store_uuid UUID NOT NULL REFERENCES stores(id),
    minor INTEGER NOT NULL,
    membership_id UUID REFERENCES store_memberships(id),
    tag_label TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 20. ble_ingest_events
-- ============================================================
CREATE TABLE ble_ingest_events (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    gateway_id TEXT NOT NULL,
    store_uuid UUID REFERENCES stores(id),
    room_uuid UUID REFERENCES rooms(id),
    beacon_minor INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    rssi INTEGER,
    observed_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    meta JSONB NOT NULL
);

-- ============================================================
-- 23. staff_attendance (STEP 6 추가)
-- ============================================================
CREATE TABLE staff_attendance (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    store_uuid UUID NOT NULL REFERENCES stores(id),
    business_day_id UUID NOT NULL REFERENCES store_operating_days(id),
    membership_id UUID NOT NULL REFERENCES store_memberships(id),
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'available',
    checked_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    checked_out_at TIMESTAMPTZ,
    assigned_room_uuid UUID REFERENCES rooms(id),
    assigned_by UUID REFERENCES profiles(id),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 22. store_service_types (STEP 7 추가)
-- ============================================================
CREATE TABLE store_service_types (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    store_uuid UUID NOT NULL REFERENCES stores(id),
    service_type TEXT NOT NULL,
    time_type TEXT NOT NULL,
    time_minutes INTEGER NOT NULL,
    price INTEGER NOT NULL,
    manager_deduction INTEGER NOT NULL DEFAULT 0,
    has_greeting_check BOOLEAN NOT NULL DEFAULT false,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 21. ble_tag_presence
-- ============================================================
CREATE TABLE ble_tag_presence (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    store_uuid UUID NOT NULL REFERENCES stores(id),
    minor INTEGER NOT NULL,
    room_uuid UUID REFERENCES rooms(id),
    membership_id UUID REFERENCES store_memberships(id),
    last_event_type TEXT,
    last_seen_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

