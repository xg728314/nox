-- ============================================================
-- NOX DB Baseline: Constraints (2026-04-24 스냅샷)
-- ============================================================
-- 본 파일은 현 DB 의 CHECK / FK / UNIQUE 제약을 전부 기록.
-- 신규 환경 재생성 시: `supabase db pull` 결과가 정식 경로.
-- 본 파일은 참조 / 부분 복제용.
-- ============================================================

-- ══════════ CHECK 제약 (61) ══════════

-- admin_access_logs
ALTER TABLE admin_access_logs ADD CONSTRAINT admin_access_logs_kind_check
  CHECK ((action_kind = ANY (ARRAY['read'::text, 'write'::text])));

-- auth_rate_limits
ALTER TABLE auth_rate_limits ADD CONSTRAINT auth_rate_limits_action_check
  CHECK ((action = ANY (ARRAY['login'::text, 'login_email'::text, 'otp_verify'::text, 'otp_resend'::text, 'signup'::text])));

-- ble_feedback
ALTER TABLE ble_feedback ADD CONSTRAINT ble_feedback_feedback_type_check
  CHECK ((feedback_type = ANY (ARRAY['positive'::text, 'negative'::text])));

-- ble_gateways
ALTER TABLE ble_gateways ADD CONSTRAINT ble_gateways_gateway_type_check
  CHECK ((gateway_type = ANY (ARRAY['room'::text, 'floor_hall'::text, 'building_hall'::text, 'counter'::text])));

-- ble_ingest_events
ALTER TABLE ble_ingest_events ADD CONSTRAINT ble_ingest_events_event_type_check
  CHECK ((event_type = ANY (ARRAY['enter'::text, 'leave'::text, 'heartbeat'::text])));

-- ble_presence_history
ALTER TABLE ble_presence_history ADD CONSTRAINT ble_presence_history_source_check
  CHECK ((source = ANY (ARRAY['ble'::text, 'corrected'::text])));

-- chat_rooms
ALTER TABLE chat_rooms ADD CONSTRAINT chat_rooms_type_check
  CHECK ((type = ANY (ARRAY['global'::text, 'group'::text, 'room_session'::text, 'direct'::text])));

-- credits
ALTER TABLE credits ADD CONSTRAINT credits_status_check
  CHECK ((status = ANY (ARRAY['pending'::text, 'collected'::text, 'cancelled'::text])));

-- cross_store_settlement_items
ALTER TABLE cross_store_settlement_items ADD CONSTRAINT chk_csi_amount_pos CHECK ((amount > (0)::numeric));
ALTER TABLE cross_store_settlement_items ADD CONSTRAINT chk_csi_paid_nonneg CHECK ((paid_amount >= (0)::numeric));
ALTER TABLE cross_store_settlement_items ADD CONSTRAINT chk_csi_remaining_nonneg CHECK ((remaining_amount >= (0)::numeric));
ALTER TABLE cross_store_settlement_items ADD CONSTRAINT chk_csi_status
  CHECK ((status = ANY (ARRAY['open'::text, 'partial'::text, 'completed'::text])));

-- cross_store_settlements
ALTER TABLE cross_store_settlements ADD CONSTRAINT chk_css_not_self CHECK ((from_store_uuid <> to_store_uuid));
ALTER TABLE cross_store_settlements ADD CONSTRAINT chk_css_paid_nonneg CHECK ((prepaid_amount >= (0)::numeric));
ALTER TABLE cross_store_settlements ADD CONSTRAINT chk_css_remaining_nonneg CHECK ((remaining_amount >= (0)::numeric));
ALTER TABLE cross_store_settlements ADD CONSTRAINT chk_css_status
  CHECK ((status = ANY (ARRAY['open'::text, 'partial'::text, 'completed'::text])));
ALTER TABLE cross_store_settlements ADD CONSTRAINT chk_css_total_nonneg CHECK ((total_amount >= (0)::numeric));

-- location_correction_logs
ALTER TABLE location_correction_logs ADD CONSTRAINT location_correction_logs_error_type_check
  CHECK ((error_type = ANY (ARRAY['ROOM_MISMATCH'::text, 'STORE_MISMATCH'::text, 'HALLWAY_DRIFT'::text, 'ELEVATOR_ZONE'::text, 'MANUAL_INPUT_ERROR'::text])));

-- manager_financial_permissions
ALTER TABLE manager_financial_permissions ADD CONSTRAINT mfp_revoke_triplet_consistent
  CHECK (
    ((revoked_at IS NULL) AND (revoked_by_user_id IS NULL) AND (revoked_by_membership_id IS NULL))
    OR
    ((revoked_at IS NOT NULL) AND (revoked_by_user_id IS NOT NULL) AND (revoked_by_membership_id IS NOT NULL))
  );

