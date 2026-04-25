-- ════════════════════════════════════════════════════════════════
-- NOX 실전 투입 전 데이터 NUKE — Supabase SQL Editor 에서 실행
-- ════════════════════════════════════════════════════════════════
-- 정책:
--   ✓ KEEP — auth.users.email = 'xg728314@gmail.com' 1명
--   ✓ KEEP — 그 사람의 profile + store_memberships
--   ✗ DELETE — 그 외 모든 운영 데이터 (orphan 포함)
--
-- 사용:
--   1. Supabase Dashboard → SQL Editor → New query
--   2. 이 파일 전체 붙여넣기 → Run
--   3. 결과 NOTICE 메시지로 단계별 삭제 row 수 확인
--   4. 이후 스크립트 scripts/cleanup/delete-auth-users.ts 로 auth.users 정리
--
-- 안전장치:
--   - DO 블록 안에서 keep_user_id 확정 후 진행
--   - keep_user_id 없으면 EXCEPTION → 즉시 ROLLBACK
--   - 단일 트랜잭션 (Postgres 가 자동 BEGIN/COMMIT)
--   - 실패 시 전체 롤백 → 부분 삭제 없음
-- ════════════════════════════════════════════════════════════════

DO $$
DECLARE
  keep_user_id uuid;
  keep_member_count int;
  v_count int;
