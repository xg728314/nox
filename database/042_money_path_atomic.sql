-- ============================================================
-- 042_money_path_atomic.sql
--
-- STEP-4B: DB atomic money-safety implementation.
-- Implements the STEP-4A locked design, adjusted per policy decision
-- (retain 'void' as a terminal room_sessions.status value).
--
-- Contents:
--   A. CHECK constraints
--      - credits_status_check  (new; room_sessions/receipts/session_participants already present)
--   B. State transition triggers
--      - trg_session_status_transition : closed→any, void→any rejected
--      - trg_receipt_status_transition : finalized→any rejected
--      - trg_credit_status_transition  : collected/cancelled terminal
--   C. Closed-session write-block triggers
--      - trg_block_participants_on_nonactive_session : block INSERT/UPDATE when
--        parent room_sessions.status <> 'active', except the active→left
--        transition used by close_session_atomic
--      - trg_block_orders_on_nonactive_session : block any write to orders
--        when parent room_sessions.status <> 'active'
--      NOTE: these are named distinctly from the existing 'trg_block_*_closed'
--      triggers which guard BUSINESS-DAY closure (store_operating_days.status),
--      not session closure. The two concerns coexist.
--   D. Partial unique index
--      - uq_credits_receipt_pending : one pending credit per receipt
--   E. RPCs
--      - close_session_atomic(session_id, store_uuid, closed_by)
--      - register_payment_atomic(session_id, store_uuid, receipt_id,
--          payment_method, cash_amount, card_amount, credit_amount,
--          manager_card_margin, card_fee_rate, customer_name, customer_phone,
--          manager_membership_id)
--
-- Not contained here (by policy §4 "implement ONLY the minimum design"):
--   * room_sessions.status CHECK tightening — live constraint already permits
--     ('active','closed','void'); retained unchanged per policy.
--   * receipts_status_check, session_participants_status_check — already
--     present with the design-matching contents; not re-added.
--
-- All blocks are idempotent (safe to reapply).
-- No app-route refactor. No schema redesign. No business-rule change.
-- ============================================================

BEGIN;

-- ============================================================
-- A. CHECK constraint — credits.status
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credits_status_check'
      AND conrelid = 'public.credits'::regclass
  ) THEN
    ALTER TABLE public.credits
      ADD CONSTRAINT credits_status_check
      CHECK (status IN ('pending','collected','cancelled'));
  END IF;
END
$$;

-- ============================================================
-- B. State transition triggers
-- ============================================================

-- B.1 room_sessions: closed/void are terminal
CREATE OR REPLACE FUNCTION public.fn_session_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'ILLEGAL_SESSION_TRANSITION: closed sessions cannot transition (attempted %->%)', OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'void' THEN
    RAISE EXCEPTION 'ILLEGAL_SESSION_TRANSITION: void sessions cannot transition (attempted %->%)', OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;
  -- active -> (closed|void) is permitted; any other target for 'active' is
  -- rejected by room_sessions_status_check already.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_session_status_transition ON public.room_sessions;
CREATE TRIGGER trg_session_status_transition
  BEFORE UPDATE ON public.room_sessions
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.fn_session_status_transition();

-- B.2 receipts: finalized is terminal
CREATE OR REPLACE FUNCTION public.fn_receipt_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'finalized' AND NEW.status IS DISTINCT FROM 'finalized' THEN
    RAISE EXCEPTION 'ILLEGAL_RECEIPT_TRANSITION: finalized receipts cannot revert (attempted %->%)', OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_receipt_status_transition ON public.receipts;
CREATE TRIGGER trg_receipt_status_transition
  BEFORE UPDATE ON public.receipts
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.fn_receipt_status_transition();

