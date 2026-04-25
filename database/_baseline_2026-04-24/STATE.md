# NOX DB State Snapshot — 2026-04-24

**실사 시각**: 2026-04-24 (Round 4)  
**Supabase project**: `piboecawkeqahyqbcize`

---

## 1. Tables (65)

### 핵심 도메인
- `profiles` · `stores` · `store_memberships` · `store_settings` · `store_operating_days` · `store_service_types`
- `rooms` · `room_sessions` · `session_participants` · `participant_time_segments`
- `session_participant_actions` · `session_participant_action_applies`
- `managers` · `hostesses` · `customers` · `hostess_deduction_configs`

### 정산 / 지급
- `settlements` · `settlement_items` · `settlement_records` · `settlement_accounts` · `settlement_adjustments`
- `payout_records` · `pre_settlements`
- `cross_store_settlements` · `cross_store_settlement_items` · `cross_store_work_records`
- `manager_prepayments` · `manager_financial_permissions`
- `session_manager_shares` · `session_store_shares`

### 영수증 / 주문 / 재고
- `receipts` · `receipt_snapshots`
- `orders` · `inventory_items` · `inventory_transactions`
- `credits` · `payee_accounts`

### 운영 / 감사
- `audit_events` · `admin_access_logs` · `closing_reports`
- `transfer_requests` · `staff_attendance`

### 인증 / 보안
- `auth_rate_limits` · `auth_security_logs` · `reauth_verifications` · `trusted_devices`
- `user_global_roles` · `user_mfa_settings`
- `user_preferences` · `admin_preference_overrides`

### BLE / 위치
- `ble_gateways` · `ble_ingest_audit` · `ble_ingest_events` · `ble_tags` · `ble_tag_presence` · `ble_presence_corrections` · `ble_presence_history` · `ble_feedback`
- `location_correction_logs`

### 채팅
- `chat_rooms` · `chat_participants` · `chat_messages` · `chat_message_reads` · `chat_read_cursors`

### 시스템
- `_migrations` (Supabase 내부)

---

## 2. RPC 함수 (37)

### 인증 / 권한
- `auth_rl_clear(p_key, p_action)` → void
- `auth_rl_record_failure(p_key, p_action, p_threshold, p_lockout_seconds)` → table
- `auth_rl_tick_attempt(p_key, p_action, p_window_seconds, p_max_attempts)` → table
- `custom_access_token_hook(event jsonb)` → jsonb
- `get_user_membership_id()` → uuid
- `get_user_role()` → text
- `get_user_store_uuid()` → uuid
- `handle_new_user()` → trigger

### 정산 / 지급 (핵심)
- `record_cross_store_payout(p_from_store_uuid, p_cross_store_settlement_id, p_item_id, p_amount, p_memo, p_created_by, p_executor_membership_id)` → json
- `cancel_cross_store_payout(p_store_uuid, p_payout_id, p_reason, p_actor, p_executor_membership_id)` → json
- `record_settlement_payout(p_store_uuid, p_settlement_item_id, p_amount, p_payout_type, p_memo, p_created_by)` → json
- `cancel_settlement_payout(p_store_uuid, p_payout_id, p_reason, p_actor)` → json
- `create_cross_store_settlement(p_from_store_uuid, p_to_store_uuid, p_total_amount, p_memo, p_created_by, p_items)` → json

### 세션 / 체크아웃
- `close_session_atomic(p_session_id, p_store_uuid, p_closed_by)` → jsonb
- `foxpro_checkout_session(p_session_id, p_closed_by, p_ended_at, p_make_snapshot)` → jsonb
- `foxpro_receipt_snapshot(p_session_id, p_closed_by, p_finalize)` → jsonb
- `register_payment_atomic(p_session_id, p_store_uuid, p_receipt_id, p_payment_method, p_cash_amount, p_card_amount, p_credit_amount, p_manager_card_margin, p_card_fee_rate, p_customer_name, p_customer_phone, p_manager_membership_id)` → jsonb

