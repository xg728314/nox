-- ============================================================
-- NOX DB Baseline: Indexes (2026-04-24 스냅샷, PK 제외)
-- Total: 138
-- ============================================================
-- 재생성은 `supabase db pull` 권장. 본 파일은 참조용.
-- ============================================================

-- admin_access_logs
CREATE INDEX idx_admin_access_logs_actor ON public.admin_access_logs USING btree (actor_user_id, created_at DESC);
CREATE INDEX idx_admin_access_logs_screen ON public.admin_access_logs USING btree (screen, created_at DESC);
CREATE INDEX idx_admin_access_logs_store ON public.admin_access_logs USING btree (target_store_uuid, created_at DESC);

-- admin_preference_overrides
CREATE INDEX idx_admin_override_scope ON public.admin_preference_overrides USING btree (scope) WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX uq_admin_override_global ON public.admin_preference_overrides USING btree (scope) WHERE ((store_uuid IS NULL) AND (deleted_at IS NULL));
CREATE UNIQUE INDEX uq_admin_override_store ON public.admin_preference_overrides USING btree (store_uuid, scope) WHERE ((store_uuid IS NOT NULL) AND (deleted_at IS NULL));

-- auth_rate_limits
CREATE INDEX idx_auth_rate_limits_locked ON public.auth_rate_limits USING btree (locked_until) WHERE (locked_until IS NOT NULL);
CREATE UNIQUE INDEX uq_auth_rate_limits_key_action ON public.auth_rate_limits USING btree (bucket_key, action);

-- auth_security_logs
CREATE INDEX idx_auth_sec_logs_email ON public.auth_security_logs USING btree (email, created_at DESC);
CREATE INDEX idx_auth_sec_logs_event ON public.auth_security_logs USING btree (event_type, created_at DESC);
CREATE INDEX idx_auth_sec_logs_ip ON public.auth_security_logs USING btree (ip, created_at DESC);

-- ble_*
CREATE INDEX idx_ble_feedback_by ON public.ble_feedback USING btree (store_uuid, by_membership_id, created_at DESC);
CREATE INDEX idx_ble_feedback_member ON public.ble_feedback USING btree (store_uuid, membership_id, created_at DESC);
CREATE INDEX idx_ble_feedback_store_created ON public.ble_feedback USING btree (store_uuid, created_at DESC);
CREATE INDEX idx_ble_ingest_audit_gw ON public.ble_ingest_audit USING btree (gateway_id, received_at DESC);
CREATE INDEX idx_ble_ingest_audit_store ON public.ble_ingest_audit USING btree (store_uuid, received_at DESC) WHERE (store_uuid IS NOT NULL);
CREATE INDEX idx_ble_ingest_events_dedupe ON public.ble_ingest_events USING btree (gateway_id, observed_at, beacon_minor, event_type);
CREATE INDEX idx_ble_corrections_active ON public.ble_presence_corrections USING btree (store_uuid, is_active, corrected_at DESC);
CREATE INDEX idx_ble_corrections_member ON public.ble_presence_corrections USING btree (store_uuid, membership_id, corrected_at DESC);
CREATE INDEX idx_ble_corrections_participant ON public.ble_presence_corrections USING btree (store_uuid, participant_id, corrected_at DESC);
CREATE INDEX idx_blepresh_member_time ON public.ble_presence_history USING btree (membership_id, seen_at DESC);
CREATE INDEX idx_blepresh_seen_at ON public.ble_presence_history USING btree (seen_at);
CREATE INDEX idx_blepresh_store_time ON public.ble_presence_history USING btree (store_uuid, seen_at DESC);

