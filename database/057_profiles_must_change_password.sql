-- ============================================================
-- 057_profiles_must_change_password.sql
--
-- Forced password change on first login for invited privileged
-- accounts (owner / manager / staff created via /admin/members/invite).
--
-- Flag lives on `profiles`. Default FALSE so existing rows (including
-- seed data) remain unaffected — only new `/admin/members/invite`
-- flow sets it to TRUE.
--
-- Cleared by POST /api/auth/change-password after the user supplies a
-- new password while logged in with the temp credential.
--
-- This migration is additive and idempotent.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- Low-selectivity column (most rows false). A partial index on TRUE
-- makes the middleware gate fast even in large deployments.
CREATE INDEX IF NOT EXISTS idx_profiles_must_change_password_true
  ON profiles (id)
  WHERE must_change_password = TRUE;

COMMENT ON COLUMN profiles.must_change_password IS
  'Force-change gate: when TRUE, middleware redirects to /reset-password?force=1 on every protected page load until user submits POST /api/auth/change-password, which flips this to FALSE.';
