-- STEP-011E (step-011e.md spec): settlement/payout hardening.
--
-- Locks down the schema introduced by 032/035/036 with NOT NULL,
-- CHECK constraints, enum-like value guards, and FK references to
-- store_memberships. No calculation logic changes, no behavioral
-- changes to existing APIs. Pre-check (see step-011e execution log)
-- verified zero existing rows violate any of the constraints below.
--
-- Trigger `fill_settlement_item_remaining` preserves legacy INSERT
-- sites (e.g. app/api/sessions/[session_id]/settlement/route.ts) that
-- do not explicitly pass remaining_amount — the trigger fills it from
-- (amount - paid_amount) before the NOT NULL constraint kicks in.

-- ── settlement_items ─────────────────────────────────────────────────

-- Backfill any residual NULL remaining_amount (defensive — migration
-- 036 already did this but we re-run before NOT NULL).
UPDATE settlement_items
SET remaining_amount = amount - COALESCE(paid_amount, 0)
WHERE remaining_amount IS NULL;

CREATE OR REPLACE FUNCTION fill_settlement_item_remaining()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.remaining_amount IS NULL THEN
    NEW.remaining_amount := COALESCE(NEW.amount, 0) - COALESCE(NEW.paid_amount, 0);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_settlement_item_remaining ON settlement_items;
CREATE TRIGGER trg_fill_settlement_item_remaining
  BEFORE INSERT OR UPDATE ON settlement_items
  FOR EACH ROW
  EXECUTE FUNCTION fill_settlement_item_remaining();

ALTER TABLE settlement_items
  ALTER COLUMN remaining_amount SET NOT NULL;

ALTER TABLE settlement_items
  DROP CONSTRAINT IF EXISTS chk_settlement_items_paid_nonneg,
  DROP CONSTRAINT IF EXISTS chk_settlement_items_remaining_nonneg,
  DROP CONSTRAINT IF EXISTS chk_settlement_items_amount_nonneg,
  DROP CONSTRAINT IF EXISTS chk_settlement_items_sum;

ALTER TABLE settlement_items
  ADD CONSTRAINT chk_settlement_items_paid_nonneg
    CHECK (paid_amount >= 0),
  ADD CONSTRAINT chk_settlement_items_remaining_nonneg
    CHECK (remaining_amount >= 0),
  ADD CONSTRAINT chk_settlement_items_amount_nonneg
    CHECK (amount >= 0),
  ADD CONSTRAINT chk_settlement_items_sum
    CHECK (paid_amount + remaining_amount = amount);

-- Optional FK (nullable): settlement_items.membership_id is null for
-- role_type='store' rows, so we only enforce referential integrity
-- when a value is present.
ALTER TABLE settlement_items
  DROP CONSTRAINT IF EXISTS fk_settlement_items_membership;
ALTER TABLE settlement_items
  ADD CONSTRAINT fk_settlement_items_membership
    FOREIGN KEY (membership_id) REFERENCES store_memberships (id)
    ON DELETE RESTRICT;

-- ── payout_records ───────────────────────────────────────────────────

-- Defensive backfill: any row still missing recipient_* gets mirrored
-- from the legacy target_manager_membership_id (known pre-036 rows
-- used that column for cross-store prepay).
UPDATE payout_records
SET recipient_membership_id = target_manager_membership_id,
    recipient_type = 'manager'
WHERE recipient_membership_id IS NULL
  AND target_manager_membership_id IS NOT NULL
  AND deleted_at IS NULL;

ALTER TABLE payout_records
  ALTER COLUMN recipient_membership_id SET NOT NULL,
  ALTER COLUMN recipient_type SET NOT NULL;

ALTER TABLE payout_records
  DROP CONSTRAINT IF EXISTS chk_payout_records_amount_pos,
  DROP CONSTRAINT IF EXISTS chk_payout_records_recipient_type,
  DROP CONSTRAINT IF EXISTS chk_payout_records_payout_type,
  DROP CONSTRAINT IF EXISTS chk_payout_records_status;

ALTER TABLE payout_records
  ADD CONSTRAINT chk_payout_records_amount_pos
    CHECK (amount > 0),
  ADD CONSTRAINT chk_payout_records_recipient_type
    CHECK (recipient_type IN ('hostess','manager')),
  ADD CONSTRAINT chk_payout_records_payout_type
    CHECK (payout_type IN ('full','partial','prepayment','cross_store_prepay')),
  ADD CONSTRAINT chk_payout_records_status
    CHECK (status IN ('pending','completed','cancelled'));

