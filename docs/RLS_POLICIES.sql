-- ============================================================
-- NOX RLS POLICIES — Supabase SQL Editor에서 실행
-- store_uuid 기준 접근 통제 + role별 차등 정책
-- ============================================================

-- 헬퍼 함수: 현재 유저의 store_uuid, role 조회
CREATE OR REPLACE FUNCTION auth.user_store_uuid()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT store_uuid FROM public.store_memberships
  WHERE profile_id = auth.uid()
    AND is_primary = true
    AND deleted_at IS NULL
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION auth.user_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT role FROM public.store_memberships
  WHERE profile_id = auth.uid()
    AND is_primary = true
    AND deleted_at IS NULL
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION auth.user_membership_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT id FROM public.store_memberships
  WHERE profile_id = auth.uid()
    AND is_primary = true
    AND deleted_at IS NULL
  LIMIT 1
$$;

-- ============================================================
-- 1. rooms
-- ============================================================
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rooms_select_same_store" ON rooms
  FOR SELECT USING (store_uuid = auth.user_store_uuid());

CREATE POLICY "rooms_insert_owner" ON rooms
  FOR INSERT WITH CHECK (
    store_uuid = auth.user_store_uuid()
    AND auth.user_role() = 'owner'
  );

CREATE POLICY "rooms_update_owner" ON rooms
  FOR UPDATE USING (
    store_uuid = auth.user_store_uuid()
    AND auth.user_role() = 'owner'
  );

-- ============================================================
-- 2. room_sessions
-- ============================================================
ALTER TABLE room_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "room_sessions_select_same_store" ON room_sessions
  FOR SELECT USING (store_uuid = auth.user_store_uuid());

CREATE POLICY "room_sessions_insert_owner_manager" ON room_sessions
  FOR INSERT WITH CHECK (
    store_uuid = auth.user_store_uuid()
    AND auth.user_role() IN ('owner', 'manager')
  );

CREATE POLICY "room_sessions_update_owner_manager" ON room_sessions
  FOR UPDATE USING (
    store_uuid = auth.user_store_uuid()
    AND auth.user_role() IN ('owner', 'manager')
  );

-- ============================================================
-- 3. session_participants
-- ============================================================
ALTER TABLE session_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "session_participants_select_same_store" ON session_participants
  FOR SELECT USING (store_uuid = auth.user_store_uuid());

-- hostess: 자기 자신만 조회
CREATE POLICY "session_participants_select_hostess_self" ON session_participants
  FOR SELECT USING (
    auth.user_role() = 'hostess'
    AND membership_id = auth.user_membership_id()
  );

CREATE POLICY "session_participants_insert_owner_manager" ON session_participants
  FOR INSERT WITH CHECK (
    store_uuid = auth.user_store_uuid()
    AND auth.user_role() IN ('owner', 'manager')
  );

CREATE POLICY "session_participants_update_owner_manager" ON session_participants
  FOR UPDATE USING (
    store_uuid = auth.user_store_uuid()
    AND auth.user_role() IN ('owner', 'manager')
  );

-- ============================================================
-- 4. orders
-- ============================================================
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orders_select_same_store" ON orders
  FOR SELECT USING (store_uuid = auth.user_store_uuid());

CREATE POLICY "orders_insert_owner_manager" ON orders
  FOR INSERT WITH CHECK (
    store_uuid = auth.user_store_uuid()
    AND auth.user_role() IN ('owner', 'manager')
  );

-- ============================================================
-- 5. receipts
-- ============================================================
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "receipts_select_same_store" ON receipts
  FOR SELECT USING (store_uuid = auth.user_store_uuid());

CREATE POLICY "receipts_insert_owner_manager" ON receipts
  FOR INSERT WITH CHECK (
    store_uuid = auth.user_store_uuid()
    AND auth.user_role() IN ('owner', 'manager')
  );

CREATE POLICY "receipts_update_owner" ON receipts
  FOR UPDATE USING (
    store_uuid = auth.user_store_uuid()
    AND auth.user_role() = 'owner'
  );

-- ============================================================
-- 6. receipt_snapshots
-- ============================================================
ALTER TABLE receipt_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "receipt_snapshots_select_same_store" ON receipt_snapshots
  FOR SELECT USING (store_uuid = auth.user_store_uuid());

CREATE POLICY "receipt_snapshots_insert_owner_manager" ON receipt_snapshots
  FOR INSERT WITH CHECK (
    store_uuid = auth.user_store_uuid()
    AND auth.user_role() IN ('owner', 'manager')
  );

-- ============================================================
-- 7. store_operating_days
-- ============================================================
ALTER TABLE store_operating_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_operating_days_select_same_store" ON store_operating_days
  FOR SELECT USING (store_uuid = auth.user_store_uuid());

CREATE POLICY "store_operating_days_insert_owner" ON store_operating_days
  FOR INSERT WITH CHECK (
    store_uuid = auth.user_store_uuid()
    AND auth.user_role() = 'owner'
  );

CREATE POLICY "store_operating_days_update_owner" ON store_operating_days
  FOR UPDATE USING (
    store_uuid = auth.user_store_uuid()
    AND auth.user_role() = 'owner'
  );

-- ============================================================
-- 8. closing_reports
-- ============================================================
ALTER TABLE closing_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "closing_reports_select_same_store" ON closing_reports
  FOR SELECT USING (store_uuid = auth.user_store_uuid());

CREATE POLICY "closing_reports_insert_owner" ON closing_reports
  FOR INSERT WITH CHECK (
    store_uuid = auth.user_store_uuid()
    AND auth.user_role() = 'owner'
  );