### 재고
- `decrement_stock(p_item_id, p_store_uuid, p_qty)` → table
- `increment_stock(p_item_id, p_store_uuid, p_qty)` → table

### 트리거 함수
- `block_closed_business_day()` · `block_duplicate_correction()`
- `deny_loc_log_mutation()` · `fill_settlement_item_remaining()`
- `fn_block_orders_on_nonactive_session()` · `fn_block_participants_on_nonactive_session()`
- `fn_credit_status_transition()` · `fn_receipt_status_transition()` · `fn_session_status_transition()`
- `set_updated_at()`
- `validate_audit_actor()` · `validate_cross_store_participant()` · `validate_hostess_manager_roles()`
- `validate_orders_business_day()` · `validate_receipts_business_day()`

### 기타
- `exec_sql(sql text)` → void
- `write_location_correction(payload jsonb)` → jsonb

---

## 3. CHECK 제약 (61) — 카테고리별

자세한 SQL 은 `02_constraints.sql` 참조.

### 금액 양수 / 음수 금지
- `chk_csi_amount_pos` (items amount > 0)
- `chk_csi_paid_nonneg` · `chk_csi_remaining_nonneg`
- `chk_css_total_nonneg` (cross_store_settlements, Round 2 에서 `_pos` → `_nonneg` 완화)
- `chk_css_paid_nonneg` · `chk_css_remaining_nonneg`
- `chk_manager_prepayments_amount_positive`
- `chk_payout_records_amount_pos`
- `chk_sms_amount_nonneg` (session_manager_shares)
- `chk_settlement_items_amount_nonneg` · `chk_settlement_items_paid_nonneg` · `chk_settlement_items_remaining_nonneg` · `chk_settlement_items_sum`
- `session_participants_price_amount_check` · `session_participants_time_minutes_check`
- `receipts_gross_total_check` · `receipts_order_total_amount_check` · `receipts_participant_total_amount_check` · `receipts_tc_amount_check`
- `orders_customer_amount_check` · `orders_manager_amount_check` · `orders_qty_check` · `orders_sale_price_check` · `orders_store_price_check` · `orders_unit_price_check`
- `stores_floor_check` (5~8)

### Status enum
- `chk_csi_status` · `chk_css_status` (open/partial/completed)
- `chk_manager_prepayments_status` (active/canceled)
- `chk_payout_records_status` (pending/completed/cancelled)
- `chk_payout_records_payout_type` (full/partial/prepayment/cross_store_prepay/reversal)
- `chk_payout_records_recipient_type` (hostess/manager)
- `settlement_records_status_check` (pending/confirmed/paid)
- `room_sessions_status_check` (active/closed/void)
- `store_memberships_role_check` (owner/manager/hostess)
- `store_memberships_status_check` (pending/approved/rejected/suspended)
- `store_operating_days_status_check` (open/closed)
- `receipts_status_check` (draft/finalized)
- `credits_status_check` (pending/collected/cancelled)
- `transfer_requests_status_check` · `transfer_requests_check` (from != to)
- `session_participants_role_check` · `session_participants_status_check`
- `session_participant_actions_action_type_check`
- `session_participant_action_applies_apply_status_check`
- `chat_rooms_type_check` · `ble_gateways_gateway_type_check` · `ble_ingest_events_event_type_check` · `ble_feedback_feedback_type_check` · `ble_presence_history_source_check`
- `auth_rate_limits_action_check`
- `location_correction_logs_error_type_check`

### Cross-store 관계
- `chk_css_not_self` (from != to)
- ~~`chk_manager_prepayments_cross_store`~~ (Round 2 081 에서 DROP — intra 허용)

### 정산 비율
- `store_settings_tc_rate_check` · `store_settings_hostess_payout_rate_check` · `store_settings_manager_payout_rate_check` (0~1)
- `store_settings_payout_basis_check` (gross/netOfTC)
- `store_settings_rounding_unit_check` (>0)

