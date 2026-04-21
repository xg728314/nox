-- STEP-043: settlement-tree manager prepayment ledger.
--
-- Purpose
--   Allow operators to pre-pay an individual counterpart-store manager
--   against the running cross-store balance visible in the settlement
--   tree (app/payouts/settlement-tree). Each prepayment is an append-only
--   ledger row — totals NEVER overwrite existing rows.
--
-- Scope
--   - Parallel to pre_settlements (session-scoped, untouched) and
--     payout_records (settlement-confirmed ledger, untouched).
--   - This table is standalone so summation/overpay checks are trivial
--     and independent of settlement-items header creation timing.
--
-- Additive only. RLS stays disabled; route layer enforces store_uuid
-- scoping on every query.

CREATE TABLE IF NOT EXISTS manager_prepayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Actor store (the one handing out the prepayment).
  store_uuid uuid NOT NULL REFERENCES stores(id),

  -- Counterpart store the manager belongs to.
  target_store_uuid uuid NOT NULL REFERENCES stores(id),

  -- Manager who receives the prepayment. store_memberships.id.
  target_manager_membership_id uuid NOT NULL REFERENCES store_memberships(id),

  -- Operating-day linkage (nullable so data from legacy imports can
  -- slot in without a business day).
  business_day_id uuid NULL REFERENCES store_operating_days(id),

  -- Positive amount. A ledger row is never amended — a cancellation
  -- flips `status` to 'canceled' and a balance recompute excludes it.
  amount numeric NOT NULL,
  memo text NULL,

  -- 'active' | 'canceled'
  status text NOT NULL DEFAULT 'active',

  -- Actor identity (for audit cross-reference; audit_events still writes
  -- a separate manager_prepayment_created event).
  created_by uuid NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,

  CONSTRAINT chk_manager_prepayments_amount_positive
    CHECK (amount > 0),
  CONSTRAINT chk_manager_prepayments_status
    CHECK (status IN ('active','canceled')),
  CONSTRAINT chk_manager_prepayments_cross_store
    CHECK (store_uuid <> target_store_uuid)
);

CREATE INDEX IF NOT EXISTS idx_manager_prepayments_store_target
  ON manager_prepayments (store_uuid, target_store_uuid)
  WHERE deleted_at IS NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_manager_prepayments_target_manager
  ON manager_prepayments (target_store_uuid, target_manager_membership_id)
  WHERE deleted_at IS NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_manager_prepayments_business_day
  ON manager_prepayments (business_day_id)
  WHERE deleted_at IS NULL AND business_day_id IS NOT NULL;
