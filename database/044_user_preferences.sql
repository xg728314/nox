-- 044_user_preferences.sql
--
-- User-level preferences (layout, menu order, etc.). Global-by-user with an
-- optional per-store override. Completely additive — no existing table is
-- touched. Callers that don't read this table will continue to get default
-- behavior (no rows → fallback to DEFAULT_* constants in the frontend).
--
-- scope values in use (Phase C):
--   'counter.room_layout'   — RoomLayoutConfig JSON (order + hidden + perViewport)
--   'counter.sidebar_menu'  — SidebarMenuConfig JSON (order + hidden)
--
-- Row identity:
--   (user_id, scope)                — when store_uuid IS NULL → global default
--   (user_id, store_uuid, scope)    — per-store override
-- Deleted rows are soft-deleted (deleted_at) and excluded from the unique
-- indexes so re-creating the same scope after a delete is allowed.

CREATE TABLE IF NOT EXISTS public.user_preferences (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_uuid   uuid REFERENCES public.stores(id),
  scope        text NOT NULL,
  layout_config jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz NULL
);

-- Uniqueness: one live row per (user, scope) when no store, and one live row
-- per (user, store, scope) when scoped to a store.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_pref_global
  ON public.user_preferences (user_id, scope)
  WHERE store_uuid IS NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_pref_store
  ON public.user_preferences (user_id, store_uuid, scope)
  WHERE store_uuid IS NOT NULL AND deleted_at IS NULL;

-- Lookup index for the common GET path (fetch both global + per-store rows
-- for a given scope in one query).
CREATE INDEX IF NOT EXISTS idx_user_pref_user_scope
  ON public.user_preferences (user_id, scope)
  WHERE deleted_at IS NULL;

-- RLS is disabled at MVP tier (matches existing table policy). The route
-- handler is the authorization boundary and scopes every query by
-- auth.user_id from resolveAuthContext.
