-- ============================================================
-- 078_payout_rpc_executor.sql
--
-- 목적:
--   migration 077 이 payout_records.executor_membership_id 컬럼을 추가했지만,
--   record_cross_store_payout / cancel_cross_store_payout RPC 는 INSERT 시
--   해당 컬럼을 채우지 않았다 — route 층에서 후속 UPDATE 를 했지만 race
--   window 존재. 본 migration 은 두 RPC 의 시그니처에 `p_executor_membership_id`
--   파라미터 (DEFAULT NULL) 를 추가하고 INSERT 에 포함시켜 RPC 한 트랜잭션
--   안에서 원자적으로 기록되도록 한다.
--
-- ⚠️ 절대 불변:
--   - paid_amount / remaining_amount / status 계산 로직 **무변경**.
--   - OVERPAY / HEADER_REMAINING_NEGATIVE / MANAGER_NULL / PAID_UNDERFLOW /
--     NOT_CANCELLABLE_STATE 가드 **무변경**.
--   - FOR UPDATE 락 **무변경**.
--   - payout_type / currency / status 리터럴 **무변경**.
--   - reversed_by_payout_id / cancelled_by / cancelled_at / cancel_reason
--     컬럼 **무변경**.
--
-- DEFAULT NULL 파라미터:
--   기존 호출자 (파라미터 5~6개) 는 변경 없이 호출 유지. 신규 호출자가
--   `p_executor_membership_id` 를 넘기면 INSERT 에 저장.
--
-- 멱등: CREATE OR REPLACE FUNCTION.
-- ============================================================

-- ── record_cross_store_payout (executor 추가) ─────────────────
CREATE OR REPLACE FUNCTION record_cross_store_payout(
  p_from_store_uuid uuid,
  p_cross_store_settlement_id uuid,
  p_item_id uuid,
  p_amount numeric,
  p_memo text,
  p_created_by uuid,
  p_executor_membership_id uuid DEFAULT NULL
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

  -- Phase 10 (2026-04-24) schema-drift fix:
  --   items.prepaid_amount was DROPPED in 038_cross_store_legacy_drop.sql.
  --   paid_amount is SSOT for items after 038. Header UPDATE below keeps
  --   prepaid_amount (column still exists on cross_store_settlements header).
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
    cross_store_settlement_id, cross_store_settlement_item_id,
    target_store_uuid, target_manager_membership_id,
    recipient_type, recipient_membership_id,
    amount, currency, status, payout_type, memo,
    created_by, completed_at, paid_at,
    executor_membership_id                                   -- Phase 10
  ) VALUES (
    p_from_store_uuid, NULL, NULL,
    v_header_id, v_item_id,
    v_to_store, v_item_mgr,
    'manager', v_item_mgr,
    p_amount, 'KRW', 'completed', 'prepayment', p_memo,
    p_created_by, now(), now(),
    p_executor_membership_id                                 -- Phase 10
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


-- ── cancel_cross_store_payout (executor 추가) ─────────────────
CREATE OR REPLACE FUNCTION cancel_cross_store_payout(
  p_store_uuid uuid,
  p_payout_id uuid,
  p_reason text,
  p_actor uuid,
  p_executor_membership_id uuid DEFAULT NULL
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

  -- Phase 10 (2026-04-24) schema-drift fix:
  --   items.prepaid_amount was DROPPED in 038_cross_store_legacy_drop.sql.
  --   paid_amount is SSOT for items after 038. Header UPDATE below keeps
  --   prepaid_amount (column still exists on cross_store_settlements header).
  UPDATE cross_store_settlement_items
  SET paid_amount = v_new_item_paid,
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
    created_by, completed_at, paid_at,
    executor_membership_id                                   -- Phase 10
  ) VALUES (
    p_store_uuid,
    v_header_id, v_item_id,
    v_orig_target_store, v_orig_target_manager,
    v_orig_recipient_type, v_orig_recipient_membership_id,
    v_orig_amount, 'KRW', 'completed', 'reversal', p_reason,
    v_orig_id, p_reason,
    p_actor, now(), now(),
    p_executor_membership_id                                 -- Phase 10
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

-- 주의: cancel_settlement_payout (session-scope) 는 본 라운드에서 수정하지
-- 않는다. payout_records.settlement_item_id 기반 취소라 cross-store 경로와
-- 분리. 필요시 후속 라운드.