-- manager_prepayments
ALTER TABLE manager_prepayments ADD CONSTRAINT chk_manager_prepayments_amount_positive CHECK ((amount > (0)::numeric));
ALTER TABLE manager_prepayments ADD CONSTRAINT chk_manager_prepayments_status
  CHECK ((status = ANY (ARRAY['active'::text, 'canceled'::text])));

-- orders
ALTER TABLE orders ADD CONSTRAINT orders_customer_amount_check CHECK ((customer_amount >= 0));
ALTER TABLE orders ADD CONSTRAINT orders_manager_amount_check CHECK ((manager_amount >= 0));
ALTER TABLE orders ADD CONSTRAINT orders_qty_check CHECK ((qty > 0));
ALTER TABLE orders ADD CONSTRAINT orders_sale_price_check CHECK ((sale_price >= 0));
ALTER TABLE orders ADD CONSTRAINT orders_store_price_check CHECK ((store_price >= 0));
ALTER TABLE orders ADD CONSTRAINT orders_unit_price_check CHECK ((unit_price >= 0));

-- payout_records
ALTER TABLE payout_records ADD CONSTRAINT chk_payout_records_amount_pos CHECK ((amount > (0)::numeric));
ALTER TABLE payout_records ADD CONSTRAINT chk_payout_records_payout_type
  CHECK ((payout_type = ANY (ARRAY['full'::text, 'partial'::text, 'prepayment'::text, 'cross_store_prepay'::text, 'reversal'::text])));
ALTER TABLE payout_records ADD CONSTRAINT chk_payout_records_recipient_type
  CHECK ((recipient_type = ANY (ARRAY['hostess'::text, 'manager'::text])));
ALTER TABLE payout_records ADD CONSTRAINT chk_payout_records_status
  CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'cancelled'::text])));

-- receipts
ALTER TABLE receipts ADD CONSTRAINT receipts_gross_total_check CHECK ((gross_total >= 0));
ALTER TABLE receipts ADD CONSTRAINT receipts_order_total_amount_check CHECK ((order_total_amount >= 0));
ALTER TABLE receipts ADD CONSTRAINT receipts_participant_total_amount_check CHECK ((participant_total_amount >= 0));
ALTER TABLE receipts ADD CONSTRAINT receipts_status_check
  CHECK ((status = ANY (ARRAY['draft'::text, 'finalized'::text])));
ALTER TABLE receipts ADD CONSTRAINT receipts_tc_amount_check CHECK ((tc_amount >= 0));

-- room_sessions
ALTER TABLE room_sessions ADD CONSTRAINT room_sessions_status_check
  CHECK ((status = ANY (ARRAY['active'::text, 'closed'::text, 'void'::text])));

-- session_manager_shares
ALTER TABLE session_manager_shares ADD CONSTRAINT chk_sms_amount_nonneg CHECK ((amount >= (0)::numeric));

-- session_participant_action_applies
ALTER TABLE session_participant_action_applies ADD CONSTRAINT session_participant_action_applies_apply_status_check
  CHECK ((apply_status = ANY (ARRAY['pending'::text, 'success'::text, 'failed'::text])));
ALTER TABLE session_participant_action_applies ADD CONSTRAINT session_participant_action_applies_attempt_count_check
  CHECK ((attempt_count >= 0));

-- session_participant_actions
ALTER TABLE session_participant_actions ADD CONSTRAINT session_participant_actions_action_type_check
  CHECK ((action_type = ANY (ARRAY['still_working'::text, 'end_now'::text, 'extend'::text])));

-- session_participants
ALTER TABLE session_participants ADD CONSTRAINT session_participants_price_amount_check CHECK ((price_amount >= 0));
ALTER TABLE session_participants ADD CONSTRAINT session_participants_role_check
  CHECK ((role = ANY (ARRAY['manager'::text, 'hostess'::text])));
ALTER TABLE session_participants ADD CONSTRAINT session_participants_status_check
  CHECK ((status = ANY (ARRAY['active'::text, 'left'::text])));
ALTER TABLE session_participants ADD CONSTRAINT session_participants_time_minutes_check CHECK ((time_minutes >= 0));

-- settlement_items
ALTER TABLE settlement_items ADD CONSTRAINT chk_settlement_items_amount_nonneg CHECK ((amount >= (0)::numeric));
ALTER TABLE settlement_items ADD CONSTRAINT chk_settlement_items_paid_nonneg CHECK ((paid_amount >= (0)::numeric));
ALTER TABLE settlement_items ADD CONSTRAINT chk_settlement_items_remaining_nonneg CHECK ((remaining_amount >= (0)::numeric));
ALTER TABLE settlement_items ADD CONSTRAINT chk_settlement_items_sum CHECK (((paid_amount + remaining_amount) = amount));

-- settlement_records
ALTER TABLE settlement_records ADD CONSTRAINT settlement_records_status_check
  CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'paid'::text])));

-- store_memberships
ALTER TABLE store_memberships ADD CONSTRAINT store_memberships_role_check
  CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'hostess'::text])));
