-- STEP-011F (step-011f.md spec): legacy cleanup / consolidation.
--
-- 1. Redefine `create_cross_store_settlement` and
--    `record_cross_store_payout` RPCs so they write ONLY to the new
--    columns. Dual-write to (store_uuid, target_store_uuid, note,
--    target_manager_membership_id, assigned_amount, prepaid_amount)
--    is removed.
--
-- 2. Drop all repo references to legacy columns (app/api/cross-store-
--    settlements/* routes deleted in this round) and drop the indexes
--    that covered them.
--
-- 3. DROP legacy columns per the step-011f LEGACY TARGETS list:
--      cross_store_settlements:      store_uuid, target_store_uuid, note
--      cross_store_settlement_items: target_manager_membership_id,
--                                    assigned_amount, prepaid_amount
--
-- 4. Tighten payout_records.payout_type CHECK to drop the legacy
--    `cross_store_prepay` value (only the deleted prepay route wrote
--    it; the new `record_cross_store_payout` RPC writes 'prepayment').
--
-- Pre-check confirmed tables are empty in the live DB, so column
-- drops and the CHECK redefinition cannot conflict with existing
-- rows. `store_uuid` on cross_store_settlements is NOT NULL and the
-- dual-write RPC must be updated BEFORE the column is dropped —
-- CREATE OR REPLACE below is ordered before the DROP COLUMN.

-- ── RPC: create_cross_store_settlement (single-source rewrite) ───────
CREATE OR REPLACE FUNCTION create_cross_store_settlement(
  p_from_store_uuid uuid,
  p_to_store_uuid uuid,
  p_total_amount numeric,
  p_memo text,
  p_created_by uuid,
  p_items jsonb
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_header_id uuid;
  v_item jsonb;
  v_mgr uuid;
  v_amt numeric;
  v_sum numeric := 0;
  v_count int := 0;
BEGIN
  IF p_from_store_uuid IS NULL OR p_to_store_uuid IS NULL THEN
    RAISE EXCEPTION 'STORE_NULL';
  END IF;
  IF p_from_store_uuid = p_to_store_uuid THEN
    RAISE EXCEPTION 'SAME_STORE';
  END IF;
  IF p_total_amount IS NULL OR p_total_amount <= 0 THEN
    RAISE EXCEPTION 'TOTAL_INVALID';
  END IF;

  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' AND jsonb_array_length(p_items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_amt := (v_item->>'amount')::numeric;
      v_mgr := NULLIF(v_item->>'manager_membership_id','')::uuid;
      IF v_amt IS NULL OR v_amt <= 0 THEN
        RAISE EXCEPTION 'ITEM_AMOUNT_INVALID';
      END IF;
      IF v_mgr IS NULL THEN
        RAISE EXCEPTION 'MANAGER_NULL';
      END IF;
      v_sum := v_sum + v_amt;
      v_count := v_count + 1;
    END LOOP;
    IF abs(v_sum - p_total_amount) > 0.0001 THEN
      RAISE EXCEPTION 'SUM_MISMATCH';
    END IF;
  END IF;

  INSERT INTO cross_store_settlements (
    from_store_uuid, to_store_uuid,
    total_amount, prepaid_amount, remaining_amount, status,
    memo, created_by
  ) VALUES (
    p_from_store_uuid, p_to_store_uuid,
    p_total_amount, 0, p_total_amount, 'open',
    p_memo, p_created_by
  )
  RETURNING id INTO v_header_id;

  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' AND jsonb_array_length(p_items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_amt := (v_item->>'amount')::numeric;
      v_mgr := (v_item->>'manager_membership_id')::uuid;
      INSERT INTO cross_store_settlement_items (
        cross_store_settlement_id, store_uuid, target_store_uuid,
        manager_membership_id,
        amount, paid_amount, remaining_amount,
        status
      ) VALUES (
        v_header_id, p_from_store_uuid, p_to_store_uuid,
        v_mgr,
        v_amt, 0, v_amt,
        'open'
      );
    END LOOP;
  END IF;

  RETURN json_build_object(
    'id', v_header_id,
    'from_store_uuid', p_from_store_uuid,
    'to_store_uuid', p_to_store_uuid,
    'total_amount', p_total_amount,
    'remaining_amount', p_total_amount,
    'status', 'open',
    'item_count', v_count
  );
END;
$$;

-- ── RPC: record_cross_store_payout (single-source rewrite) ───────────
CREATE OR REPLACE FUNCTION record_cross_store_payout(
  p_from_store_uuid uuid,
  p_cross_store_settlement_id uuid,
  p_item_id uuid,
  p_amount numeric,
  p_memo text,
  p_created_by uuid
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_header_id uuid;
  v_to_store uuid;
  v_header_total numeric;
  v_item_id uuid;
  v_item_amount numeric;
  v_item_paid numeric;
  v_item_mgr uuid;
  v_new_item_paid numeric;
  v_new_item_remaining numeric;
  v_new_item_status text;
  v_sum_paid numeric;
  v_new_header_remaining numeric;
  v_new_header_status text;
  v_payout_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'AMOUNT_INVALID';
  END IF;
  IF p_from_store_uuid IS NULL THEN
    RAISE EXCEPTION 'STORE_UUID_NULL';
  END IF;

  SELECT id, to_store_uuid, total_amount
    INTO v_header_id, v_to_store, v_header_total
  FROM cross_store_settlements
  WHERE id = p_cross_store_settlement_id
    AND from_store_uuid = p_from_store_uuid
    AND deleted_at IS NULL
  FOR UPDATE;

  IF v_header_id IS NULL THEN
    RAISE EXCEPTION 'HEADER_NOT_FOUND';
  END IF;

  SELECT id, amount, COALESCE(paid_amount, 0), manager_membership_id
    INTO v_item_id, v_item_amount, v_item_paid, v_item_mgr
  FROM cross_store_settlement_items
  WHERE id = p_item_id
    AND cross_store_settlement_id = p_cross_store_settlement_id
    AND store_uuid = p_from_store_uuid
    AND deleted_at IS NULL
  FOR UPDATE;

  IF v_item_id IS NULL THEN
    RAISE EXCEPTION 'ITEM_NOT_IN_HEADER';
  END IF;
  IF v_item_mgr IS NULL THEN
    RAISE EXCEPTION 'MANAGER_NULL';
  END IF;

  v_new_item_paid := v_item_paid + p_amount;
  v_new_item_remaining := COALESCE(v_item_amount, 0) - v_new_item_paid;
  IF v_new_item_remaining < 0 THEN
    RAISE EXCEPTION 'OVERPAY';
  END IF;
  v_new_item_status := CASE WHEN v_new_item_remaining = 0 THEN 'completed' ELSE 'partial' END;

  UPDATE cross_store_settlement_items
  SET paid_amount = v_new_item_paid,
      remaining_amount = v_new_item_remaining,
      status = v_new_item_status,
      updated_at = now()
  WHERE id = v_item_id;

  SELECT COALESCE(SUM(paid_amount), 0)
    INTO v_sum_paid
  FROM cross_store_settlement_items
  WHERE cross_store_settlement_id = p_cross_store_settlement_id
    AND store_uuid = p_from_store_uuid
    AND deleted_at IS NULL;

  v_new_header_remaining := v_header_total - v_sum_paid;
  IF v_new_header_remaining < 0 THEN
    RAISE EXCEPTION 'HEADER_REMAINING_NEGATIVE';
  END IF;

  v_new_header_status := CASE
    WHEN v_new_header_remaining = 0 THEN 'completed'
    WHEN v_sum_paid > 0 THEN 'partial'
    ELSE 'open'
  END;

  UPDATE cross_store_settlements
  SET prepaid_amount = v_sum_paid,
      remaining_amount = v_new_header_remaining,
      status = v_new_header_status,
      updated_at = now()
  WHERE id = v_header_id;

  INSERT INTO payout_records (
    store_uuid, settlement_id, settlement_item_id,
    target_store_uuid, target_manager_membership_id,
    recipient_type, recipient_membership_id,
    amount, currency, status, payout_type, memo,
    created_by, completed_at, paid_at
  ) VALUES (
    p_from_store_uuid, NULL, NULL,
    v_to_store, v_item_mgr,
    'manager', v_item_mgr,
    p_amount, 'KRW', 'completed', 'prepayment', p_memo,
    p_created_by, now(), now()
  )
  RETURNING id INTO v_payout_id;

  RETURN json_build_object(
    'payout_id', v_payout_id,
    'header', json_build_object(
      'id', v_header_id,
      'paid_amount', v_sum_paid,
      'remaining_amount', v_new_header_remaining,
      'status', v_new_header_status
    ),
    'item', json_build_object(
      'id', v_item_id,
      'paid_amount', v_new_item_paid,
      'remaining_amount', v_new_item_remaining,
      'status', v_new_item_status
    )
  );
END;
$$;

-- ── Drop legacy indexes that reference columns about to be dropped ───
DROP INDEX IF EXISTS idx_cross_store_settlements_store;
DROP INDEX IF EXISTS idx_cross_store_settlements_target;
DROP INDEX IF EXISTS idx_cross_store_settlement_items_target_manager;

-- ── Drop legacy columns on cross_store_settlements ───────────────────
ALTER TABLE cross_store_settlements
  DROP COLUMN IF EXISTS store_uuid,
  DROP COLUMN IF EXISTS target_store_uuid,
  DROP COLUMN IF EXISTS note;

-- ── Drop legacy columns on cross_store_settlement_items ──────────────
ALTER TABLE cross_store_settlement_items
  DROP COLUMN IF EXISTS target_manager_membership_id,
  DROP COLUMN IF EXISTS assigned_amount,
  DROP COLUMN IF EXISTS prepaid_amount;

-- ── Tighten payout_records.payout_type enum ──────────────────────────
-- Pre-check confirmed zero rows carry the legacy 'cross_store_prepay'
-- value, so redefining the CHECK is safe.
ALTER TABLE payout_records
  DROP CONSTRAINT IF EXISTS chk_payout_records_payout_type;

ALTER TABLE payout_records
  ADD CONSTRAINT chk_payout_records_payout_type
    CHECK (payout_type IN ('full','partial','prepayment'));