ALTER TABLE payout_records
  DROP CONSTRAINT IF EXISTS fk_payout_records_recipient_membership;
ALTER TABLE payout_records
  ADD CONSTRAINT fk_payout_records_recipient_membership
    FOREIGN KEY (recipient_membership_id) REFERENCES store_memberships (id)
    ON DELETE RESTRICT;

-- ── cross_store_settlement_items ─────────────────────────────────────

-- Backfill any residual NULLs from legacy columns before locking down.
UPDATE cross_store_settlement_items
SET manager_membership_id = target_manager_membership_id
WHERE manager_membership_id IS NULL
  AND target_manager_membership_id IS NOT NULL;

UPDATE cross_store_settlement_items
SET amount = assigned_amount
WHERE amount IS NULL;

ALTER TABLE cross_store_settlement_items
  ALTER COLUMN manager_membership_id SET NOT NULL,
  ALTER COLUMN amount SET NOT NULL;

ALTER TABLE cross_store_settlement_items
  DROP CONSTRAINT IF EXISTS chk_csi_amount_pos,
  DROP CONSTRAINT IF EXISTS chk_csi_paid_nonneg,
  DROP CONSTRAINT IF EXISTS chk_csi_remaining_nonneg,
  DROP CONSTRAINT IF EXISTS chk_csi_status;

ALTER TABLE cross_store_settlement_items
  ADD CONSTRAINT chk_csi_amount_pos
    CHECK (amount > 0),
  ADD CONSTRAINT chk_csi_paid_nonneg
    CHECK (paid_amount >= 0),
  ADD CONSTRAINT chk_csi_remaining_nonneg
    CHECK (remaining_amount >= 0),
  ADD CONSTRAINT chk_csi_status
    CHECK (status IN ('open','partial','completed'));

ALTER TABLE cross_store_settlement_items
  DROP CONSTRAINT IF EXISTS fk_csi_manager_membership;
ALTER TABLE cross_store_settlement_items
  ADD CONSTRAINT fk_csi_manager_membership
    FOREIGN KEY (manager_membership_id) REFERENCES store_memberships (id)
    ON DELETE RESTRICT;

-- ── cross_store_settlements ──────────────────────────────────────────

UPDATE cross_store_settlements
SET from_store_uuid = store_uuid
WHERE from_store_uuid IS NULL;

UPDATE cross_store_settlements
SET to_store_uuid = target_store_uuid
WHERE to_store_uuid IS NULL;

ALTER TABLE cross_store_settlements
  ALTER COLUMN from_store_uuid SET NOT NULL,
  ALTER COLUMN to_store_uuid SET NOT NULL;

ALTER TABLE cross_store_settlements
  DROP CONSTRAINT IF EXISTS chk_css_total_pos,
  DROP CONSTRAINT IF EXISTS chk_css_paid_nonneg,
  DROP CONSTRAINT IF EXISTS chk_css_remaining_nonneg,
  DROP CONSTRAINT IF EXISTS chk_css_not_self,
  DROP CONSTRAINT IF EXISTS chk_css_status;

ALTER TABLE cross_store_settlements
  ADD CONSTRAINT chk_css_total_pos
    CHECK (total_amount > 0),
  ADD CONSTRAINT chk_css_paid_nonneg
    CHECK (prepaid_amount >= 0),
  ADD CONSTRAINT chk_css_remaining_nonneg
    CHECK (remaining_amount >= 0),
  ADD CONSTRAINT chk_css_not_self
    CHECK (from_store_uuid <> to_store_uuid),
  ADD CONSTRAINT chk_css_status
    CHECK (status IN ('open','partial','completed'));

-- ── session_manager_shares: tighten FK (column already NOT NULL). ────
ALTER TABLE session_manager_shares
  DROP CONSTRAINT IF EXISTS fk_sms_manager_membership;
ALTER TABLE session_manager_shares
  ADD CONSTRAINT fk_sms_manager_membership
    FOREIGN KEY (manager_membership_id) REFERENCES store_memberships (id)
    ON DELETE RESTRICT;

ALTER TABLE session_manager_shares
  DROP CONSTRAINT IF EXISTS chk_sms_amount_nonneg;
ALTER TABLE session_manager_shares
  ADD CONSTRAINT chk_sms_amount_nonneg
    CHECK (amount >= 0);