-- chat_*
CREATE INDEX idx_chat_message_reads_member_room ON public.chat_message_reads USING btree (membership_id, room_id);
CREATE INDEX idx_chat_message_reads_message ON public.chat_message_reads USING btree (message_id);
CREATE UNIQUE INDEX uq_chat_message_reads_room_msg_member ON public.chat_message_reads USING btree (room_id, message_id, membership_id);
CREATE INDEX idx_chat_messages_room ON public.chat_messages USING btree (chat_room_id, created_at DESC);
CREATE INDEX idx_chat_messages_store ON public.chat_messages USING btree (store_uuid, created_at DESC);
CREATE INDEX idx_chat_participants_membership ON public.chat_participants USING btree (membership_id, store_uuid);
CREATE UNIQUE INDEX idx_chat_participants_unique ON public.chat_participants USING btree (chat_room_id, membership_id);
CREATE INDEX idx_chat_read_cursors_member ON public.chat_read_cursors USING btree (membership_id);
CREATE UNIQUE INDEX uq_chat_read_cursors_room_member ON public.chat_read_cursors USING btree (room_id, membership_id);
CREATE UNIQUE INDEX idx_chat_rooms_global_unique ON public.chat_rooms USING btree (store_uuid) WHERE (type = 'global'::text);
CREATE INDEX idx_chat_rooms_session ON public.chat_rooms USING btree (session_id) WHERE (session_id IS NOT NULL);
CREATE UNIQUE INDEX idx_chat_rooms_session_unique ON public.chat_rooms USING btree (session_id) WHERE ((type = 'room_session'::text) AND (session_id IS NOT NULL));
CREATE INDEX idx_chat_rooms_store ON public.chat_rooms USING btree (store_uuid, type);

-- credits
CREATE INDEX idx_credits_customer ON public.credits USING btree (store_uuid, customer_name);
CREATE INDEX idx_credits_status ON public.credits USING btree (store_uuid, status);
CREATE UNIQUE INDEX uq_credits_receipt_pending ON public.credits USING btree (receipt_id) WHERE ((status = 'pending'::text) AND (receipt_id IS NOT NULL) AND (deleted_at IS NULL));

-- cross_store_*
CREATE INDEX idx_cross_store_settlement_items_header ON public.cross_store_settlement_items USING btree (cross_store_settlement_id) WHERE (deleted_at IS NULL);
CREATE INDEX idx_cross_store_settlement_items_store ON public.cross_store_settlement_items USING btree (store_uuid) WHERE (deleted_at IS NULL);
CREATE INDEX idx_cross_store_settlement_items_target_store ON public.cross_store_settlement_items USING btree (target_store_uuid) WHERE (deleted_at IS NULL);
CREATE INDEX idx_cssi_cross_store_work_record ON public.cross_store_settlement_items USING btree (cross_store_work_record_id) WHERE ((cross_store_work_record_id IS NOT NULL) AND (deleted_at IS NULL));
CREATE INDEX idx_cssi_current_handler ON public.cross_store_settlement_items USING btree (current_handler_membership_id) WHERE ((current_handler_membership_id IS NOT NULL) AND (deleted_at IS NULL));
CREATE UNIQUE INDEX uq_cssi_cross_store_work_record ON public.cross_store_settlement_items USING btree (cross_store_work_record_id) WHERE ((cross_store_work_record_id IS NOT NULL) AND (deleted_at IS NULL));
CREATE INDEX idx_cross_store_settlements_from ON public.cross_store_settlements USING btree (from_store_uuid) WHERE (deleted_at IS NULL);
CREATE INDEX idx_cross_store_settlements_to ON public.cross_store_settlements USING btree (to_store_uuid) WHERE (deleted_at IS NULL);
CREATE INDEX idx_cswr_origin ON public.cross_store_work_records USING btree (origin_store_uuid, status);
CREATE INDEX idx_cswr_session ON public.cross_store_work_records USING btree (session_id);
CREATE UNIQUE INDEX idx_cswr_unique ON public.cross_store_work_records USING btree (session_id, hostess_membership_id) WHERE (deleted_at IS NULL);
CREATE INDEX idx_cswr_working ON public.cross_store_work_records USING btree (working_store_uuid, status);

-- customers
CREATE INDEX idx_customers_manager ON public.customers USING btree (store_uuid, manager_membership_id) WHERE (manager_membership_id IS NOT NULL);
CREATE INDEX idx_customers_phone ON public.customers USING btree (store_uuid, phone) WHERE (phone IS NOT NULL);
CREATE INDEX idx_customers_store ON public.customers USING btree (store_uuid);
CREATE INDEX idx_customers_tags ON public.customers USING gin (tags);

