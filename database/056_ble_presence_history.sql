-- 056_ble_presence_history.sql
--
-- (1) BLE 위치 시간축 append-only 테이블.
-- (2) write_location_correction() RPC — overlay + log + history 3중 기록을
--     단일 트랜잭션으로 묶는 SSOT.
--
-- 저장 조건 (앱 강제, app/api/ble/ingest/route.ts):
--   - room_uuid 변경
--   - OR last_seen_at gap ≥ 10s
--   - OR correction 발생으로 source='corrected' 기록 필요
--   이외의 heartbeat-반복 은 저장하지 않는다.
--
-- Retention: 30일. app/api/cron/ble-history-reaper (Phase 7) 이
--   정리. 이 migration 자체에는 cron 을 포함하지 않음.
--
-- 참조:
--   orchestration/tasks/ble-monitor-final-extension.md
--   [BLE HISTORY REQUIREMENT], [BLE HISTORY SAFETY RULE]

-- ── Table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ble_presence_history (
  id              bigserial PRIMARY KEY,
  store_uuid      uuid NOT NULL REFERENCES public.stores(id),
  membership_id   uuid REFERENCES public.store_memberships(id),
  -- minor: BLE 행은 항상 존재, correction 행은 NULL 허용
  minor           int,
  room_uuid       uuid REFERENCES public.rooms(id),
  zone            text NOT NULL,
  last_event_type text,
  seen_at         timestamptz NOT NULL,
  gateway_id      text,
  source          text NOT NULL DEFAULT 'ble'
                  CHECK (source IN ('ble','corrected'))
);

COMMENT ON TABLE public.ble_presence_history IS
  'Append-only BLE presence trail. Retention: 30 days (reaped by nightly cron in Phase 7). Meaningful-change gate enforced in /api/ble/ingest — heartbeat-마다 저장 금지.';

-- ── Indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_blepresh_member_time
  ON public.ble_presence_history (membership_id, seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_blepresh_store_time
  ON public.ble_presence_history (store_uuid, seen_at DESC);

-- retention reaper 용
CREATE INDEX IF NOT EXISTS idx_blepresh_seen_at
  ON public.ble_presence_history (seen_at);

-- ── RPC: write_location_correction(payload jsonb) → jsonb ─────────
--
-- 단일 TX 안에서:
--   1) 15s dedup 사전 체크 → 있으면 early return { deduplicated: true }
--   2) ble_presence_corrections INSERT (overlay)
--   3) location_correction_logs INSERT
--      (dedup trigger race 시 unique_violation → 전체 TX rollback → deduplicated return)
--   4) ble_presence_history INSERT (source='corrected')
--
-- Caller 는 반드시 이 RPC 를 통해서만 correction 을 write 한다.
-- Direct INSERT 금지 (PR 리뷰 grep 체크).