ALTER TABLE store_memberships ADD CONSTRAINT store_memberships_status_check
  CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'suspended'::text])));

-- store_operating_days
ALTER TABLE store_operating_days ADD CONSTRAINT store_operating_days_status_check
  CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])));

-- store_settings
ALTER TABLE store_settings ADD CONSTRAINT store_settings_hostess_payout_rate_check
  CHECK (((hostess_payout_rate >= (0)::numeric) AND (hostess_payout_rate <= (1)::numeric)));
ALTER TABLE store_settings ADD CONSTRAINT store_settings_manager_payout_rate_check
  CHECK (((manager_payout_rate >= (0)::numeric) AND (manager_payout_rate <= (1)::numeric)));
ALTER TABLE store_settings ADD CONSTRAINT store_settings_payout_basis_check
  CHECK ((payout_basis = ANY (ARRAY['gross'::text, 'netOfTC'::text])));
ALTER TABLE store_settings ADD CONSTRAINT store_settings_rounding_unit_check CHECK ((rounding_unit > 0));
ALTER TABLE store_settings ADD CONSTRAINT store_settings_tc_rate_check
  CHECK (((tc_rate >= (0)::numeric) AND (tc_rate <= (1)::numeric)));

-- stores
ALTER TABLE stores ADD CONSTRAINT stores_floor_check CHECK (((floor >= 5) AND (floor <= 8)));

-- transfer_requests
ALTER TABLE transfer_requests ADD CONSTRAINT transfer_requests_check CHECK ((from_store_uuid <> to_store_uuid));
ALTER TABLE transfer_requests ADD CONSTRAINT transfer_requests_status_check
  CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text])));

-- user_global_roles
ALTER TABLE user_global_roles ADD CONSTRAINT user_global_roles_role_check CHECK ((role = 'super_admin'::text));
ALTER TABLE user_global_roles ADD CONSTRAINT user_global_roles_status_check
  CHECK ((status = ANY (ARRAY['approved'::text, 'suspended'::text])));

-- ══════════ UNIQUE 제약 (PK 외, 약 30) ══════════
-- FK + UNIQUE 는 raw 덤프량이 많아 `supabase db pull` 권장.
-- 주요 UNIQUE 만 기록:
ALTER TABLE store_memberships ADD CONSTRAINT store_memberships_id_store_uuid_key UNIQUE (id, store_uuid);
ALTER TABLE store_memberships ADD CONSTRAINT store_memberships_profile_id_store_uuid_role_key UNIQUE (profile_id, store_uuid, role);
ALTER TABLE store_operating_days ADD CONSTRAINT store_operating_days_id_store_uuid_key UNIQUE (id, store_uuid);
ALTER TABLE store_operating_days ADD CONSTRAINT store_operating_days_store_uuid_business_date_key UNIQUE (store_uuid, business_date);
ALTER TABLE store_settings ADD CONSTRAINT store_settings_store_uuid_key UNIQUE (store_uuid);
ALTER TABLE rooms ADD CONSTRAINT rooms_id_store_uuid_key UNIQUE (id, store_uuid);
ALTER TABLE rooms ADD CONSTRAINT rooms_store_uuid_room_no_key UNIQUE (store_uuid, room_no);
ALTER TABLE closing_reports ADD CONSTRAINT closing_reports_store_uuid_business_day_id_key UNIQUE (store_uuid, business_day_id);
ALTER TABLE hostesses ADD CONSTRAINT hostesses_membership_id_key UNIQUE (membership_id);
ALTER TABLE managers ADD CONSTRAINT managers_membership_id_key UNIQUE (membership_id);
ALTER TABLE receipt_snapshots ADD CONSTRAINT uq_receipt_snapshots_session_id UNIQUE (session_id);
ALTER TABLE receipts ADD CONSTRAINT receipts_session_id_version_key UNIQUE (session_id, version);
ALTER TABLE receipts ADD CONSTRAINT uq_receipts_session_id UNIQUE (session_id);
ALTER TABLE user_global_roles ADD CONSTRAINT user_global_roles_user_role_uniq UNIQUE (user_id, role);
ALTER TABLE user_mfa_settings ADD CONSTRAINT user_mfa_settings_user_id_key UNIQUE (user_id);
ALTER TABLE ble_gateways ADD CONSTRAINT ble_gateways_gateway_id_key UNIQUE (gateway_id);
ALTER TABLE ble_gateways ADD CONSTRAINT ble_gateways_gateway_secret_key UNIQUE (gateway_secret);
ALTER TABLE ble_tags ADD CONSTRAINT ble_tags_store_uuid_minor_key UNIQUE (store_uuid, minor);
ALTER TABLE ble_tag_presence ADD CONSTRAINT ble_tag_presence_store_uuid_minor_key UNIQUE (store_uuid, minor);

-- ══════════ FK 는 supabase db pull 사용 권장 (~140개) ══════════
-- 직접 기록하면 에러 확률 높음. 공식 도구 사용이 정석.
