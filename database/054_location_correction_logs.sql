-- 054_location_correction_logs.sql
--
-- 검수자 활동 로그 — APPEND-ONLY.
--
-- 관계:
--   - ble_presence_corrections (049) 는 display overlay. is_active 플립,
--     모니터 렌더링이 목적.
--   - location_correction_logs 는 감사/운영자 확인 용도. INSERT only;
--     UPDATE/DELETE 는 트리거로 거부.
--   - 같은 트랜잭션에서 overlay + log + history 를 묶어 쓰는 경로는
--     056 의 write_location_correction() RPC 가 유일한 쓰기 진입점.
--
-- 쿼리 패턴 (API 4종):
--   by-user       : (corrected_by_user_id, corrected_on)
--   daily-summary : (corrected_by_user_id, corrected_on, error_type)  GROUP BY
--   overview      : (corrected_on, detected_store_uuid | detected_floor)
--   target audit  : (target_membership_id, corrected_at)
--
-- Denormalization 근거:
--   target_name / corrected_by_nickname / role / store_name / room_no /
--   floor 등은 당시 snapshot. 이름·역할 변경에 무관하게 감사 가치 유지.
--
-- 참조:
--   orchestration/tasks/ble-monitor-final-extension.md
--   orchestration/tasks/ble-monitor-validation-checklist.md

CREATE TABLE IF NOT EXISTS public.location_correction_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 1. 검수 대상
  target_membership_id uuid NOT NULL REFERENCES public.store_memberships(id),
  target_hostess_id    uuid,
  target_name          text NOT NULL,

  -- 2. 시스템이 본 (잘못된) 위치
  detected_floor       int,
  detected_store_uuid  uuid REFERENCES public.stores(id),
  detected_store_name  text,
  detected_room_uuid   uuid REFERENCES public.rooms(id),
  detected_room_no     text,
  detected_zone        text,
  detected_at          timestamptz,

  -- 3. 실제(수정) 위치
  corrected_floor      int,
  corrected_store_uuid uuid REFERENCES public.stores(id),
  corrected_store_name text,
  corrected_room_uuid  uuid REFERENCES public.rooms(id),
  corrected_room_no    text,
  corrected_zone       text NOT NULL,
  corrected_at         timestamptz NOT NULL DEFAULT now(),
  -- Asia/Seoul date for day-grouping summaries (STORED = 인덱스 사용 가능)
  corrected_on         date GENERATED ALWAYS AS
                       ((corrected_at AT TIME ZONE 'Asia/Seoul')::date) STORED,

  -- 4. 검수자 (denorm snapshot)
  corrected_by_user_id        uuid NOT NULL REFERENCES public.profiles(id),
  corrected_by_membership_id  uuid NOT NULL REFERENCES public.store_memberships(id),
  corrected_by_email          text NOT NULL,
  corrected_by_nickname       text NOT NULL,
  corrected_by_role           text NOT NULL,
  corrected_by_store_uuid     uuid NOT NULL REFERENCES public.stores(id),
  corrected_by_store_name     text NOT NULL,

  -- 5. 오류 유형 (enum check)
  error_type  text NOT NULL CHECK (error_type IN (
    'ROOM_MISMATCH',
    'STORE_MISMATCH',
    'HALLWAY_DRIFT',
    'ELEVATOR_ZONE',
    'MANUAL_INPUT_ERROR'
  )),

  -- 6. 메모 + overlay 연결
  correction_note       text,
  overlay_correction_id uuid REFERENCES public.ble_presence_corrections(id),

  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.location_correction_logs IS
  'Append-only BLE location correction audit log. Written ONLY via write_location_correction() RPC (054/056). UPDATE/DELETE blocked by triggers.';

-- ── Indexes (4 + 2 for super_admin overview) ──────────────────────
CREATE INDEX IF NOT EXISTS idx_lcl_user_date
  ON public.location_correction_logs (corrected_by_user_id, corrected_on DESC, corrected_at DESC);

CREATE INDEX IF NOT EXISTS idx_lcl_user_date_etype
  ON public.location_correction_logs (corrected_by_user_id, corrected_on, error_type);

CREATE INDEX IF NOT EXISTS idx_lcl_target
  ON public.location_correction_logs (target_membership_id, corrected_at DESC);

CREATE INDEX IF NOT EXISTS idx_lcl_store_date
  ON public.location_correction_logs (corrected_by_store_uuid, corrected_on DESC);

CREATE INDEX IF NOT EXISTS idx_lcl_date_detected_store
  ON public.location_correction_logs (corrected_on, detected_store_uuid);

CREATE INDEX IF NOT EXISTS idx_lcl_date_detected_floor
  ON public.location_correction_logs (corrected_on, detected_floor);

-- ── Dedup trigger (15s window) ────────────────────────────────────
-- 설계 §CORRECTION DEDUP RULE: same target + same corrected location + 15s.
-- RAISE EXCEPTION with ERRCODE 23505 (unique_violation) 로 RPC EXCEPTION 분기
-- 에서 깨끗하게 구분 가능.
CREATE OR REPLACE FUNCTION public.block_duplicate_correction()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.location_correction_logs
    WHERE target_membership_id = NEW.target_membership_id
      AND corrected_zone = NEW.corrected_zone
      AND corrected_room_uuid IS NOT DISTINCT FROM NEW.corrected_room_uuid
      AND corrected_at > now() - interval '15 seconds'
  ) THEN
    RAISE EXCEPTION
      'DUPLICATE_RECENT_CORRECTION (15s window): target=%, zone=%, room=%',
      NEW.target_membership_id, NEW.corrected_zone, NEW.corrected_room_uuid
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_lcl_dedup ON public.location_correction_logs;
CREATE TRIGGER trg_lcl_dedup
  BEFORE INSERT ON public.location_correction_logs
  FOR EACH ROW EXECUTE FUNCTION public.block_duplicate_correction();

-- ── Append-only triggers (UPDATE/DELETE 거부) ─────────────────────
CREATE OR REPLACE FUNCTION public.deny_loc_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
BEGIN
  RAISE EXCEPTION 'location_correction_logs is append-only (% denied)', TG_OP;
END;
$func$;

DROP TRIGGER IF EXISTS trg_lcl_no_update ON public.location_correction_logs;
CREATE TRIGGER trg_lcl_no_update
  BEFORE UPDATE ON public.location_correction_logs
  FOR EACH ROW EXECUTE FUNCTION public.deny_loc_log_mutation();

DROP TRIGGER IF EXISTS trg_lcl_no_delete ON public.location_correction_logs;
CREATE TRIGGER trg_lcl_no_delete
  BEFORE DELETE ON public.location_correction_logs
  FOR EACH ROW EXECUTE FUNCTION public.deny_loc_log_mutation();