CREATE OR REPLACE FUNCTION public.write_location_correction(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $func$
DECLARE
  v_overlay_id     uuid;
  v_log_id         uuid;
  v_existing_id    uuid;
  v_target_mid     uuid := (payload->>'target_membership_id')::uuid;
  v_corrected_zone text := payload->>'corrected_zone';
  v_corrected_room uuid := NULLIF(payload->>'corrected_room_uuid','')::uuid;
  v_corrected_stre uuid := (payload->>'corrected_store_uuid')::uuid;
BEGIN
  -- Guardrails
  IF v_target_mid IS NULL THEN
    RAISE EXCEPTION 'target_membership_id is required' USING ERRCODE = '22023';
  END IF;
  IF v_corrected_zone IS NULL OR v_corrected_zone = '' THEN
    RAISE EXCEPTION 'corrected_zone is required' USING ERRCODE = '22023';
  END IF;
  IF v_corrected_stre IS NULL THEN
    RAISE EXCEPTION 'corrected_store_uuid is required' USING ERRCODE = '22023';
  END IF;

  -- (1) Dedup pre-check (fast path — 트리거 race 이전)
  SELECT id INTO v_existing_id
  FROM public.location_correction_logs
  WHERE target_membership_id = v_target_mid
    AND corrected_zone = v_corrected_zone
    AND corrected_room_uuid IS NOT DISTINCT FROM v_corrected_room
    AND corrected_at > now() - interval '15 seconds'
  ORDER BY corrected_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'deduplicated', true,
      'existing_log_id', v_existing_id
    );
  END IF;

  -- (2) Overlay insert (display-layer)
  INSERT INTO public.ble_presence_corrections (
    store_uuid,
    membership_id,
    session_id,
    participant_id,
    original_zone,
    corrected_zone,
    original_room_uuid,
    corrected_room_uuid,
    ble_presence_seen_at,
    corrected_by_membership_id,
    reason,
    note,
    is_active
  ) VALUES (
    v_corrected_stre,
    v_target_mid,
    NULLIF(payload->>'session_id','')::uuid,
    NULLIF(payload->>'participant_id','')::uuid,
    COALESCE(NULLIF(payload->>'detected_zone',''), 'unknown'),
    v_corrected_zone,
    NULLIF(payload->>'detected_room_uuid','')::uuid,
    v_corrected_room,
    NULLIF(payload->>'detected_at','')::timestamptz,
    (payload->>'corrected_by_membership_id')::uuid,
    NULLIF(payload->>'reason',''),
    NULLIF(payload->>'correction_note',''),
    true
  )
  RETURNING id INTO v_overlay_id;

  -- (3) Log insert — dedup trigger 가 race 시 23505 raise → 전체 TX rollback
  INSERT INTO public.location_correction_logs (
    target_membership_id,
    target_hostess_id,
    target_name,
    detected_floor,
    detected_store_uuid,
    detected_store_name,
    detected_room_uuid,
    detected_room_no,
    detected_zone,
    detected_at,
    corrected_floor,
    corrected_store_uuid,
    corrected_store_name,
    corrected_room_uuid,
    corrected_room_no,
    corrected_zone,
    corrected_by_user_id,
    corrected_by_membership_id,
    corrected_by_email,
    corrected_by_nickname,
    corrected_by_role,
    corrected_by_store_uuid,
    corrected_by_store_name,
    error_type,
    correction_note,
    overlay_correction_id
  ) VALUES (
    v_target_mid,
    NULLIF(payload->>'target_hostess_id','')::uuid,
    payload->>'target_name',
    NULLIF(payload->>'detected_floor','')::int,
    NULLIF(payload->>'detected_store_uuid','')::uuid,
    payload->>'detected_store_name',
    NULLIF(payload->>'detected_room_uuid','')::uuid,
    payload->>'detected_room_no',
    payload->>'detected_zone',
    NULLIF(payload->>'detected_at','')::timestamptz,
    NULLIF(payload->>'corrected_floor','')::int,
    v_corrected_stre,
    payload->>'corrected_store_name',
    v_corrected_room,
    payload->>'corrected_room_no',
    v_corrected_zone,
    (payload->>'corrected_by_user_id')::uuid,
    (payload->>'corrected_by_membership_id')::uuid,
    payload->>'corrected_by_email',
    payload->>'corrected_by_nickname',
    payload->>'corrected_by_role',
    (payload->>'corrected_by_store_uuid')::uuid,
    payload->>'corrected_by_store_name',
    payload->>'error_type',
    NULLIF(payload->>'correction_note',''),
    v_overlay_id
  )
  RETURNING id INTO v_log_id;

  -- (4) History insert (source='corrected')
  INSERT INTO public.ble_presence_history (
    store_uuid,
    membership_id,
    minor,
    room_uuid,
    zone,
    last_event_type,
    seen_at,
    source
  ) VALUES (
    v_corrected_stre,
    v_target_mid,
    NULLIF(payload->>'beacon_minor','')::int,
    v_corrected_room,
    v_corrected_zone,
    'correction',
    now(),
    'corrected'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'deduplicated', false,
    'log_id', v_log_id,
    'overlay_correction_id', v_overlay_id,
    'applied', jsonb_build_object(
      'corrected_zone', v_corrected_zone,
      'corrected_room_uuid', v_corrected_room,
      'corrected_store_uuid', v_corrected_stre
    )
  );

EXCEPTION
  WHEN unique_violation THEN
    -- Dedup trigger race 가 catch 된 경우. 앞 INSERT 들은 이 블록으로 rollback.
    RETURN jsonb_build_object(
      'ok', true,
      'deduplicated', true,
      'existing_log_id', NULL,
      'message', SQLERRM
    );
END;
$func$;

COMMENT ON FUNCTION public.write_location_correction(jsonb) IS
  'SSOT for location correction writes. Atomically inserts overlay + log + history in a single TX. Caller (app/api/location/correct) MUST use this RPC; direct table INSERT is forbidden.';
