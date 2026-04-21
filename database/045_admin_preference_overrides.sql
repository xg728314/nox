-- 045_admin_preference_overrides.sql
--
-- Admin-forced preference overrides. Runtime precedence:
--   forced_per_store > forced_global > user_per_store > user_global > DEFAULT
--
-- Separate table from `user_preferences` so that personal prefs remain
-- untouched when an admin adds/removes a forced override. Readable by
-- any authenticated user (their own store + global row), writable only
-- by owner-of-that-store or super-admin (global).

CREATE TABLE IF NOT EXISTS public.admin_preference_overrides (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_uuid           uuid REFERENCES public.stores(id),
  scope                text NOT NULL,
  layout_config        jsonb NOT NULL,
  created_by_user_id   uuid NOT NULL REFERENCES auth.users(id),
  updated_by_user_id   uuid NOT NULL REFERENCES auth.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_override_global
  ON public.admin_preference_overrides (scope)
  WHERE store_uuid IS NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_override_store
  ON public.admin_preference_overrides (store_uuid, scope)
  WHERE store_uuid IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_admin_override_scope
  ON public.admin_preference_overrides (scope)
  WHERE deleted_at IS NULL;
