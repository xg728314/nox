-- 085_archive_on_print.sql
-- 2026-04-24: 정산 마감 + 인쇄 이후 "운영 UI 에서 숨김" (archive) 기능.
--
-- 설계 원칙 (사장 요청 "기록 삭제" 의 법률/분쟁 안전 해석):
--   - hard DELETE 금지. 세법 5년 보관 + 분쟁 증빙용 흔적 유지.
--   - archived_at 타임스탬프만 찍어서 "active 뷰에서 숨김".
--   - 모든 active 쿼리는 `archived_at IS NULL` 필터 추가.
--   - 사후 복원/조회 가능 (owner 전용 archive 페이지, 세무조사 대응).
--
-- 적용 대상:
--   receipts, room_sessions, session_participants, orders, pre_settlements,
--   credits, cross_store_work_records, cross_store_settlement_items,
--   payment_records (+ receipt_snapshots)
--
-- archived_at 필드 의미:
--   NULL  → 활성. 운영 UI 노출.
--   NOT NULL → 인쇄 완료 + 숨김. DB 에는 그대로 있음.
--
-- hard purge 는 별도 migration + cron 으로 30일+ 후 진행 (본 migration 제외).
--
-- 멱등: IF NOT EXISTS 체크.

BEGIN;

-- 1) receipts 에 archived_at 추가 (이미 있으면 skip)
ALTER TABLE receipts       ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE room_sessions  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE session_participants ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE orders         ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE pre_settlements ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE credits        ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- 2) archive 조회용 파셜 인덱스 — active 쿼리를 빠르게
CREATE INDEX IF NOT EXISTS idx_receipts_active
  ON receipts (store_uuid, business_day_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_room_sessions_active
  ON room_sessions (store_uuid, business_day_id, status) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_session_participants_active
  ON session_participants (session_id, status) WHERE archived_at IS NULL;

-- 3) archive 일괄 처리 RPC
--    receipt 1건 인쇄 완료 시 호출 — 같은 세션의 관련 레코드 전부 archive.
--    finalized=receipt.status 일 때만 허용. draft 상태 receipt 는 거부.
CREATE OR REPLACE FUNCTION archive_receipt_bundle(
  p_receipt_id   UUID,
  p_store_uuid   UUID,
  p_actor_id     UUID,
  p_actor_membership UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_receipt     RECORD;
  v_session_id  UUID;
  v_now         TIMESTAMPTZ := now();
  v_counts      JSONB;
BEGIN
  -- receipt 락 + 검증
  SELECT id, store_uuid, session_id, status, archived_at
    INTO v_receipt
  FROM receipts
  WHERE id = p_receipt_id AND store_uuid = p_store_uuid
  FOR UPDATE;

  IF v_receipt IS NULL THEN
    RAISE EXCEPTION 'RECEIPT_NOT_FOUND';
  END IF;
  IF v_receipt.status <> 'finalized' THEN
    RAISE EXCEPTION 'RECEIPT_NOT_FINALIZED';
  END IF;
  IF v_receipt.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_ARCHIVED';
  END IF;

  v_session_id := v_receipt.session_id;

  -- 일괄 archive
  UPDATE receipts            SET archived_at = v_now WHERE id = p_receipt_id;
  UPDATE room_sessions       SET archived_at = v_now WHERE id = v_session_id AND store_uuid = p_store_uuid;
  UPDATE session_participants SET archived_at = v_now
    WHERE session_id = v_session_id AND store_uuid = p_store_uuid AND archived_at IS NULL;
  UPDATE orders              SET archived_at = v_now
    WHERE session_id = v_session_id AND store_uuid = p_store_uuid AND archived_at IS NULL;
  UPDATE pre_settlements     SET archived_at = v_now
    WHERE session_id = v_session_id AND store_uuid = p_store_uuid AND archived_at IS NULL;
  UPDATE credits             SET archived_at = v_now
    WHERE session_id = v_session_id AND store_uuid = p_store_uuid AND archived_at IS NULL;

  -- audit 흔적
  INSERT INTO audit_events (
    store_uuid, actor_profile_id, actor_membership_id,
    actor_role, actor_type, session_id,
    entity_table, entity_id, action, after
  ) VALUES (
    p_store_uuid, p_actor_id, p_actor_membership,
    'owner', 'owner', v_session_id,
    'receipts', p_receipt_id, 'receipt_archived',
    jsonb_build_object('archived_at', v_now, 'source', 'print_complete')
  );

  v_counts := jsonb_build_object(
    'receipt_id', p_receipt_id,
    'session_id', v_session_id,
    'archived_at', v_now
  );
  RETURN v_counts;
END $$;

GRANT EXECUTE ON FUNCTION archive_receipt_bundle(UUID, UUID, UUID, UUID) TO service_role;

COMMIT;
