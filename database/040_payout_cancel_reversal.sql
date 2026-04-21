-- STEP-014: payout cancel / reversal — financial recovery.
--
-- Additive-only: original payout rows are never deleted. Cancellation
-- creates a *reversal row* (payout_type='reversal', positive amount) and
-- flips the original's status to 'cancelled' while recording the link
-- via reversed_by_payout_id. Settlement / cross-store state is restored
-- by decrementing paid_amount and re-raising remaining_amount under row
-- locks — no negative amounts are ever written.
--
--   - payout_records: + original_payout_id, reversed_by_payout_id,
--                     cancel_reason, cancelled_at, cancelled_by,
--                     cross_store_settlement_id, cross_store_settlement_item_id
--   - payout_type CHECK widened to include 'reversal'
--   - record_cross_store_payout() CREATE OR REPLACE to populate the new
--     cross_store_* link columns on insert (forward compat only — cancel
--     of legacy pre-040 cross-store rows is rejected by the route).
--   - cancel_settlement_payout()     — new RPC
--   - cancel_cross_store_payout()    — new RPC

ALTER TABLE payout_records
  ADD COLUMN IF NOT EXISTS original_payout_id uuid NULL,
  ADD COLUMN IF NOT EXISTS reversed_by_payout_id uuid NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason text NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid NULL,
  ADD COLUMN IF NOT EXISTS cross_store_settlement_id uuid NULL,
  ADD COLUMN IF NOT EXISTS cross_store_settlement_item_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_payout_records_original
  ON payout_records (original_payout_id)
  WHERE deleted_at IS NULL AND original_payout_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payout_records_reversed_by
  ON payout_records (reversed_by_payout_id)
  WHERE deleted_at IS NULL AND reversed_by_payout_id IS NOT NULL;

ALTER TABLE payout_records
  DROP CONSTRAINT IF EXISTS chk_payout_records_payout_type;

ALTER TABLE payout_records
  ADD CONSTRAINT chk_payout_records_payout_type
    CHECK (payout_type IN ('full','partial','prepayment','cross_store_prepay','reversal'));

