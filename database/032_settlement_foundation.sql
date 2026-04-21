-- STEP-011A: settlement foundation.
--
-- Three additive changes:
--   1. session_participants gains nullable share fields (price_amount
--      already exists from an earlier round; the four new columns are
--      required so participant-level earnings can be attributed before
--      settlement generation).
--   2. settlements — header row per (session). Only one live row per
--      session_id via a partial unique index (deleted_at IS NULL).
--   3. settlement_items — detail rows owned by a settlement. Role-typed
--      with optional participant / membership / account linkage.
--
-- All additive. No existing schema is modified. RLS stays disabled;
-- route-level store_uuid scoping enforces access.

-- 1. session_participants share fields --------------------------------------
ALTER TABLE session_participants
  ADD COLUMN IF NOT EXISTS manager_share_amount numeric,
  ADD COLUMN IF NOT EXISTS hostess_share_amount numeric,
  ADD COLUMN IF NOT EXISTS store_share_amount numeric,
  ADD COLUMN IF NOT EXISTS share_type text;

-- price_amount already exists from an earlier migration; left untouched.

-- 2. settlements -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_uuid uuid NOT NULL,
  session_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  total_amount numeric NOT NULL DEFAULT 0,
  manager_amount numeric NOT NULL DEFAULT 0,
  hostess_amount numeric NOT NULL DEFAULT 0,
  store_amount numeric NOT NULL DEFAULT 0,
  confirmed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_settlements_store
  ON settlements (store_uuid)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_settlements_session
  ON settlements (session_id)
  WHERE deleted_at IS NULL;

-- Only one live settlement row per session — enforced by partial unique.
CREATE UNIQUE INDEX IF NOT EXISTS uq_settlements_session_live
  ON settlements (session_id)
  WHERE deleted_at IS NULL;

-- 3. settlement_items --------------------------------------------------------
CREATE TABLE IF NOT EXISTS settlement_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL,
  store_uuid uuid NOT NULL,
  participant_id uuid NULL,
  membership_id uuid NULL,
  role_type text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  account_id uuid NULL,
  payee_account_id uuid NULL,
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_settlement_items_settlement
  ON settlement_items (settlement_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_settlement_items_store
  ON settlement_items (store_uuid)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_settlement_items_participant
  ON settlement_items (participant_id)
  WHERE deleted_at IS NULL AND participant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_settlement_items_membership
  ON settlement_items (membership_id)
  WHERE deleted_at IS NULL AND membership_id IS NOT NULL;