-- hostess_deduction_configs
CREATE INDEX idx_hostess_deduction_configs_hostess ON public.hostess_deduction_configs USING btree (hostess_id) WHERE (deleted_at IS NULL);
CREATE INDEX idx_hostess_deduction_configs_store ON public.hostess_deduction_configs USING btree (store_uuid) WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX uq_hostess_deduction_configs_key ON public.hostess_deduction_configs USING btree (store_uuid, hostess_id, service_type, time_type) WHERE (deleted_at IS NULL);

-- inventory_*
CREATE UNIQUE INDEX idx_inventory_items_name_unit ON public.inventory_items USING btree (store_uuid, name, unit) WHERE (deleted_at IS NULL);
CREATE INDEX idx_inventory_items_store ON public.inventory_items USING btree (store_uuid, is_active);
CREATE INDEX idx_inventory_tx_item ON public.inventory_transactions USING btree (item_id, created_at DESC);
CREATE INDEX idx_inventory_tx_store ON public.inventory_transactions USING btree (store_uuid, created_at DESC);

-- location_correction_logs
CREATE INDEX idx_lcl_date_detected_floor ON public.location_correction_logs USING btree (corrected_on, detected_floor);
CREATE INDEX idx_lcl_date_detected_store ON public.location_correction_logs USING btree (corrected_on, detected_store_uuid);
CREATE INDEX idx_lcl_store_date ON public.location_correction_logs USING btree (corrected_by_store_uuid, corrected_on DESC);
CREATE INDEX idx_lcl_target ON public.location_correction_logs USING btree (target_membership_id, corrected_at DESC);
CREATE INDEX idx_lcl_user_date ON public.location_correction_logs USING btree (corrected_by_user_id, corrected_on DESC, corrected_at DESC);
CREATE INDEX idx_lcl_user_date_etype ON public.location_correction_logs USING btree (corrected_by_user_id, corrected_on, error_type);

-- manager_financial_permissions
CREATE INDEX idx_mfp_lookup ON public.manager_financial_permissions USING btree (membership_id, store_uuid) WHERE ((revoked_at IS NULL) AND (deleted_at IS NULL));
CREATE INDEX idx_mfp_store_active ON public.manager_financial_permissions USING btree (store_uuid, granted_at DESC) WHERE ((revoked_at IS NULL) AND (deleted_at IS NULL));
CREATE UNIQUE INDEX uq_mfp_active ON public.manager_financial_permissions USING btree (store_uuid, membership_id) WHERE ((revoked_at IS NULL) AND (deleted_at IS NULL));

-- manager_prepayments
CREATE INDEX idx_manager_prepayments_business_day ON public.manager_prepayments USING btree (business_day_id) WHERE ((deleted_at IS NULL) AND (business_day_id IS NOT NULL));
CREATE INDEX idx_manager_prepayments_executor ON public.manager_prepayments USING btree (executor_membership_id) WHERE ((executor_membership_id IS NOT NULL) AND (deleted_at IS NULL));
CREATE INDEX idx_manager_prepayments_store_target ON public.manager_prepayments USING btree (store_uuid, target_store_uuid) WHERE ((deleted_at IS NULL) AND (status = 'active'::text));
CREATE INDEX idx_manager_prepayments_target_manager ON public.manager_prepayments USING btree (target_store_uuid, target_manager_membership_id) WHERE ((deleted_at IS NULL) AND (status = 'active'::text));

-- orders
CREATE INDEX idx_orders_inventory_item_id ON public.orders USING btree (inventory_item_id) WHERE (inventory_item_id IS NOT NULL);

-- payee_accounts
CREATE INDEX idx_payee_accounts_linked ON public.payee_accounts USING btree (store_uuid, linked_membership_id) WHERE ((deleted_at IS NULL) AND (linked_membership_id IS NOT NULL));
CREATE INDEX idx_payee_accounts_store ON public.payee_accounts USING btree (store_uuid) WHERE (deleted_at IS NULL);