BEGIN
  -- 1. keep user 확정
  SELECT id INTO keep_user_id FROM auth.users WHERE email = 'xg728314@gmail.com';
  IF keep_user_id IS NULL THEN
    RAISE EXCEPTION 'xg728314@gmail.com 계정 없음 — 절대 진행 X';
  END IF;
  RAISE NOTICE '✓ KEEP user_id: %', keep_user_id;

  SELECT count(*) INTO keep_member_count FROM store_memberships WHERE profile_id = keep_user_id;
  RAISE NOTICE '✓ KEEP store_memberships: %', keep_member_count;

  -- 2. FK 순서 따라 삭제. 각 단계 row count 출력.

  --- 2a. Time segments (session_participants 자식)
  DELETE FROM participant_time_segments;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'participant_time_segments: -%', v_count;

  --- 2b. Session participants
  DELETE FROM session_participants;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'session_participants: -%', v_count;

  --- 2c. Receipt snapshots / Receipts
  DELETE FROM receipt_snapshots;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'receipt_snapshots: -%', v_count;

  DELETE FROM receipts;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'receipts: -%', v_count;

  --- 2d. Orders
  DELETE FROM orders;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'orders: -%', v_count;

  --- 2e. Credits / pre-settlements
  BEGIN
    DELETE FROM credits;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'credits: -%', v_count;
  EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE 'credits: skip (table not found)';
  END;

  BEGIN
    DELETE FROM pre_settlements;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'pre_settlements: -%', v_count;
  EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE 'pre_settlements: skip (table not found)';
  END;

  --- 2f. Cross-store
  BEGIN
    DELETE FROM cross_store_settlement_items;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'cross_store_settlement_items: -%', v_count;
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN
    DELETE FROM cross_store_settlements;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'cross_store_settlements: -%', v_count;
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN
    DELETE FROM cross_store_work_records;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'cross_store_work_records: -%', v_count;
  EXCEPTION WHEN undefined_table THEN NULL; END;

  --- 2g. Staff attendance / work logs / location-correction logs
  BEGIN
    DELETE FROM staff_attendance;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'staff_attendance: -%', v_count;
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN
    DELETE FROM session_participant_actions;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'session_participant_actions: -%', v_count;
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN
    DELETE FROM location_correction_logs;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'location_correction_logs: -%', v_count;
  EXCEPTION WHEN undefined_table THEN NULL; END;

  --- 2h. Transfer
  BEGIN
    DELETE FROM transfer_requests;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'transfer_requests: -%', v_count;
  EXCEPTION WHEN undefined_table THEN NULL; END;

  --- 2i. Chat
  BEGIN
    DELETE FROM chat_messages;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'chat_messages: -%', v_count;
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN
    DELETE FROM chat_participants;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'chat_participants: -%', v_count;
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN
    DELETE FROM chat_rooms WHERE created_by != keep_user_id OR created_by IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'chat_rooms: -%', v_count;
  EXCEPTION WHEN undefined_table THEN NULL; END;

  --- 2j. Hostesses / managers (전체 nuke — 운영자가 hostess/manager 면 별도 처리 필요)
  DELETE FROM hostesses;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'hostesses: -%', v_count;

  DELETE FROM managers;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'managers: -%', v_count;

  --- 2k. Inventory
  BEGIN
    DELETE FROM inventory_transactions;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'inventory_transactions: -%', v_count;
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN
    DELETE FROM inventory_items;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'inventory_items: -%', v_count;
  EXCEPTION WHEN undefined_table THEN NULL; END;

  --- 2l. BLE / paper ledger (운영 부수 데이터)
  BEGIN DELETE FROM ble_presence_history; EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN DELETE FROM ble_tag_presence; EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN DELETE FROM ble_ingest_events; EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN DELETE FROM ble_tags; EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN DELETE FROM ble_gateways; EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN DELETE FROM paper_ledger_diffs; EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN DELETE FROM paper_ledger_extractions; EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN DELETE FROM paper_ledger_snapshots; EXCEPTION WHEN undefined_table THEN NULL; END;
  RAISE NOTICE 'BLE / paper_ledger: cleared';

  --- 2m. Issues / errors
  BEGIN DELETE FROM issue_reports; EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN DELETE FROM system_errors; EXCEPTION WHEN undefined_table THEN NULL; END;

  --- 2n. Audit events
  DELETE FROM audit_events;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'audit_events: -%', v_count;

  BEGIN DELETE FROM audit_events_archive; EXCEPTION WHEN undefined_table THEN NULL; END;

  --- 2o. Closing / operating days
  BEGIN
    DELETE FROM closing_reports;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'closing_reports: -%', v_count;
  EXCEPTION WHEN undefined_table THEN NULL; END;

  DELETE FROM store_operating_days;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'store_operating_days: -%', v_count;

  --- 2p. Room sessions
  DELETE FROM room_sessions;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'room_sessions: -%', v_count;

  --- 2q. Auth / security
  BEGIN
    DELETE FROM user_mfa_settings WHERE user_id != keep_user_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'user_mfa_settings: -%', v_count;
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN
    DELETE FROM trusted_devices WHERE user_id != keep_user_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'trusted_devices: -%', v_count;
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN
    DELETE FROM reauth_verifications WHERE user_id != keep_user_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'reauth_verifications: -%', v_count;
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN
    DELETE FROM auth_rate_limits;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'auth_rate_limits: -%', v_count;
  EXCEPTION WHEN undefined_table THEN NULL; END;

  --- 2r. Memberships (keep 만)
  DELETE FROM store_memberships WHERE profile_id != keep_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'store_memberships: -%', v_count;

  --- 2s. Profiles (keep 만)
  DELETE FROM profiles WHERE id != keep_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'profiles: -%', v_count;

  --- 2t. Stores — 운영자 미소속 매장 삭제 (옵션)
  --- 운영자가 어느 매장에 소속이든 그 매장만 보존.
  DELETE FROM rooms WHERE store_uuid NOT IN (
    SELECT store_uuid FROM store_memberships WHERE profile_id = keep_user_id
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'rooms (orphan stores): -%', v_count;

  DELETE FROM store_settings WHERE store_uuid NOT IN (
    SELECT store_uuid FROM store_memberships WHERE profile_id = keep_user_id
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'store_settings (orphan stores): -%', v_count;

  DELETE FROM store_service_types WHERE store_uuid NOT IN (
    SELECT store_uuid FROM store_memberships WHERE profile_id = keep_user_id
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'store_service_types (orphan stores): -%', v_count;

  DELETE FROM stores WHERE id NOT IN (
    SELECT store_uuid FROM store_memberships WHERE profile_id = keep_user_id
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'stores (orphan): -%', v_count;

  -- 3. 최종 검증
  SELECT count(*) INTO v_count FROM profiles;
  RAISE NOTICE '✓ profiles 잔여: %', v_count;

  SELECT count(*) INTO v_count FROM store_memberships;
  RAISE NOTICE '✓ store_memberships 잔여: %', v_count;

  SELECT count(*) INTO v_count FROM stores;
  RAISE NOTICE '✓ stores 잔여: %', v_count;

  RAISE NOTICE '════════════════════════════════════════';
  RAISE NOTICE 'SQL 정리 완료. 다음 단계: auth.users';
  RAISE NOTICE '  npx tsx scripts/cleanup/delete-auth-users.ts --apply';
  RAISE NOTICE '════════════════════════════════════════';
END $$;
