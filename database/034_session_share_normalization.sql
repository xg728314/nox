-- STEP-011B-FIX: normalize session-level manager/store money away from
-- the anchor-hostess concentration used in STEP-011B.
--
-- Two new tables. Additive only — nothing is dropped in this migration.
-- The existing session_participants.manager_share_amount /
-- store_share_amount columns remain (they are retained for backward
-- compatibility and will be treated as non-authoritative going forward).
--
-- Ownership model after this migration:
--   hostess money → session_participants.hostess_share_amount
--   manager money → session_manager_shares  (one row per manager per source)
--   store money   → session_store_shares    (one row per source)
--
-- Settlement generation reads from these authoritative sources.

CREATE TABLE IF NOT EXISTS session_manager_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_uuid uuid NOT NULL,
  session_id uuid NOT NULL,
  manager_membership_id uuid NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  source_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_session_manager_shares_store
  ON session_manager_shares (store_uuid)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_session_manager_shares_session
  ON session_manager_shares (session_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_session_manager_shares_manager
  ON session_manager_shares (manager_membership_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS session_store_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_uuid uuid NOT NULL,
  session_id uuid NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  source_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_session_store_shares_store
  ON session_store_shares (store_uuid)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_session_store_shares_session
  ON session_store_shares (session_id)
  WHERE deleted_at IS NULL;
