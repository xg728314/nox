-- migration: foxpro_checkout_session + foxpro_receipt_snapshot
-- round-058 / 2026-04-11
-- receipt_snapshots, receipts unique constraint 추가
-- checkout 원자적 처리 함수 생성

-- 1. unique constraints
ALTER TABLE public.receipt_snapshots 
ADD CONSTRAINT uq_receipt_snapshots_session_id UNIQUE (session_id);

ALTER TABLE public.receipts 
ADD CONSTRAINT uq_receipts_session_id UNIQUE (session_id);

-- 2. foxpro_receipt_snapshot
CREATE OR REPLACE FUNCTION public.foxpro_receipt_snapshot(
  p_session_id uuid,
  p_closed_by uuid DEFAULT NULL,
  p_finalize boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_session record;
  v_order_total int := 0;
  v_participant_total int := 0;
  v_tc_amount int := 0;
  v_manager_amount int := 0;
  v_hostess_amount int := 0;
  v_margin_amount int := 0;
  v_discount_amount int := 0;
  v_service_amount int := 0;
  v_gross_total int := 0;
  v_orders jsonb;
  v_participants jsonb;
  v_snapshot jsonb;
  v_receipt_id uuid;
begin
  select rs.id, rs.store_uuid, rs.room_uuid, rs.business_day_id,
         rs.started_at, rs.ended_at, rs.status
    into v_session
  from public.room_sessions rs
  where rs.id = p_session_id;

  if v_session.id is null then
    raise exception 'SESSION_NOT_FOUND: %', p_session_id;
  end if;

  select
    coalesce(sum(o.qty * o.unit_price), 0),
    coalesce(
      jsonb_agg(jsonb_build_object(
        'id', o.id,
        'item_name', o.item_name,
        'order_type', o.order_type,
        'qty', o.qty,
        'unit_price', o.unit_price,
        'total', o.qty * o.unit_price,
        'ordered_by', o.ordered_by,
        'created_at', o.created_at
      )), '[]'::jsonb
    )
  into v_order_total, v_orders
  from public.orders o
  where o.session_id = p_session_id
    and o.deleted_at is null;

  select
    coalesce(sum(sp.price_amount), 0),
    coalesce(sum(sp.manager_payout_amount), 0),
    coalesce(sum(sp.hostess_payout_amount), 0),
    coalesce(sum(sp.margin_amount), 0),
    coalesce(
      jsonb_agg(jsonb_build_object(
        'id', sp.id,
        'membership_id', sp.membership_id,
        'role', sp.role,
        'category', sp.category,
        'time_minutes', sp.time_minutes,
        'price_amount', sp.price_amount,
        'manager_payout_amount', sp.manager_payout_amount,
        'hostess_payout_amount', sp.hostess_payout_amount,
        'margin_amount', sp.margin_amount,
        'status', sp.status,
        'entered_at', sp.entered_at,
        'left_at', sp.left_at
      )), '[]'::jsonb
    )
  into v_participant_total, v_manager_amount, v_hostess_amount, v_margin_amount, v_participants
  from public.session_participants sp
  where sp.session_id = p_session_id
    and sp.deleted_at is null;

  v_tc_amount := v_participant_total - v_manager_amount - v_hostess_amount - v_margin_amount;
  v_gross_total := v_order_total + v_participant_total;

  v_snapshot := jsonb_build_object(
    'session_id', p_session_id,
    'store_uuid', v_session.store_uuid,
    'room_uuid', v_session.room_uuid,
    'business_day_id', v_session.business_day_id,
    'started_at', v_session.started_at,
    'ended_at', v_session.ended_at,
    'gross_total', v_gross_total,
    'order_total_amount', v_order_total,
    'participant_total_amount', v_participant_total,
    'tc_amount', v_tc_amount,
    'manager_amount', v_manager_amount,
    'hostess_amount', v_hostess_amount,
    'margin_amount', v_margin_amount,
    'discount_amount', 0,
    'service_amount', 0,
    'orders', v_orders,
    'participants', v_participants
  );

  insert into public.receipt_snapshots (
    session_id, store_uuid, room_uuid, snapshot, created_by, created_at
  ) values (
    p_session_id,
    v_session.store_uuid,
    v_session.room_uuid,
    v_snapshot,
    p_closed_by,
    now()
  )
  on conflict (session_id) do update
    set snapshot = excluded.snapshot,
        created_by = excluded.created_by,
        created_at = excluded.created_at
  returning id into v_receipt_id;

  if p_finalize then
    insert into public.receipts (
      session_id, store_uuid, business_day_id, version,
      gross_total, tc_amount, manager_amount, hostess_amount,
      margin_amount, order_total_amount, participant_total_amount,
      discount_amount, service_amount,
      status, finalized_at, finalized_by, snapshot, created_at, updated_at
    ) values (
      p_session_id,
      v_session.store_uuid,
      v_session.business_day_id,
      1,
      v_gross_total, v_tc_amount, v_manager_amount, v_hostess_amount,
      v_margin_amount, v_order_total, v_participant_total,
      0, 0,
      'finalized', now(), p_closed_by, v_snapshot, now(), now()
    )
    on conflict (session_id) do update
      set snapshot = excluded.snapshot,
          gross_total = excluded.gross_total,
          tc_amount = excluded.tc_amount,
          manager_amount = excluded.manager_amount,
          hostess_amount = excluded.hostess_amount,
          margin_amount = excluded.margin_amount,
          order_total_amount = excluded.order_total_amount,
          participant_total_amount = excluded.participant_total_amount,
          finalized_at = excluded.finalized_at,
          finalized_by = excluded.finalized_by,
          updated_at = now();
  end if;

  return v_snapshot;
end;
$$;

-- 3. foxpro_checkout_session
CREATE OR REPLACE FUNCTION public.foxpro_checkout_session(
  p_session_id uuid,
  p_closed_by uuid DEFAULT NULL,
  p_ended_at timestamptz DEFAULT now(),
  p_make_snapshot boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_session_id uuid;
  v_session_status text;
  v_receipt jsonb;
begin
  select rs.id, rs.status
    into v_session_id, v_session_status
  from public.room_sessions rs
  where rs.id = p_session_id
  limit 1
  for update;

  if v_session_id is null then
    raise exception 'SESSION_NOT_FOUND: %', p_session_id;
  end if;

  if v_session_status = 'closed' then
    return jsonb_build_object(
      'ok', true,
      'already_closed', true,
      'session_id', p_session_id
    );
  end if;

  update public.session_participants sp
     set left_at = coalesce(sp.left_at, p_ended_at),
         status = case when coalesce(sp.status, 'active') = 'active' then 'closed' else sp.status end,
         updated_at = now()
   where sp.session_id = p_session_id
     and (sp.left_at is null or coalesce(sp.status, 'active') = 'active');

  update public.room_sessions rs
     set status = 'closed',
         ended_at = coalesce(p_ended_at, now()),
         closed_by = p_closed_by
   where rs.id = p_session_id;

  if coalesce(p_make_snapshot, true) then
    v_receipt := public.foxpro_receipt_snapshot(p_session_id, p_closed_by, true);
  else
    v_receipt := public.foxpro_receipt_snapshot(p_session_id, p_closed_by, false);
  end if;

  return jsonb_build_object(
    'ok', true,
    'session_id', p_session_id,
    'checkout_at', coalesce(p_ended_at, now()),
    'receipt', v_receipt
  );
end;
$$;