-- B.3 credits: collected/cancelled are terminal
CREATE OR REPLACE FUNCTION public.fn_credit_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('collected','cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'ILLEGAL_CREDIT_TRANSITION: % is terminal (attempted %->%)', OLD.status, OLD.status, NEW.status
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_credit_status_transition ON public.credits;
CREATE TRIGGER trg_credit_status_transition
  BEFORE UPDATE ON public.credits
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.fn_credit_status_transition();

-- ============================================================
-- C. Closed-session write-block triggers
-- ============================================================

-- C.1 session_participants: block write when parent session is not active,
--     with single exception for the terminal active->left transition used
--     by close_session_atomic.
CREATE OR REPLACE FUNCTION public.fn_block_participants_on_nonactive_session()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent_status text;
BEGIN
  SELECT status INTO v_parent_status
  FROM public.room_sessions
  WHERE id = NEW.session_id;

  -- Parent missing (shouldn't occur due to FK) — let FK enforce; don't block here.
  IF v_parent_status IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_parent_status = 'active' THEN
    RETURN NEW;
  END IF;

  -- Parent is 'closed' or 'void'. Allow ONLY the terminal active->left
  -- transition invoked by close_session_atomic.
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'active'
     AND NEW.status = 'left' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'SESSION_NOT_ACTIVE_PARTICIPANT_WRITE: parent room_sessions.status=%', v_parent_status
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_block_participants_on_nonactive_session ON public.session_participants;
CREATE TRIGGER trg_block_participants_on_nonactive_session
  BEFORE INSERT OR UPDATE ON public.session_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_block_participants_on_nonactive_session();

-- C.2 orders: block any write when parent session is not active.
CREATE OR REPLACE FUNCTION public.fn_block_orders_on_nonactive_session()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent_status text;
BEGIN
  SELECT status INTO v_parent_status
  FROM public.room_sessions
  WHERE id = NEW.session_id;

  IF v_parent_status IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_parent_status = 'active' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'SESSION_NOT_ACTIVE_ORDER_WRITE: parent room_sessions.status=%', v_parent_status
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_block_orders_on_nonactive_session ON public.orders;
CREATE TRIGGER trg_block_orders_on_nonactive_session
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_block_orders_on_nonactive_session();

-- ============================================================
-- D. Partial unique index — one pending credit per receipt
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_credits_receipt_pending
  ON public.credits (receipt_id)
  WHERE status = 'pending'
    AND receipt_id IS NOT NULL
    AND deleted_at IS NULL;

-- ============================================================
-- E. RPCs
-- ============================================================

-- E.1 close_session_atomic
-- Atomically validates checkout preconditions and transitions:
--   session_participants (active → left)  ←  must happen BEFORE session close
--                                            due to trigger C.1 allowing
--                                            active→left only
--   room_sessions        (active → closed)
--   chat_rooms           (is_active → false)  best-effort
--
-- All reads take FOR UPDATE on the session row to serialize concurrent
-- callers. Any precondition failure RAISEs and rolls back the transaction
-- — no partial state is ever persisted.
--
-- Void sessions are ignored (step 2 rejects if status <> 'active').
CREATE OR REPLACE FUNCTION public.close_session_atomic(
  p_session_id uuid,
  p_store_uuid uuid,
  p_closed_by uuid
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_session_row RECORD;
  v_biz_day_status text;
  v_unresolved_ids uuid[];
  v_invalid_price_ids uuid[];
  v_mismatch_price_ids uuid[];
  v_now timestamptz := now();
  v_participants_closed_count int := 0;
  v_chat_closed boolean := false;
  v_session_ended_at timestamptz;
BEGIN
  -- 1. Lock target session
  SELECT id, status, store_uuid, business_day_id
    INTO v_session_row
  FROM public.room_sessions
  WHERE id = p_session_id
    AND store_uuid = p_store_uuid
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_session_row.status <> 'active' THEN
    RAISE EXCEPTION 'SESSION_NOT_ACTIVE: current status=%', v_session_row.status
      USING ERRCODE = 'P0001';
  END IF;

  -- 2. Business day open check
  SELECT status INTO v_biz_day_status
  FROM public.store_operating_days
  WHERE id = v_session_row.business_day_id;

  IF v_biz_day_status = 'closed' THEN
    RAISE EXCEPTION 'BUSINESS_DAY_CLOSED' USING ERRCODE = 'P0001';
  END IF;

  -- 3. Unresolved active participants (missing category or zero time)
  SELECT array_agg(id) INTO v_unresolved_ids
  FROM public.session_participants
  WHERE session_id = p_session_id
    AND store_uuid = p_store_uuid
    AND status = 'active'
    AND deleted_at IS NULL
    AND (category IS NULL OR time_minutes IS NULL OR time_minutes = 0);

  IF v_unresolved_ids IS NOT NULL AND array_length(v_unresolved_ids, 1) > 0 THEN
    RAISE EXCEPTION 'UNRESOLVED_PARTICIPANTS: %', v_unresolved_ids
      USING ERRCODE = 'P0001';
  END IF;

  -- 4. Orders with missing pricing
  SELECT array_agg(id) INTO v_invalid_price_ids
  FROM public.orders
  WHERE session_id = p_session_id
    AND store_uuid = p_store_uuid
    AND deleted_at IS NULL
    AND (store_price IS NULL OR sale_price IS NULL);

  IF v_invalid_price_ids IS NOT NULL AND array_length(v_invalid_price_ids, 1) > 0 THEN
    RAISE EXCEPTION 'INVALID_ORDER_PRICES: %', v_invalid_price_ids
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. Orders with sale_price < store_price
  SELECT array_agg(id) INTO v_mismatch_price_ids
  FROM public.orders
  WHERE session_id = p_session_id
    AND store_uuid = p_store_uuid
    AND deleted_at IS NULL
    AND sale_price < store_price;

  IF v_mismatch_price_ids IS NOT NULL AND array_length(v_mismatch_price_ids, 1) > 0 THEN
    RAISE EXCEPTION 'PRICE_VALIDATION_FAILED: %', v_mismatch_price_ids
      USING ERRCODE = 'P0001';
  END IF;

  -- 6. Transition participants active → left  (MUST precede session close
  --    so trigger C.1 allows the update; the trigger's exception branch
  --    permits active→left regardless of parent status, so order is not
  --    strictly required, but we keep it explicit for clarity).
  WITH upd AS (
    UPDATE public.session_participants
    SET status = 'left', left_at = v_now
    WHERE session_id = p_session_id
      AND store_uuid = p_store_uuid
      AND status = 'active'
    RETURNING id
  )
  SELECT COUNT(*)::int INTO v_participants_closed_count FROM upd;

  -- 7. Close session (guarded by FOR UPDATE lock + status='active' predicate)
  UPDATE public.room_sessions
  SET status = 'closed',
      ended_at = v_now,
      closed_by = p_closed_by,
      updated_at = v_now
  WHERE id = p_session_id
    AND store_uuid = p_store_uuid
    AND status = 'active'
  RETURNING ended_at INTO v_session_ended_at;

  IF NOT FOUND THEN
    -- Defensive: should be unreachable because of the FOR UPDATE lock above.
    RAISE EXCEPTION 'SESSION_CLOSE_RACE: concurrent modification detected'
      USING ERRCODE = 'P0001';
  END IF;

  -- 8. Best-effort chat close
  WITH closed_chat AS (
    UPDATE public.chat_rooms
    SET is_active = false,
        closed_at = v_now,
        closed_reason = 'checkout',
        updated_at = v_now
    WHERE store_uuid = p_store_uuid
      AND session_id = p_session_id
      AND type = 'room_session'
      AND is_active = true
    RETURNING id
  )
  SELECT EXISTS(SELECT 1 FROM closed_chat) INTO v_chat_closed;

  RETURN jsonb_build_object(
    'session_id', p_session_id,
    'status', 'closed',
    'ended_at', v_session_ended_at,
    'participants_closed_count', v_participants_closed_count,
    'chat_closed', v_chat_closed
  );
END;
$$;

-- E.2 register_payment_atomic
-- Atomically validates and registers a single payment on a receipt:
--   optional INSERT into credits (if credit_amount > 0)
--   UPDATE receipts  (payment_method transitions NULL → one of 4 methods)
--
-- The receipt row is locked FOR UPDATE; the UPDATE's
-- `payment_method IS NULL` predicate is defense-in-depth. No orphan
-- credit rows can survive because any failure rolls back the entire TX.
CREATE OR REPLACE FUNCTION public.register_payment_atomic(
  p_session_id uuid,
  p_store_uuid uuid,
  p_receipt_id uuid,
  p_payment_method text,
  p_cash_amount int,
  p_card_amount int,
  p_credit_amount int,
  p_manager_card_margin int,
  p_card_fee_rate numeric,
  p_customer_name text,
  p_customer_phone text,
  p_manager_membership_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_receipt RECORD;
  v_room_uuid uuid;
  v_credit_id uuid := NULL;
  v_card_fee_amount int := 0;
  v_total int;
  v_customer_name_clean text;
  v_customer_phone_clean text;
BEGIN
  -- Input sanity
  IF p_payment_method NOT IN ('cash','card','credit','mixed') THEN
    RAISE EXCEPTION 'INVALID_METHOD: %', p_payment_method USING ERRCODE = 'P0001';
  END IF;
  IF p_cash_amount < 0 OR p_card_amount < 0 OR p_credit_amount < 0 OR p_manager_card_margin < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_AMOUNT' USING ERRCODE = 'P0001';
  END IF;
  IF p_card_fee_rate < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_FEE_RATE' USING ERRCODE = 'P0001';
  END IF;

  -- 1. Lock receipt
  SELECT id, gross_total, status, payment_method, business_day_id
    INTO v_receipt
  FROM public.receipts
  WHERE id = p_receipt_id
    AND store_uuid = p_store_uuid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RECEIPT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- 2. Already paid?
  IF v_receipt.payment_method IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_PAID: method=%', v_receipt.payment_method USING ERRCODE = 'P0001';
  END IF;

  -- 3. Amount composition
  v_total := p_cash_amount + p_card_amount + p_credit_amount;
  IF v_total <> v_receipt.gross_total THEN
    RAISE EXCEPTION 'AMOUNT_MISMATCH: total=%, gross_total=%', v_total, v_receipt.gross_total
      USING ERRCODE = 'P0001';
  END IF;

  -- 4. Single-method exclusivity
  IF p_payment_method = 'cash'   AND (p_card_amount > 0 OR p_credit_amount > 0) THEN
    RAISE EXCEPTION 'INVALID_METHOD_COMPOSITION: cash' USING ERRCODE = 'P0001';
  END IF;
  IF p_payment_method = 'card'   AND (p_cash_amount > 0 OR p_credit_amount > 0) THEN
    RAISE EXCEPTION 'INVALID_METHOD_COMPOSITION: card' USING ERRCODE = 'P0001';
  END IF;
  IF p_payment_method = 'credit' AND (p_cash_amount > 0 OR p_card_amount   > 0) THEN
    RAISE EXCEPTION 'INVALID_METHOD_COMPOSITION: credit' USING ERRCODE = 'P0001';
  END IF;

  -- 5. Customer name required when credit amount is present
  v_customer_name_clean := NULLIF(btrim(COALESCE(p_customer_name,'')),'');
  v_customer_phone_clean := NULLIF(btrim(COALESCE(p_customer_phone,'')),'');
  IF p_credit_amount > 0 AND v_customer_name_clean IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_NAME_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  -- 6. Card fee
  IF p_card_amount > 0 THEN
    v_card_fee_amount := floor(p_card_amount::numeric * p_card_fee_rate)::int;
  END IF;

  -- 7. Conditionally insert credit row
  IF p_credit_amount > 0 THEN
    SELECT room_uuid INTO v_room_uuid
    FROM public.room_sessions
    WHERE id = p_session_id;

    INSERT INTO public.credits (
      store_uuid, session_id, receipt_id, business_day_id,
      room_uuid, manager_membership_id, customer_name, customer_phone,
      amount, status
    ) VALUES (
      p_store_uuid, p_session_id, p_receipt_id, v_receipt.business_day_id,
      v_room_uuid, p_manager_membership_id, v_customer_name_clean, v_customer_phone_clean,
      p_credit_amount, 'pending'
    )
    RETURNING id INTO v_credit_id;
  END IF;

  -- 8. Atomic receipt update (payment_method single-assignment)
  UPDATE public.receipts
  SET payment_method = p_payment_method,
      cash_amount = p_cash_amount,
      card_amount = p_card_amount,
      credit_amount = p_credit_amount,
      card_fee_rate = p_card_fee_rate,
      card_fee_amount = v_card_fee_amount,
      manager_card_margin = p_manager_card_margin,
      credit_id = v_credit_id,
      updated_at = now()
  WHERE id = p_receipt_id
    AND store_uuid = p_store_uuid
    AND payment_method IS NULL;

  IF NOT FOUND THEN
    -- Defensive: should be unreachable due to FOR UPDATE above.
    RAISE EXCEPTION 'ALREADY_PAID_RACE' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'receipt_id', p_receipt_id,
    'session_id', p_session_id,
    'payment_method', p_payment_method,
    'gross_total', v_receipt.gross_total,
    'cash_amount', p_cash_amount,
    'card_amount', p_card_amount,
    'credit_amount', p_credit_amount,
    'card_fee_rate', p_card_fee_rate,
    'card_fee_amount', v_card_fee_amount,
    'manager_card_margin', p_manager_card_margin,
    'credit_id', v_credit_id,
    'status', v_receipt.status
  );
END;
$$;

-- ============================================================
-- Permissions
-- ============================================================
-- Supabase service_role bypasses function ACLs at the PostgREST level, but
-- being explicit protects against inadvertent grants of anon/authenticated.
REVOKE ALL ON FUNCTION public.close_session_atomic(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_payment_atomic(
  uuid, uuid, uuid, text, int, int, int, int, numeric, text, text, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_session_atomic(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_payment_atomic(
  uuid, uuid, uuid, text, int, int, int, int, numeric, text, text, uuid
) TO service_role;

COMMIT;