-- ── RPC: record_cross_store_payout (replace — populate link columns) ─
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
      prepaid_amount = v_new_item_paid,
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
    cross_store_settlement_id, cross_store_settlement_item_id,
    target_store_uuid, target_manager_membership_id,
    recipient_type, recipient_membership_id,
    amount, currency, status, payout_type, memo,
    created_by, completed_at, paid_at
  ) VALUES (
    p_from_store_uuid, NULL, NULL,
    v_header_id, v_item_id,
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

-- ── RPC: cancel_settlement_payout ────────────────────────────────────
CREATE OR REPLACE FUNCTION cancel_settlement_payout(
  p_store_uuid uuid,
  p_payout_id uuid,
  p_reason text,
  p_actor uuid
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_orig_id uuid;
  v_orig_status text;
  v_orig_type text;
  v_orig_amount numeric;
  v_orig_settlement_item_id uuid;
  v_orig_settlement_id uuid;
  v_orig_recipient_type text;
  v_orig_recipient_membership_id uuid;
  v_item_amount numeric;
  v_item_paid numeric;
  v_new_paid numeric;
  v_new_remaining numeric;
  v_settlement_status text;
  v_reversal_id uuid;
BEGIN
  IF p_store_uuid IS NULL OR p_payout_id IS NULL THEN
    RAISE EXCEPTION 'BAD_ARGS';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  SELECT id, status, payout_type, amount, settlement_item_id, settlement_id,
         recipient_type, recipient_membership_id
    INTO v_orig_id, v_orig_status, v_orig_type, v_orig_amount, v_orig_settlement_item_id, v_orig_settlement_id,
         v_orig_recipient_type, v_orig_recipient_membership_id
  FROM payout_records
  WHERE id = p_payout_id
    AND store_uuid = p_store_uuid
    AND deleted_at IS NULL
  FOR UPDATE;

  IF v_orig_id IS NULL THEN
    RAISE EXCEPTION 'PAYOUT_NOT_FOUND';
  END IF;
  IF v_orig_settlement_item_id IS NULL THEN
    -- cross-store rows must go through cancel_cross_store_payout
    RAISE EXCEPTION 'NOT_A_SETTLEMENT_PAYOUT';
  END IF;
  IF v_orig_status = 'cancelled' THEN
    RAISE EXCEPTION 'ALREADY_CANCELLED';
  END IF;
  IF v_orig_status <> 'completed' THEN
    RAISE EXCEPTION 'NOT_CANCELLABLE_STATE';
  END IF;
  IF v_orig_type = 'reversal' THEN
    RAISE EXCEPTION 'REVERSAL_NOT_CANCELLABLE';
  END IF;

  SELECT amount, COALESCE(paid_amount, 0)
    INTO v_item_amount, v_item_paid
  FROM settlement_items
  WHERE id = v_orig_settlement_item_id
    AND store_uuid = p_store_uuid
    AND deleted_at IS NULL
  FOR UPDATE;

  IF v_item_amount IS NULL THEN
    RAISE EXCEPTION 'ITEM_NOT_FOUND';
  END IF;

  v_new_paid := v_item_paid - v_orig_amount;
  IF v_new_paid < 0 THEN
    RAISE EXCEPTION 'PAID_UNDERFLOW';
  END IF;
  v_new_remaining := v_item_amount - v_new_paid;

  UPDATE settlement_items
  SET paid_amount = v_new_paid,
      remaining_amount = v_new_remaining,
      updated_at = now()
  WHERE id = v_orig_settlement_item_id;

  -- Demote settlement from 'paid' back to 'confirmed' if anything is
  -- now outstanding on any live item under the same settlement.
  SELECT status INTO v_settlement_status
  FROM settlements
  WHERE id = v_orig_settlement_id
    AND store_uuid = p_store_uuid
    AND deleted_at IS NULL
  FOR UPDATE;

  IF v_settlement_status = 'paid' AND v_new_remaining > 0 THEN
    UPDATE settlements
    SET status = 'confirmed', updated_at = now()
    WHERE id = v_orig_settlement_id AND store_uuid = p_store_uuid;
  END IF;

  -- Reversal row: positive amount, payout_type='reversal'.
  INSERT INTO payout_records (
    store_uuid, settlement_id, settlement_item_id,
    recipient_type, recipient_membership_id,
    amount, currency, status, payout_type, memo,
    original_payout_id, cancel_reason,
    created_by, completed_at, paid_at
  ) VALUES (
    p_store_uuid, v_orig_settlement_id, v_orig_settlement_item_id,
    v_orig_recipient_type, v_orig_recipient_membership_id,
    v_orig_amount, 'KRW', 'completed', 'reversal', p_reason,
    v_orig_id, p_reason,
    p_actor, now(), now()
  )
  RETURNING id INTO v_reversal_id;

  UPDATE payout_records
  SET status = 'cancelled',
      reversed_by_payout_id = v_reversal_id,
      cancel_reason = p_reason,
      cancelled_at = now(),
      cancelled_by = p_actor,
      updated_at = now()
  WHERE id = v_orig_id;

  RETURN json_build_object(
    'original_payout_id', v_orig_id,
    'reversal_payout_id', v_reversal_id,
    'settlement_item_id', v_orig_settlement_item_id,
    'amount', v_orig_amount,
    'new_paid_amount', v_new_paid,
    'new_remaining_amount', v_new_remaining,
    'previous_status', v_orig_status,
    'new_status', 'cancelled'
  );
END;
$$;

-- ── RPC: cancel_cross_store_payout ───────────────────────────────────
CREATE OR REPLACE FUNCTION cancel_cross_store_payout(
  p_store_uuid uuid,
  p_payout_id uuid,
  p_reason text,
  p_actor uuid
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_orig_id uuid;
  v_orig_status text;
  v_orig_type text;
  v_orig_amount numeric;
  v_header_id uuid;
  v_item_id uuid;
  v_orig_target_store uuid;
  v_orig_target_manager uuid;
  v_orig_recipient_type text;
  v_orig_recipient_membership_id uuid;
  v_item_amount numeric;
  v_item_paid numeric;
  v_new_item_paid numeric;
  v_new_item_remaining numeric;
  v_new_item_status text;
  v_header_total numeric;
  v_sum_paid numeric;
  v_new_header_remaining numeric;
  v_new_header_status text;
  v_reversal_id uuid;
BEGIN
  IF p_store_uuid IS NULL OR p_payout_id IS NULL THEN
    RAISE EXCEPTION 'BAD_ARGS';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  SELECT id, status, payout_type, amount,
         cross_store_settlement_id, cross_store_settlement_item_id,
         target_store_uuid, target_manager_membership_id,
         recipient_type, recipient_membership_id
    INTO v_orig_id, v_orig_status, v_orig_type, v_orig_amount,
         v_header_id, v_item_id,
         v_orig_target_store, v_orig_target_manager,
         v_orig_recipient_type, v_orig_recipient_membership_id
  FROM payout_records
  WHERE id = p_payout_id
    AND store_uuid = p_store_uuid
    AND deleted_at IS NULL
  FOR UPDATE;

  IF v_orig_id IS NULL THEN
    RAISE EXCEPTION 'PAYOUT_NOT_FOUND';
  END IF;
  IF v_header_id IS NULL OR v_item_id IS NULL THEN
    -- Legacy pre-STEP-014 cross-store rows did not record link columns.
    RAISE EXCEPTION 'LEGACY_RECORD_NOT_CANCELLABLE';
  END IF;
  IF v_orig_status = 'cancelled' THEN
    RAISE EXCEPTION 'ALREADY_CANCELLED';
  END IF;
  IF v_orig_status <> 'completed' THEN
    RAISE EXCEPTION 'NOT_CANCELLABLE_STATE';
  END IF;
  IF v_orig_type = 'reversal' THEN
    RAISE EXCEPTION 'REVERSAL_NOT_CANCELLABLE';
  END IF;

  SELECT total_amount
    INTO v_header_total
  FROM cross_store_settlements
  WHERE id = v_header_id
    AND from_store_uuid = p_store_uuid
    AND deleted_at IS NULL
  FOR UPDATE;

  IF v_header_total IS NULL THEN
    RAISE EXCEPTION 'HEADER_NOT_FOUND';
  END IF;

  SELECT amount, COALESCE(paid_amount, 0)
    INTO v_item_amount, v_item_paid
  FROM cross_store_settlement_items
  WHERE id = v_item_id
    AND cross_store_settlement_id = v_header_id
    AND store_uuid = p_store_uuid
    AND deleted_at IS NULL
  FOR UPDATE;

  IF v_item_amount IS NULL THEN
    RAISE EXCEPTION 'ITEM_NOT_IN_HEADER';
  END IF;

  v_new_item_paid := v_item_paid - v_orig_amount;
  IF v_new_item_paid < 0 THEN
    RAISE EXCEPTION 'PAID_UNDERFLOW';
  END IF;
  v_new_item_remaining := v_item_amount - v_new_item_paid;
  v_new_item_status := CASE
    WHEN v_new_item_remaining = v_item_amount THEN 'open'
    WHEN v_new_item_remaining = 0 THEN 'completed'
    ELSE 'partial'
  END;

  UPDATE cross_store_settlement_items
  SET paid_amount = v_new_item_paid,
      prepaid_amount = v_new_item_paid,
      remaining_amount = v_new_item_remaining,
      status = v_new_item_status,
      updated_at = now()
  WHERE id = v_item_id;

  SELECT COALESCE(SUM(paid_amount), 0)
    INTO v_sum_paid
  FROM cross_store_settlement_items
  WHERE cross_store_settlement_id = v_header_id
    AND store_uuid = p_store_uuid
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
    store_uuid,
    cross_store_settlement_id, cross_store_settlement_item_id,
    target_store_uuid, target_manager_membership_id,
    recipient_type, recipient_membership_id,
    amount, currency, status, payout_type, memo,
    original_payout_id, cancel_reason,
    created_by, completed_at, paid_at
  ) VALUES (
    p_store_uuid,
    v_header_id, v_item_id,
    v_orig_target_store, v_orig_target_manager,
    v_orig_recipient_type, v_orig_recipient_membership_id,
    v_orig_amount, 'KRW', 'completed', 'reversal', p_reason,
    v_orig_id, p_reason,
    p_actor, now(), now()
  )
  RETURNING id INTO v_reversal_id;

  UPDATE payout_records
  SET status = 'cancelled',
      reversed_by_payout_id = v_reversal_id,
      cancel_reason = p_reason,
      cancelled_at = now(),
      cancelled_by = p_actor,
      updated_at = now()
  WHERE id = v_orig_id;

  RETURN json_build_object(
    'original_payout_id', v_orig_id,
    'reversal_payout_id', v_reversal_id,
    'cross_store_settlement_id', v_header_id,
    'cross_store_settlement_item_id', v_item_id,
    'amount', v_orig_amount,
    'item', json_build_object(
      'id', v_item_id,
      'paid_amount', v_new_item_paid,
      'remaining_amount', v_new_item_remaining,
      'status', v_new_item_status
    ),
    'header', json_build_object(
      'id', v_header_id,
      'paid_amount', v_sum_paid,
      'remaining_amount', v_new_header_remaining,
      'status', v_new_header_status
    ),
    'previous_status', 'completed',
    'new_status', 'cancelled'
  );
END;
$$;
