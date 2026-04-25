-- ============================================================
-- 073_rls_orders_jwt.sql  (DRAFT — not yet applied)
--
-- RLS 8차 — orders 를 JWT claim 기반 SELECT 로 보호.
--
-- 스키마 근거 (002_actual_schema.sql:224-238):
--   orders (
--     id, session_id → room_sessions(id),
--     store_uuid   UUID NOT NULL,
--     business_day_id, item_name, order_type,
--     qty, unit_price, ordered_by, notes,
--     created_at, updated_at, deleted_at
--   )
--   → 단일 store_uuid 축. 주문은 근무매장 귀속. cross-store 개념 없음.
--
-- 정책 2종 (068/069/071 와 동형):
--   J1  select_jwt_store_uuid
--   J2  select_jwt_super_admin
--
-- WRITE policy 미정의. service_role BYPASSRLS.
-- idempotent.
-- ============================================================

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "disabled_for_mvp"       ON orders;
DROP POLICY IF EXISTS "select_jwt_store_uuid"  ON orders;
DROP POLICY IF EXISTS "select_jwt_super_admin" ON orders;

CREATE POLICY "select_jwt_store_uuid"
  ON orders
  FOR SELECT
  USING (
    orders.store_uuid
      = ((auth.jwt() -> 'app_metadata') ->> 'store_uuid')::uuid
  );

CREATE POLICY "select_jwt_super_admin"
  ON orders
  FOR SELECT
  USING (
    COALESCE(
      ((auth.jwt() -> 'app_metadata') ->> 'is_super_admin')::boolean,
      false
    ) = true
  );

COMMENT ON POLICY "select_jwt_store_uuid" ON orders IS
  'RLS-phase-8: authed JWT app_metadata.store_uuid same-store SELECT. service role BYPASSRLS.';
COMMENT ON POLICY "select_jwt_super_admin" ON orders IS
  'RLS-phase-8: JWT app_metadata.is_super_admin=true → 전 row.';
