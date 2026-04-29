-- ============================================================
-- Visualize seed — SQL backup cleanup
-- ============================================================
--
-- Pair file: `scripts/visualize-seed/cleanup.ts` (preferred; also
-- removes auth.users via Supabase Admin API).
--
-- This SQL is the FALLBACK for cases where the TS cleanup is
-- unavailable (no Node, no service-role key, etc.). It removes only
-- DB rows scoped by the deterministic test store_uuids declared below.
-- It does NOT touch auth.users — Supabase blocks SQL editor access
-- to that schema. Run the TS cleanup afterward (or manually delete
-- @nox-seed.test users via the Supabase Auth UI) to fully clean up.
--
-- USAGE
--   1. Open Supabase SQL editor.
--   2. Paste this entire file.
--   3. Inspect the SELECT counts at the top.
--   4. Uncomment the DELETE block at the bottom.
--   5. Run.
--
-- SAFETY
--   - All WHERE clauses use the literal test store UUIDs declared in
--     this file. Never edit them to remove the IN clause.
--   - profiles cleanup via SQL is best-effort: we filter by full_name
--     prefix `[TEST]` because we cannot join to auth.users from this
--     editor. For complete profile cleanup, prefer the TS script.
--
-- KEEP IN SYNC WITH:
--   - scripts/visualize-seed/constants.ts (TEST_STORE_*_UUID)
-- ============================================================

-- Test store UUIDs (must match constants.ts).
WITH test_stores AS (
  SELECT id FROM (VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'::uuid),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02'::uuid)
  ) AS t(id)
)
SELECT
  (SELECT count(*) FROM audit_events WHERE store_uuid IN (SELECT id FROM test_stores))               AS audit_events,
  (SELECT count(*) FROM payout_records WHERE store_uuid IN (SELECT id FROM test_stores))             AS payout_records,
  (SELECT count(*) FROM settlement_items WHERE store_uuid IN (SELECT id FROM test_stores))           AS settlement_items,
  (SELECT count(*) FROM settlements WHERE store_uuid IN (SELECT id FROM test_stores))                AS settlements,
  (SELECT count(*) FROM orders WHERE store_uuid IN (SELECT id FROM test_stores))                    AS orders,
  (SELECT count(*) FROM receipts WHERE store_uuid IN (SELECT id FROM test_stores))                   AS receipts,
  (SELECT count(*) FROM receipt_snapshots WHERE store_uuid IN (SELECT id FROM test_stores))          AS receipt_snapshots,
  (SELECT count(*) FROM session_participants WHERE store_uuid IN (SELECT id FROM test_stores))       AS session_participants,
  (SELECT count(*) FROM room_sessions WHERE store_uuid IN (SELECT id FROM test_stores))              AS room_sessions,
  -- cross_store_settlement_items kept legacy store_uuid / target_store_uuid columns.
  (SELECT count(*) FROM cross_store_settlement_items
     WHERE store_uuid IN (SELECT id FROM test_stores)
        OR target_store_uuid IN (SELECT id FROM test_stores))                                        AS cross_store_items,
  -- cross_store_settlements (HEADER) dropped legacy columns in migration 038.
  -- Source-of-truth columns are `from_store_uuid` (debtor) / `to_store_uuid` (creditor).
  (SELECT count(*) FROM cross_store_settlements
     WHERE from_store_uuid IN (SELECT id FROM test_stores)
        OR to_store_uuid IN (SELECT id FROM test_stores))                                            AS cross_store_settlements,
  (SELECT count(*) FROM transfer_requests
     WHERE from_store_uuid IN (SELECT id FROM test_stores)
        OR to_store_uuid IN (SELECT id FROM test_stores))                                            AS transfer_requests,
  (SELECT count(*) FROM store_operating_days WHERE store_uuid IN (SELECT id FROM test_stores))       AS store_operating_days,
  (SELECT count(*) FROM rooms WHERE store_uuid IN (SELECT id FROM test_stores))                      AS rooms,
  (SELECT count(*) FROM hostesses WHERE store_uuid IN (SELECT id FROM test_stores))                  AS hostesses,
  (SELECT count(*) FROM managers WHERE store_uuid IN (SELECT id FROM test_stores))                   AS managers,
  (SELECT count(*) FROM store_memberships WHERE store_uuid IN (SELECT id FROM test_stores))          AS store_memberships,
  (SELECT count(*) FROM store_service_types WHERE store_uuid IN (SELECT id FROM test_stores))        AS store_service_types,
  (SELECT count(*) FROM store_settings WHERE store_uuid IN (SELECT id FROM test_stores))             AS store_settings,
  (SELECT count(*) FROM stores WHERE id IN (SELECT id FROM test_stores))                             AS stores;

-- ============================================================
-- DESTRUCTIVE SECTION — uncomment to actually delete.
-- ============================================================
--
-- BEGIN;
--
-- DELETE FROM audit_events
--   WHERE store_uuid IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02');
--
-- DELETE FROM payout_records
--   WHERE store_uuid IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02');
--
-- DELETE FROM settlement_items
--   WHERE store_uuid IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02');
--
-- DELETE FROM settlements
--   WHERE store_uuid IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02');
--
-- DELETE FROM orders
--   WHERE store_uuid IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02');
--
-- DELETE FROM receipts
--   WHERE store_uuid IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02');
--
-- DELETE FROM receipt_snapshots
--   WHERE store_uuid IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02');
--
-- DELETE FROM session_participants
--   WHERE store_uuid IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02');
--
-- DELETE FROM room_sessions
--   WHERE store_uuid IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02');
--
-- DELETE FROM cross_store_settlement_items
--   WHERE store_uuid IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02')
--      OR target_store_uuid IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02');
--
-- DELETE FROM cross_store_settlements
--   WHERE from_store_uuid IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02')
--      OR to_store_uuid IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02');
--
-- DELETE FROM transfer_requests
--   WHERE from_store_uuid IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02')
--      OR to_store_uuid IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02');
--
-- DELETE FROM store_operating_days
--   WHERE store_uuid IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02');
--
-- DELETE FROM rooms
--   WHERE store_uuid IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02');
--
-- DELETE FROM hostesses
--   WHERE store_uuid IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02');
--
-- DELETE FROM managers
--   WHERE store_uuid IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02');
--
-- DELETE FROM store_memberships
--   WHERE store_uuid IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02');
--
-- DELETE FROM store_service_types
--   WHERE store_uuid IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02');
--
-- DELETE FROM store_settings
--   WHERE store_uuid IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02');
--
-- DELETE FROM stores
--   WHERE id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02');
--
-- -- profiles best-effort (full cleanup requires the TS script for auth.users).
-- DELETE FROM profiles
--   WHERE full_name LIKE '[TEST]%' OR full_name IN ('홍길동', '박지훈', '김민지', '이서연', '최우진', '정수아');
--
-- COMMIT;
