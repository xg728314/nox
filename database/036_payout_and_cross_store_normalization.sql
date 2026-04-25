-- ⚠️ APPLIED AS: step_011d_payout_and_cross_store_normalization
-- 로컬 파일명은 036 이지만 Supabase history 에는 step_011d 이름으로 기록됨.
--
-- STEP-011D (step-011d.md spec): payout / partial / prepayment / cross-store.
--
-- Additive-only column additions on four existing tables + three
-- transactional RPC functions. All writes in the STEP-011D API layer go
-- through these RPCs so that Postgres guarantees atomic insert + update
-- across multiple tables (Supabase JS client does not expose explicit
-- transactions).
--
-- Spec recap (locked from orchestration/tasks/step-011d.md):
--   payout_records   — new columns: recipient_type, recipient_membership_id,
--                      currency, memo, created_by, completed_at
--   cross_store_settlements — new columns: from_store_uuid, to_store_uuid,
--                             memo, created_by (store_uuid kept for legacy
--                             compat; STEP-011D routes use from_store_uuid
--                             as the authoritative scope column but we
--                             continue to populate store_uuid as well so
--                             the migration 035 index stays consistent).
--   cross_store_settlement_items — new columns: manager_membership_id,
--                                  amount, paid_amount
--   settlement_items — new columns: paid_amount, remaining_amount (with
--                                   backfill to original amount)
--
-- Existing columns from migration 035 (target_store_uuid, prepaid_amount,
-- etc.) are retained but the STEP-011D routes no longer read them. The
-- RPC functions keep them synchronized on write so any lingering reader
-- still sees consistent values.

-- ── settlement_items ─────────────────────────────────────────────────
ALTER TABLE settlement_items
  ADD COLUMN IF NOT EXISTS paid_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_amount numeric;

-- Backfill remaining_amount = amount where null, and only when amount is
-- non-null. Nullable column so existing NULL amounts remain valid.
UPDATE settlement_items
SET remaining_amount = amount
WHERE remaining_amount IS NULL;

-- ── payout_records ───────────────────────────────────────────────────
ALTER TABLE payout_records
  ADD COLUMN IF NOT EXISTS recipient_type text,
  ADD COLUMN IF NOT EXISTS recipient_membership_id uuid,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'KRW',
  ADD COLUMN IF NOT EXISTS memo text,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_payout_records_recipient
  ON payout_records (store_uuid, recipient_type, recipient_membership_id)
  WHERE deleted_at IS NULL;

-- ── cross_store_settlements ──────────────────────────────────────────
ALTER TABLE cross_store_settlements
  ADD COLUMN IF NOT EXISTS from_store_uuid uuid,
  ADD COLUMN IF NOT EXISTS to_store_uuid uuid,
  ADD COLUMN IF NOT EXISTS memo text,
  ADD COLUMN IF NOT EXISTS created_by uuid;

-- Backfill from the legacy column names introduced in migration 035 so
-- any rows created before 036 remain coherent.
UPDATE cross_store_settlements
SET from_store_uuid = store_uuid
WHERE from_store_uuid IS NULL;

UPDATE cross_store_settlements
SET to_store_uuid = target_store_uuid
WHERE to_store_uuid IS NULL;

CREATE INDEX IF NOT EXISTS idx_cross_store_settlements_from
  ON cross_store_settlements (from_store_uuid)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cross_store_settlements_to
  ON cross_store_settlements (to_store_uuid)
  WHERE deleted_at IS NULL;

-- ── cross_store_settlement_items ─────────────────────────────────────
ALTER TABLE cross_store_settlement_items
  ADD COLUMN IF NOT EXISTS manager_membership_id uuid,
  ADD COLUMN IF NOT EXISTS amount numeric,
  ADD COLUMN IF NOT EXISTS paid_amount numeric NOT NULL DEFAULT 0;

UPDATE cross_store_settlement_items
SET manager_membership_id = target_manager_membership_id
WHERE manager_membership_id IS NULL;

UPDATE cross_store_settlement_items
SET amount = assigned_amount
WHERE amount IS NULL;

UPDATE cross_store_settlement_items
SET paid_amount = prepaid_amount
WHERE paid_amount = 0 AND prepaid_amount IS NOT NULL AND prepaid_amount > 0;