-- ============================================================
-- 9. managers
-- ============================================================
ALTER TABLE managers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "managers_select_same_store" ON managers
  FOR SELECT USING (store_uuid = auth.user_store_uuid());

CREATE POLICY "managers_insert_owner" ON managers
  FOR INSERT WITH CHECK (
    store_uuid = auth.user_store_uuid()
    AND auth.user_role() = 'owner'
  );

CREATE POLICY "managers_update_owner" ON managers
  FOR UPDATE USING (
    store_uuid = auth.user_store_uuid()
    AND auth.user_role() = 'owner'
  );

-- ============================================================
-- 10. hostesses
-- ============================================================
ALTER TABLE hostesses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hostesses_select_same_store" ON hostesses
  FOR SELECT USING (store_uuid = auth.user_store_uuid());

-- hostess: 자기 자신만
CREATE POLICY "hostesses_select_hostess_self" ON hostesses
  FOR SELECT USING (
    auth.user_role() = 'hostess'
    AND membership_id = auth.user_membership_id()
  );

CREATE POLICY "hostesses_insert_owner_manager" ON hostesses
  FOR INSERT WITH CHECK (
    store_uuid = auth.user_store_uuid()
    AND auth.user_role() IN ('owner', 'manager')
  );

CREATE POLICY "hostesses_update_owner_manager" ON hostesses
  FOR UPDATE USING (
    store_uuid = auth.user_store_uuid()
    AND auth.user_role() IN ('owner', 'manager')
  );

-- ============================================================
-- 11. store_memberships
-- ============================================================
ALTER TABLE store_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_memberships_select_same_store" ON store_memberships
  FOR SELECT USING (store_uuid = auth.user_store_uuid());

-- hostess: 자기 자신만
CREATE POLICY "store_memberships_select_self" ON store_memberships
  FOR SELECT USING (profile_id = auth.uid());

CREATE POLICY "store_memberships_insert_owner" ON store_memberships
  FOR INSERT WITH CHECK (
    store_uuid = auth.user_store_uuid()
    AND auth.user_role() = 'owner'
  );

CREATE POLICY "store_memberships_update_owner" ON store_memberships
  FOR UPDATE USING (
    store_uuid = auth.user_store_uuid()
    AND auth.user_role() = 'owner'
  );

-- ============================================================
-- 12. store_settings
-- ============================================================
ALTER TABLE store_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_settings_select_same_store" ON store_settings
  FOR SELECT USING (store_uuid = auth.user_store_uuid());

CREATE POLICY "store_settings_update_owner" ON store_settings
  FOR UPDATE USING (
    store_uuid = auth.user_store_uuid()
    AND auth.user_role() = 'owner'
  );

-- ============================================================
-- 13. transfer_requests
-- ============================================================
ALTER TABLE transfer_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transfer_requests_select_involved_store" ON transfer_requests
  FOR SELECT USING (
    from_store_uuid = auth.user_store_uuid()
    OR to_store_uuid = auth.user_store_uuid()
  );

CREATE POLICY "transfer_requests_insert_owner_manager" ON transfer_requests
  FOR INSERT WITH CHECK (
    from_store_uuid = auth.user_store_uuid()
    AND auth.user_role() IN ('owner', 'manager')
  );

CREATE POLICY "transfer_requests_update_involved" ON transfer_requests
  FOR UPDATE USING (
    (from_store_uuid = auth.user_store_uuid() OR to_store_uuid = auth.user_store_uuid())
    AND auth.user_role() IN ('owner', 'manager')
  );

-- ============================================================
-- 14. audit_events (INSERT only, no UPDATE/DELETE)
-- ============================================================
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_events_select_same_store" ON audit_events
  FOR SELECT USING (store_uuid = auth.user_store_uuid());

CREATE POLICY "audit_events_insert_any_authenticated" ON audit_events
  FOR INSERT WITH CHECK (store_uuid = auth.user_store_uuid());

-- audit_events: UPDATE/DELETE 차단 (policy 없음 = 거부)

-- ============================================================
-- 15. stores
-- ============================================================
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stores_select_own" ON stores
  FOR SELECT USING (id = auth.user_store_uuid());

CREATE POLICY "stores_update_owner" ON stores
  FOR UPDATE USING (
    id = auth.user_store_uuid()
    AND auth.user_role() = 'owner'
  );

-- ============================================================
-- 16. profiles (public.profiles)
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_self" ON profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "profiles_update_self" ON profiles
  FOR UPDATE USING (id = auth.uid());

-- ============================================================
-- 17. BLE tables
-- ============================================================
ALTER TABLE ble_gateways ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ble_gateways_select_same_store" ON ble_gateways
  FOR SELECT USING (store_uuid = auth.user_store_uuid());

ALTER TABLE ble_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ble_tags_select_same_store" ON ble_tags
  FOR SELECT USING (store_uuid = auth.user_store_uuid());

ALTER TABLE ble_ingest_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ble_ingest_events_select_same_store" ON ble_ingest_events
  FOR SELECT USING (store_uuid = auth.user_store_uuid());

-- INSERT는 service_role에서만 (게이트웨이 API가 service_role 사용)

ALTER TABLE ble_tag_presence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ble_tag_presence_select_same_store" ON ble_tag_presence
  FOR SELECT USING (store_uuid = auth.user_store_uuid());

-- ============================================================
-- NOTES:
-- - 모든 API route는 SUPABASE_SERVICE_ROLE_KEY 사용 → RLS bypass
-- - RLS는 클라이언트 직접 접근 시 2차 방어선
-- - service_role은 서버 사이드에서만 사용, 절대 클라이언트 노출 금지
-- ============================================================
