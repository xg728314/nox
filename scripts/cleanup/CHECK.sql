-- ════════════════════════════════════════════════════════════════
-- 현재 DB 상태 점검 — Supabase SQL Editor 에서 실행
-- ════════════════════════════════════════════════════════════════
-- NUKE.sql 실행 전후 모두 사용 가능. 어디까지 정리됐는지 즉시 확인.
-- ════════════════════════════════════════════════════════════════

SELECT 'auth.users' AS table_name, count(*)::int AS rows FROM auth.users
UNION ALL SELECT 'profiles',                count(*)::int FROM profiles
UNION ALL SELECT 'store_memberships',       count(*)::int FROM store_memberships
UNION ALL SELECT 'stores',                  count(*)::int FROM stores
UNION ALL SELECT 'rooms',                   count(*)::int FROM rooms
UNION ALL SELECT 'hostesses',               count(*)::int FROM hostesses
UNION ALL SELECT 'managers',                count(*)::int FROM managers
UNION ALL SELECT 'session_participants',    count(*)::int FROM session_participants
UNION ALL SELECT 'room_sessions',           count(*)::int FROM room_sessions
UNION ALL SELECT 'orders',                  count(*)::int FROM orders
UNION ALL SELECT 'receipts',                count(*)::int FROM receipts
UNION ALL SELECT 'audit_events',            count(*)::int FROM audit_events
ORDER BY 1;

-- 결과 해석:
--   NUKE.sql 실행 전:
--     auth.users:           ~95
--     profiles:             ~94 (auth.users 와 비슷)
--     store_memberships:    95
--     hostesses:            70+ (시드 + 실 데이터)
--     managers:             10+
--     session_participants: 큰 수
--     room_sessions:        큰 수
--   NUKE.sql 정상 실행 후:
--     auth.users:           1   (xg728314 만)
--     profiles:             1
--     store_memberships:    운영자 보유 수만큼 (1~3 정도)
--     hostesses:            0
--     managers:             0
--     session_participants: 0
--     room_sessions:        0
--     orders:               0
--     receipts:             0
--     audit_events:         0
