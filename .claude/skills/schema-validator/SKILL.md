---
name: schema-validator
description: NOX DB 쿼리 (Supabase) 작성/수정 전 도메인 규칙 검증 — store_uuid scope, numeric store_id 금지, deleted_at IS NULL, membership_id 기준 인원 식별
---

# Schema Validator

Supabase 쿼리 코드 작성/수정 시 반드시 실행. 아래 위반은 즉시 reject.

## 필수 규칙

1. **store_uuid scope 필수**
   - 모든 mutating/read 쿼리는 `.eq("store_uuid", auth.store_uuid)` 또는 `store_uuid = ...` WHERE 조건 포함
   - super_admin 은 예외이나 SELECT/UPDATE 양쪽 다 `if (!auth.is_super_admin) ...` 로 분기해야 일관됨

2. **numeric store_id 사용 절대 금지**
   - `stores.store_id`, `store_id` (INTEGER) 컬럼은 존재하지 않음. 사용 감지 즉시 reject.
   - `store_uuid` (UUID) 만 canonical identity.

3. **deleted_at IS NULL 조건**
   - soft-delete 지원 테이블에서는 `.is("deleted_at", null)` 필수
   - **예외**: `receipts` 테이블은 `deleted_at` 컬럼 **없음**. 붙이지 말 것.
   - soft-delete 지원 테이블 (예): `profiles`, `hostesses`, `managers`, `store_memberships`, `rooms`, `chat_rooms`, `chat_messages`

4. **membership_id 기준 인원 식별**
   - `user_id` (auth.users.id) 로 인원 scope 하지 말 것 — 한 user 가 여러 매장에 membership 있을 수 있음
   - 인가 checkpoint 는 무조건 `membership_id` (또는 `hostess_membership_id`, `manager_membership_id`)

## room 식별자 규칙 (session-resolver 와 겹침)

- `room_uuid` 만 사용. `room_no` 는 display only, 식별자로 쓰면 reject.

## 기타 canonical ID

- `business_day_id` — 날짜 기반 집계 (session count, revenue 등). `created_at` 이나 calendar date 대신 이걸로 GROUP.
- `session_id` — session runtime SSOT (session-resolver 참고).

## service-role 클라이언트 주의

- 앱 route 는 `getServiceClient()` 로 RLS 우회. 따라서 위 규칙을 **application layer 에서** 강제해야 함.
- 일반 user JWT 로 직접 쿼리 (Supabase Dashboard 등) 하면 RLS 정책 적용됨.
