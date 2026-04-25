-- ════════════════════════════════════════════════════════════════
-- NOX 계정 정리 — PREVIEW (읽기 전용)
-- ════════════════════════════════════════════════════════════════
-- 정책 (단순):
--   ✓ KEEP — email = 'xg728314@gmail.com' (운영자) 1명만
--   ✗ DELETE — 그 외 전부
--
-- 사용:
--   1. Supabase Dashboard → SQL Editor
--   2. 이 파일 전체 붙여넣기 → Run
--   3. 결과 확인 후 Node 스크립트로 실제 삭제
--
-- 안전: SELECT 만 사용. 데이터 변경 없음.
-- ════════════════════════════════════════════════════════════════

-- ─── 1) 보존 대상 (정확히 1명이어야 함) ─────────────────────────
SELECT '✓ KEEP' AS status, au.id AS user_id, au.email, p.full_name
FROM auth.users au
LEFT JOIN profiles p ON p.id = au.id
WHERE au.email = 'xg728314@gmail.com';

-- ─── 2) 삭제 대상 ───────────────────────────────────────────────
SELECT '✗ DELETE' AS status, au.id AS user_id, au.email, p.full_name, au.created_at
FROM auth.users au
LEFT JOIN profiles p ON p.id = au.id
WHERE au.email != 'xg728314@gmail.com'
ORDER BY au.email;

-- ─── 3) 영향 row 개수 ────────────────────────────────────────
WITH delete_users AS (
  SELECT au.id FROM auth.users au
  WHERE au.email != 'xg728314@gmail.com'
),
delete_memberships AS (
  SELECT id FROM store_memberships WHERE profile_id IN (SELECT id FROM delete_users)
)
SELECT 'profiles' AS what, COUNT(*) AS rows FROM profiles WHERE id IN (SELECT id FROM delete_users)
UNION ALL SELECT 'store_memberships', COUNT(*) FROM store_memberships WHERE profile_id IN (SELECT id FROM delete_users)
UNION ALL SELECT 'hostesses', COUNT(*) FROM hostesses WHERE membership_id IN (SELECT id FROM delete_memberships)
UNION ALL SELECT 'managers', COUNT(*) FROM managers WHERE membership_id IN (SELECT id FROM delete_memberships)
UNION ALL SELECT 'session_participants', COUNT(*) FROM session_participants WHERE membership_id IN (SELECT id FROM delete_memberships)
UNION ALL SELECT 'room_sessions (opened_by)', COUNT(*) FROM room_sessions WHERE opened_by IN (SELECT id FROM delete_users)
UNION ALL SELECT 'orders (ordered_by)', COUNT(*) FROM orders WHERE ordered_by IN (SELECT id FROM delete_users)
UNION ALL SELECT 'audit_events', COUNT(*) FROM audit_events WHERE actor_profile_id IN (SELECT id FROM delete_users);

-- ─── 4) 매장(stores) 분류 ────────────────────────────────────
WITH delete_users AS (
  SELECT au.id FROM auth.users au
  WHERE au.email != 'xg728314@gmail.com'
),
keep_memberships AS (
  SELECT store_uuid FROM store_memberships
  WHERE profile_id NOT IN (SELECT id FROM delete_users)
)
SELECT
  s.id AS store_uuid,
  s.store_name,
  COUNT(DISTINCT km.store_uuid) AS keeping_member_link,
  CASE WHEN COUNT(DISTINCT km.store_uuid) = 0 THEN '⚠ 빈 매장 (삭제 대상)' ELSE '✓ 운영자 소속' END AS verdict
FROM stores s
LEFT JOIN keep_memberships km ON km.store_uuid = s.id
WHERE s.deleted_at IS NULL
GROUP BY s.id, s.store_name
ORDER BY keeping_member_link DESC, s.store_name;

-- ─── 결과 해석 ───────────────────────────────────────────────
-- ✓ KEEP 표가 정확히 1행 (xg728314@gmail.com) → OK.
-- ⚠ KEEP 표가 0행이면 절대 진행 X — 본인 계정이 다른 이메일일 가능성.
-- ⚠ 삭제 row 개수가 비정상적으로 많거나 적으면 검토.
--
-- OK 면:
--   npx tsx scripts/cleanup/cleanup-test-accounts.ts             # dry-run
--   npx tsx scripts/cleanup/cleanup-test-accounts.ts --apply --include-empty-stores