-- payout_records
CREATE INDEX idx_payout_records_executor ON public.payout_records USING btree (executor_membership_id) WHERE ((executor_membership_id IS NOT NULL) AND (deleted_at IS NULL));
CREATE INDEX idx_payout_records_original ON public.payout_records USING btree (original_payout_id) WHERE ((deleted_at IS NULL) AND (original_payout_id IS NOT NULL));
CREATE INDEX idx_payout_records_recipient ON public.payout_records USING btree (store_uuid, recipient_type, recipient_membership_id) WHERE (deleted_at IS NULL);
CREATE INDEX idx_payout_records_reversed_by ON public.payout_records USING btree (reversed_by_payout_id) WHERE ((deleted_at IS NULL) AND (reversed_by_payout_id IS NOT NULL));
CREATE INDEX idx_payout_records_settlement ON public.payout_records USING btree (settlement_id) WHERE ((deleted_at IS NULL) AND (settlement_id IS NOT NULL));
CREATE INDEX idx_payout_records_settlement_item ON public.payout_records USING btree (settlement_item_id) WHERE ((deleted_at IS NULL) AND (settlement_item_id IS NOT NULL));
CREATE INDEX idx_payout_records_store ON public.payout_records USING btree (store_uuid) WHERE (deleted_at IS NULL);
CREATE INDEX idx_payout_records_target_manager ON public.payout_records USING btree (target_manager_membership_id) WHERE ((deleted_at IS NULL) AND (target_manager_membership_id IS NOT NULL));
CREATE INDEX idx_payout_records_target_store ON public.payout_records USING btree (target_store_uuid) WHERE ((deleted_at IS NULL) AND (target_store_uuid IS NOT NULL));

-- pre_settlements
CREATE INDEX idx_pre_settlements_session ON public.pre_settlements USING btree (session_id, store_uuid);
CREATE INDEX idx_pre_settlements_store ON public.pre_settlements USING btree (store_uuid, status);

-- reauth_verifications
CREATE INDEX idx_reauth_verifications_user_action_expires ON public.reauth_verifications USING btree (user_id, action_class, expires_at DESC);

-- receipt_snapshots / receipts
CREATE INDEX idx_receipt_snapshots_session_type ON public.receipt_snapshots USING btree (session_id, receipt_type);

-- room_sessions
CREATE UNIQUE INDEX room_sessions_active_unique ON public.room_sessions USING btree (room_uuid) WHERE (status = 'active'::text);

-- session_* (participants, actions, shares)
CREATE INDEX idx_session_manager_shares_manager ON public.session_manager_shares USING btree (manager_membership_id) WHERE (deleted_at IS NULL);
CREATE INDEX idx_session_manager_shares_session ON public.session_manager_shares USING btree (session_id) WHERE (deleted_at IS NULL);
CREATE INDEX idx_session_manager_shares_store ON public.session_manager_shares USING btree (store_uuid) WHERE (deleted_at IS NULL);
CREATE INDEX idx_spaa_participant_created ON public.session_participant_action_applies USING btree (participant_id, created_at DESC);
CREATE INDEX idx_spaa_requested_by_created ON public.session_participant_action_applies USING btree (requested_by, created_at DESC) WHERE (requested_by IS NOT NULL);
CREATE INDEX idx_spaa_status_attempted ON public.session_participant_action_applies USING btree (apply_status, last_attempted_at);
CREATE UNIQUE INDEX uq_spaa_action_id ON public.session_participant_action_applies USING btree (action_id);
CREATE INDEX idx_spa_actor ON public.session_participant_actions USING btree (store_uuid, acted_by_membership_id, acted_at DESC);
CREATE INDEX idx_spa_participant_acted_at ON public.session_participant_actions USING btree (store_uuid, participant_id, acted_at DESC);
CREATE INDEX idx_session_participants_last_applied_action ON public.session_participants USING btree (last_applied_action_id);
CREATE INDEX idx_session_participants_manager ON public.session_participants USING btree (manager_membership_id) WHERE (manager_membership_id IS NOT NULL);
CREATE INDEX idx_session_store_shares_session ON public.session_store_shares USING btree (session_id) WHERE (deleted_at IS NULL);
CREATE INDEX idx_session_store_shares_store ON public.session_store_shares USING btree (store_uuid) WHERE (deleted_at IS NULL);

