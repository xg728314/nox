-- ✅ STATUS: APPLIED (2026-04-24 Round 3)
-- 사전 실사: 중복 is_primary=true row 0건 확인 후 apply.
-- 인덱스 `ux_store_memberships_one_primary_per_profile` 생성됨.
--
-- Migration 053 — enforce at most one is_primary=true membership per profile.
--
-- SECURITY (R-6 backfill): the application layer (login, middleware,
-- resolveAuthContext) now fails closed when it detects more than one
-- `is_primary=true` row per `profile_id`, but only the DB can
-- actually PREVENT the invariant violation from occurring in the
-- first place. This migration adds a partial unique index so any
-- INSERT or UPDATE that would produce a second primary row for the
-- same profile is rejected atomically.
--
-- Scope:
--   - Only active (deleted_at IS NULL) rows are constrained. Soft-
--     deleted rows keep their historical is_primary flag without
--     blocking a new primary from being set.
--   - `WHERE is_primary = true` makes the index partial, so
--     is_primary=false rows are irrelevant and do not consume space.
--
-- Rollback: `DROP INDEX IF EXISTS ux_store_memberships_one_primary_per_profile;`

-- Safety: fail loudly if duplicate primaries already exist so ops can
-- manually resolve before the constraint creation.
DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT profile_id
    FROM public.store_memberships
    WHERE is_primary = true AND deleted_at IS NULL
    GROUP BY profile_id
    HAVING COUNT(*) > 1
  ) t;
  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'Cannot create unique index: % profile(s) already have multiple primary memberships. Resolve manually before re-running this migration.',
      dup_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_store_memberships_one_primary_per_profile
  ON public.store_memberships (profile_id)
  WHERE is_primary = true AND deleted_at IS NULL;
