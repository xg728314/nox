-- STEP-011D: payout / pre-settlement / cross-store settlement.
--
-- Three additive tables. Nothing is dropped. RLS stays disabled — route
-- layer enforces store_uuid scoping on every query.
--
--   payout_records                 — actual money-moved log
--   cross_store_settlements        — store-level header
--   cross_store_settlement_items   — manager-level allocation inside header

CREATE TABLE IF NOT EXISTS payout_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_uuid uuid NOT NULL,
  settlement_id uuid NULL,
  settlement_item_id uuid NULL,
  target_store_uuid uuid NULL,
  target_manager_membership_id uuid NULL,
  amount numeric NOT NULL DEFAULT 0,
  payout_type text NOT NULL,
  status text NOT NULL DEFAULT 'completed',
  account_id uuid NULL,
  payee_account_id uuid NULL,
  note text NULL,
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_payout_records_store
  ON payout_records (store_uuid) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payout_records_settlement
  ON payout_records (settlement_id) WHERE deleted_at IS NULL AND settlement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payout_records_settlement_item
  ON payout_records (settlement_item_id) WHERE deleted_at IS NULL AND settlement_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payout_records_target_store
  ON payout_records (target_store_uuid) WHERE deleted_at IS NULL AND target_store_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payout_records_target_manager
  ON payout_records (target_manager_membership_id) WHERE deleted_at IS NULL AND target_manager_membership_id IS NOT NULL;


CREATE TABLE IF NOT EXISTS cross_store_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_uuid uuid NOT NULL,
  target_store_uuid uuid NOT NULL,
  total_amount numeric NOT NULL DEFAULT 0,
  prepaid_amount numeric NOT NULL DEFAULT 0,
  remaining_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_cross_store_settlements_store
  ON cross_store_settlements (store_uuid) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cross_store_settlements_target
  ON cross_store_settlements (target_store_uuid) WHERE deleted_at IS NULL;


CREATE TABLE IF NOT EXISTS cross_store_settlement_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cross_store_settlement_id uuid NOT NULL,
  store_uuid uuid NOT NULL,
  target_store_uuid uuid NOT NULL,
  target_manager_membership_id uuid NULL,
  assigned_amount numeric NOT NULL DEFAULT 0,
  prepaid_amount numeric NOT NULL DEFAULT 0,
  remaining_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_cross_store_settlement_items_header
  ON cross_store_settlement_items (cross_store_settlement_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cross_store_settlement_items_store
  ON cross_store_settlement_items (store_uuid) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cross_store_settlement_items_target_store
  ON cross_store_settlement_items (target_store_uuid) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cross_store_settlement_items_target_manager
  ON cross_store_settlement_items (target_manager_membership_id)
  WHERE deleted_at IS NULL AND target_manager_membership_id IS NOT NULL;