-- settlement_*
CREATE INDEX idx_settlement_accounts_owner ON public.settlement_accounts USING btree (store_uuid, owner_membership_id) WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX uq_settlement_accounts_default ON public.settlement_accounts USING btree (store_uuid, owner_membership_id) WHERE ((is_default = true) AND (deleted_at IS NULL));
CREATE INDEX idx_settlement_items_membership ON public.settlement_items USING btree (membership_id) WHERE ((deleted_at IS NULL) AND (membership_id IS NOT NULL));
CREATE INDEX idx_settlement_items_participant ON public.settlement_items USING btree (participant_id) WHERE ((deleted_at IS NULL) AND (participant_id IS NOT NULL));
CREATE INDEX idx_settlement_items_settlement ON public.settlement_items USING btree (settlement_id) WHERE (deleted_at IS NULL);
CREATE INDEX idx_settlement_items_store ON public.settlement_items USING btree (store_uuid) WHERE (deleted_at IS NULL);
CREATE INDEX idx_settlement_records_counterparty ON public.settlement_records USING btree (counterparty_store_uuid, business_date);
CREATE INDEX idx_settlement_records_session ON public.settlement_records USING btree (session_id);
CREATE INDEX idx_settlement_records_store ON public.settlement_records USING btree (store_uuid, business_date);
CREATE INDEX idx_settlements_session ON public.settlements USING btree (session_id) WHERE (deleted_at IS NULL);
CREATE INDEX idx_settlements_store ON public.settlements USING btree (store_uuid) WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX uq_settlements_session_live ON public.settlements USING btree (session_id) WHERE (deleted_at IS NULL);

-- staff_attendance (Round 3 에서 idx_staff_attendance_unique + uq_staff_attendance_open 추가)
CREATE INDEX idx_staff_attendance_store_day ON public.staff_attendance USING btree (store_uuid, business_day_id, status);
CREATE UNIQUE INDEX idx_staff_attendance_unique ON public.staff_attendance USING btree (store_uuid, business_day_id, membership_id) WHERE (status <> 'off_duty'::text);
CREATE UNIQUE INDEX uq_staff_attendance_open ON public.staff_attendance USING btree (store_uuid, business_day_id, membership_id) WHERE (checked_out_at IS NULL);

-- store_memberships (Round 3 에서 ux_store_memberships_one_primary_per_profile 추가)
CREATE UNIQUE INDEX store_memberships_one_primary_per_profile_idx ON public.store_memberships USING btree (profile_id) WHERE ((is_primary = true) AND (deleted_at IS NULL));
CREATE UNIQUE INDEX ux_store_memberships_one_primary_per_profile ON public.store_memberships USING btree (profile_id) WHERE ((is_primary = true) AND (deleted_at IS NULL));

-- store_service_types
CREATE INDEX idx_store_service_types_store_type ON public.store_service_types USING btree (store_uuid, service_type, is_active);
CREATE UNIQUE INDEX idx_store_service_types_unique ON public.store_service_types USING btree (store_uuid, service_type, time_type) WHERE (is_active = true);

-- trusted_devices
CREATE UNIQUE INDEX uq_trusted_devices_user_hash ON public.trusted_devices USING btree (user_id, device_hash) WHERE (revoked_at IS NULL);

-- user_*
CREATE INDEX idx_user_global_roles_user ON public.user_global_roles USING btree (user_id) WHERE ((deleted_at IS NULL) AND (status = 'approved'::text));
CREATE UNIQUE INDEX uq_user_global_roles_user_role ON public.user_global_roles USING btree (user_id, role) WHERE (deleted_at IS NULL);
CREATE INDEX idx_user_mfa_settings_user ON public.user_mfa_settings USING btree (user_id) WHERE (deleted_at IS NULL);
CREATE INDEX idx_user_pref_user_scope ON public.user_preferences USING btree (user_id, scope) WHERE (deleted_at IS NULL);
CREATE UNIQUE INDEX uq_user_pref_global ON public.user_preferences USING btree (user_id, scope) WHERE ((store_uuid IS NULL) AND (deleted_at IS NULL));
CREATE UNIQUE INDEX uq_user_pref_store ON public.user_preferences USING btree (user_id, store_uuid, scope) WHERE ((store_uuid IS NOT NULL) AND (deleted_at IS NULL));