### 기타
- `mfp_revoke_triplet_consistent` (revoked 필드 3종 세트)
- `user_global_roles_role_check` (super_admin) · `user_global_roles_status_check`
- `admin_access_logs_kind_check` · `chk_payout_records_amount_pos` 등

---

## 4. 인덱스 (138, PK 제외)

세부 정의는 `03_indexes.sql` 참조.

### Partial UNIQUE (비즈니스 invariant 강제)
- `uq_cssi_cross_store_work_record` — work_record 1건당 item 1건 (075)
- `uq_mfp_active` — active permission 1건 per (store, membership) (079)
- `ux_store_memberships_one_primary_per_profile` · `store_memberships_one_primary_per_profile_idx` (053)
- `uq_staff_attendance_open` · `idx_staff_attendance_unique` (062)
- `uq_credits_receipt_pending` — pending credit 1건 per receipt
- `uq_mfp_revoke_triplet_consistent` 등
- `room_sessions_active_unique` — active session 1건 per room
- `idx_chat_rooms_global_unique` · `idx_chat_rooms_session_unique`
- `idx_cswr_unique` — (session_id, hostess_membership_id) 1건
- `idx_store_service_types_unique` — (store, service, time_type) 1건
- `uq_settlements_session_live` · `uq_receipts_session_id`
- `uq_trusted_devices_user_hash`
- `uq_user_pref_global` · `uq_user_pref_store` · `uq_admin_override_global` · `uq_admin_override_store`
- `uq_auth_rate_limits_key_action`
- `uq_user_global_roles_user_role`
- `uq_receipt_snapshots_session_id`

### Hot path 인덱스
- 모든 테이블의 `(store_uuid, ...)` 조합 인덱스
- 감사 로그 시간 역순: `(store_uuid, created_at DESC)`
- 정산 / payout FK 역조회

---

## 5. 트리거 (17)

자세한 목록은 `05_triggers.txt`.

주요:
- `set_updated_at` — 전 테이블의 updated_at 자동 갱신
- `validate_audit_actor` — audit_events 작성자 검증
- `validate_cross_store_participant` — session_participants origin_store 일관성
- `validate_hostess_manager_roles` — role 일치 검증
- `validate_orders_business_day` · `validate_receipts_business_day` — business_day 교차검증
- `block_closed_business_day` — 마감된 영업일 변경 차단
- `fn_session_status_transition` · `fn_credit_status_transition` · `fn_receipt_status_transition` — 상태 전이 검증
- `fn_block_orders_on_nonactive_session` · `fn_block_participants_on_nonactive_session` — 비활성 세션 보호
- `fill_settlement_item_remaining` — remaining_amount 자동 계산
- `block_duplicate_correction` · `deny_loc_log_mutation` — BLE 위치 보정 보호

---

## 6. RLS 정책 (70) — 24 테이블

`06_rls_policies.txt` 참조.

활성 테이블:
- `audit_events, profiles, stores, store_memberships, store_operating_days, store_settings`
- `rooms, room_sessions, session_participants, participant_time_segments`
- `hostesses, managers`
- `orders, receipts, receipt_snapshots, closing_reports`
- `transfer_requests`
- `cross_store_work_records`
- `ble_gateways, ble_tags, ble_tag_presence, ble_ingest_events, ble_presence_history`
- `location_correction_logs`

**주의**: 앱 route 는 **service-role key** 사용 → RLS 우회. 일반 user JWT 로는 정책 제약 적용.

---

## 7. Migration 이력

자세한 내용은 `../README.md` 참조.

- Supabase `list_migrations`: **39개** 기록
- 로컬 `database/*.sql` 파일: **76개** (alias / deprecated / non-migration 포함)

---

## 8. 이 문서의 한계

이 markdown 은 **읽기용 참조**입니다. 신규 환경 재생성용 실행 가능한 SQL 은 **`supabase db pull`** 결과를 사용하세요. 상세는 `README.md`.