-- ── RPC: record_settlement_payout ────────────────────────────────────
CREATE OR REPLACE FUNCTION record_settlement_payout(
  p_store_uuid uuid,
  p_settlement_item_id uuid,
  p_amount numeric,
  p_payout_type text,
  p_memo text,
  p_created_by uuid
) RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_item_id uuid;
  v_settlement_id uuid;
  v_role_type text;
  v_membership_id uuid;
  v_amount numeric;
  v_paid_amount numeric;
  v_settlement_status text;
  v_recipient_type text;
  v_new_paid numeric;
  v_new_remaining numeric;
  v_payout_id uuid;
  v_all_fully_paid boolean;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'AMOUNT_INVALID';
  END IF;
  IF p_payout_type IS NULL OR p_payout_type NOT IN ('full','partial','prepayment') THEN
    RAISE EXCEPTION 'PAYOUT_TYPE_INVALID';
  END IF;
  IF p_store_uuid IS NULL THEN
    RAISE EXCEPTION 'STORE_UUID_NULL';
  END IF;

  SELECT id, settlement_id, role_type, membership_id, amount, COALESCE(paid_amount, 0)
    INTO v_item_id, v_settlement_id, v_role_type, v_membership_id, v_amount, v_paid_amount
  FROM settlement_items
  WHERE id = p_settlement_item_id
    AND store_uuid = p_store_uuid
    AND deleted_at IS NULL
  FOR UPDATE;

  IF v_item_id IS NULL THEN
    RAISE EXCEPTION 'ITEM_NOT_FOUND';
  END IF;

  SELECT status
    INTO v_settlement_status
  FROM settlements
  WHERE id = v_settlement_id
    AND store_uuid = p_store_uuid
    AND deleted_at IS NULL
  FOR UPDATE;

  IF v_settlement_status IS NULL THEN
    RAISE EXCEPTION 'SETTLEMENT_NOT_FOUND';
  END IF;
  IF v_settlement_status NOT IN ('confirmed','paid') THEN
    RAISE EXCEPTION 'SETTLEMENT_NOT_CONFIRMED';
  END IF;

  IF v_role_type = 'hostess' THEN
    v_recipient_type := 'hostess';
  ELSIF v_role_type = 'manager' THEN
    v_recipient_type := 'manager';
  ELSE
    RAISE EXCEPTION 'RECIPIENT_ROLE_INVALID';
  END IF;

  IF v_membership_id IS NULL THEN
    RAISE EXCEPTION 'RECIPIENT_MEMBERSHIP_NULL';
  END IF;

  v_new_paid := v_paid_amount + p_amount;
  v_new_remaining := COALESCE(v_amount, 0) - v_new_paid;
  IF v_new_remaining < 0 THEN
    RAISE EXCEPTION 'OVERPAY';
  END IF;

  INSERT INTO payout_records (
    store_uuid, settlement_id, settlement_item_id,
    recipient_type, recipient_membership_id,
    amount, currency, status, payout_type, memo,
    created_by, completed_at, paid_at
  ) VALUES (
    p_store_uuid, v_settlement_id, v_item_id,
    v_recipient_type, v_membership_id,
    p_amount, 'KRW', 'completed', p_payout_type, p_memo,
    p_created_by, now(), now()
  )
  RETURNING id INTO v_payout_id;

  UPDATE settlement_items
  SET paid_amount = v_new_paid,
      remaining_amount = v_new_remaining,
      updated_at = now()
  WHERE id = v_item_id;

  -- Optional promote settlement → paid when every live item has
  -- remaining_amount = 0. Only promote from 'confirmed' (not from
  -- 'paid', which is already terminal).
  IF v_settlement_status = 'confirmed' THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM settlement_items
      WHERE settlement_id = v_settlement_id
        AND store_uuid = p_store_uuid
        AND deleted_at IS NULL
        AND COALESCE(remaining_amount, amount) > 0
    ) INTO v_all_fully_paid;

    IF v_all_fully_paid THEN
      UPDATE settlements
      SET status = 'paid', updated_at = now()
      WHERE id = v_settlement_id AND store_uuid = p_store_uuid AND status = 'confirmed';
    END IF;
  END IF;

  RETURN json_build_object(
    'payout_id', v_payout_id,
    'settlement_id', v_settlement_id,
    'settlement_item_id', v_item_id,
    'recipient_type', v_recipient_type,
    'recipient_membership_id', v_membership_id,
    'amount', p_amount,
    'paid_amount', v_new_paid,
    'remaining_amount', v_new_remaining
  );
END;
$$;

-- ── RPC: create_cross_store_settlement ───────────────────────────────
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
    store_uuid, from_store_uuid, to_store_uuid, target_store_uuid,
    total_amount, prepaid_amount, remaining_amount, status,
    memo, note, created_by
  ) VALUES (
    p_from_store_uuid, p_from_store_uuid, p_to_store_uuid, p_to_store_uuid,
    p_total_amount, 0, p_total_amount, 'open',
    p_memo, p_memo, p_created_by
  )
  RETURNING id INTO v_header_id;

  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' AND jsonb_array_length(p_items) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_amt := (v_item->>'amount')::numeric;
      v_mgr := (v_item->>'manager_membership_id')::uuid;
      INSERT INTO cross_store_settlement_items (
        cross_store_settlement_id, store_uuid, target_store_uuid,
        target_manager_membership_id, manager_membership_id,
        amount, assigned_amount, paid_amount, prepaid_amount, remaining_amount,
        status
      ) VALUES (
        v_header_id, p_from_store_uuid, p_to_store_uuid,
        v_mgr, v_mgr,
        v_amt, v_amt, 0, 0, v_amt,
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

-- ── RPC: record_cross_store_payout ───────────────────────────────────
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
