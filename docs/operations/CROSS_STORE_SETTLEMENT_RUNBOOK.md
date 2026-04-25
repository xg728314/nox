# Cross-Store Settlement Runbook

> 타매장 근무 → 정산 item 생성 → 선지급/지급 운영 절차.
> 대상: 사장(owner), super_admin, 시스템 운영자.

---

## 0. 테이블 지형

- `cross_store_work_records` — 근무 기록 SSOT. status: `pending` / `confirmed` / `disputed` / `resolved` / `voided`.
- `cross_store_settlements` — store-to-store 정산 헤더. `from_store_uuid`(payer) / `to_store_uuid`(receiver).
- `cross_store_settlement_items` — 근무기록 1건 → item 1건. 신규 컬럼 `cross_store_work_record_id` (migration 075).
- `payout_records` — 실제 돈 이동 로그. RPC `record_cross_store_payout` 이 작성.
- `manager_prepayments` — 실장 선지급 원장.

### 방향성 고정

| 역할 | header | item | work_record |
|---|---|---|---|
| **지불자 (payer)** | `from_store_uuid` | `store_uuid` | `working_store_uuid` |
| **수취자 (receiver)** | `to_store_uuid` | `target_store_uuid` | `origin_store_uuid` |
| 근무자 | — | `hostess_membership_id` | `hostess_membership_id` |
| 담당 실장 | — | `manager_membership_id` = `target_manager_membership_id` | *(저장 안 함)* |

---

## 1. Migration 적용 순서

운영 DB 에 **이 순서대로** 적용:

1. `database/075_cross_store_work_record_settlement_items.sql`
   - `cross_store_settlement_items.cross_store_work_record_id` 컬럼 + FK `cssi_cswr_fk` + partial UNIQUE `uq_cssi_cross_store_work_record`.
2. `database/076_cross_store_items_check_constraints.sql`
   - 4종 CHECK 제약 (amount/paid/remaining >= 0, status 화이트리스트). 모두 **NOT VALID** — 기존 row 재검증 없음.

```bash
psql "$DATABASE_URL" -f database/075_cross_store_work_record_settlement_items.sql
psql "$DATABASE_URL" -f database/076_cross_store_items_check_constraints.sql
```

### 적용 확인 SQL

```bash
psql "$DATABASE_URL" -f database/checks/verify_cross_store_settlement_runtime.sql
```

11개 점검 블록. 각 expected 값은 파일 내부 주석 참조. 이상 발견 시 아래 "흔한 에러" 참고.

---

## 2. 운영 순서 (표준 플로우)

1. **근무 기록**: `/api/staff-work-logs` POST 로 `cross_store_work_records` 생성 (status=`pending`). owner/manager/super_admin.
2. **확정**: `/api/staff-work-logs/:id/confirm` — pending → confirmed. owner/super_admin.
3. **Aggregate 실행**: `POST /api/settlements/staff-work-logs/aggregate` `{ from, to }` — confirmed + cross-store 근무기록을 item 으로 편입. owner/super_admin.
   - 응답 필드 확인: `processed`, `created_items`, `unassigned_count`, `skipped_counts`, `skipped_reasons`, `settlement_ids`.
4. **Settlement-tree 확인**: `GET /api/reports/settlement-tree?counterpart_store_uuid=...` — manager 별 잔액 + **미배정 (`__unassigned__`) bucket** 확인. UI 는 `/payouts/settlement-tree`.
5. **미배정 manager 보정**: `PATCH /api/payouts/cross-store-items/:item_id/assign-manager` `{ manager_membership_id }` — item 별 실장 배정. owner/super_admin.
   - 조건: `paid_amount === 0`, status ∉ {completed, cancelled, closed}, 지정 실장이 `target_store_uuid` 소속 approved manager.
6. **선지급**: `POST /api/payouts/manager-prepayment` — item.remaining_amount 기반 상한. owner/manager.
   - 응답 `cap_basis: "item_remaining"` = aggregate 완료 상태. `"session_participants_legacy"` = aggregate 전.
7. **실제 지급**: `POST /api/cross-store/payout` — RPC `record_cross_store_payout` 호출, FOR UPDATE lock + OVERPAY 가드.
8. **지급 취소**(필요 시): `POST /api/cross-store/payout/cancel` — 반전 payout_records 작성, item/header remaining 복구.

---

## 3. 흔한 에러 & 해결

### MIGRATION_REQUIRED (409)
- **원인**: migration 075 미적용.
- **해결**: `psql -f database/075_*.sql` 실행 후 재시도. `verify_cross_store_settlement_runtime.sql` 로 확인.

### participant_not_found (aggregate skip)
- **원인**: `cross_store_work_records` row 가 가리키는 `session_id + hostess_membership_id + working + origin` 조합의 `session_participants` row 가 없음. 또는 `role != 'hostess'`.
- **해결**: 해당 `session_participants` row 의 `origin_store_uuid` 누락 여부 확인. 필요 시 운영자가 DB 레벨에서 보정 후 aggregate 재실행.
- **금지**: 금액을 다른 경로에서 임의 주입하지 말 것.

### amount_zero (aggregate skip)
- **원인**: 매칭된 `session_participants.price_amount` 합이 0 이하.
- **해결**: 해당 session participant 정산 흐름 (체크아웃, price_amount 설정) 점검. 정상 금액 확인 후 aggregate 재실행.

### MANAGER_UNASSIGNED (payout 409)
- **원인**: `cross_store_settlement_items.manager_membership_id` 가 null.
- **해결**: `PATCH /api/payouts/cross-store-items/:item_id/assign-manager` 로 실장 배정 후 재시도.

### MANAGER_NO_ITEMS (prepayment 409)
- **원인**: Aggregate 는 실행됐으나 해당 manager 에 할당된 item 이 없음 (모두 null manager 에 쏠림 등).
- **해결**: 미배정 item 들에 실장 배정 후 재시도.

### MANAGER_OVERPAY / STORE_OVERPAY (409)
- **원인**: 요청 금액이 available remaining 을 초과. 응답에서 `manager_remaining` / `store_remaining` 확인.
- **해결**: 금액을 잔액 이하로 낮춰 재시도.

### OVERPAY / HEADER_REMAINING_NEGATIVE (payout RPC 409)
- **원인**: item 또는 header 의 잔액 초과.
- **해결**: 금액 재계산. 여러 담당자가 동시에 지급 진행 중인지 확인 (FOR UPDATE 로 순차 처리됨).

### items with legacy staff_work_log_id (verify §8)
- **원인**: 이전 라운드의 staff_work_logs 기반 aggregate 로 생성된 item.
- **상태**: 레거시. 읽기 전용. `settlements/[id]/page.tsx` 가 "(legacy)" 표시.
- **금지**: 강제 삭제 또는 staff_work_logs 테이블 재생성.

### status 화이트리스트 외 값 (verify §6)
- **원인**: 레거시 데이터의 status 에 'settled' 등 저장된 row.
- **상태**: NOT VALID CHECK 덕분에 기존 row 는 통과. 향후 정리 후 `VALIDATE CONSTRAINT` 별도 라운드.

---

## 4. 절대 하지 말 것

- ❌ DB 에서 금액 컬럼 (amount / paid_amount / remaining_amount) **직접 UPDATE** 하지 말 것. RPC 경유 필수.
- ❌ null manager item 을 **임의의 manager 로 추정** 배정하지 말 것. 반드시 operator 가 `assign-manager` API 로 명시 선택.
- ❌ `staff_work_logs` 테이블 **재생성** 금지. 레거시 참조는 읽기만.
- ❌ 정산 금액을 **하드코딩 단가표** 또는 **퍼센트 계산** 으로 재산출하지 말 것. `session_participants.price_amount` 만 사용.
- ❌ `cross_store_work_records` 에 `manager_membership_id` / `category` / `work_type` 컬럼 **추가** 금지.
- ❌ BLE cron 의 `staff_work_logs` 재write 로직 **복구** 금지 (별도 설계 라운드 필요).
- ❌ 운영 중 migration 076 `VALIDATE CONSTRAINT` 를 레거시 row 정리 없이 실행하지 말 것.

---

## 5. 관련 파일 레퍼런스

| 목적 | 경로 |
|---|---|
| 근무 기록 API | `app/api/staff-work-logs/**` |
| Aggregate API | `app/api/settlements/staff-work-logs/aggregate/route.ts` |
| 실장 배정 API | `app/api/payouts/cross-store-items/[item_id]/assign-manager/route.ts` |
| 선지급 API | `app/api/payouts/manager-prepayment/route.ts` |
| 지급 API | `app/api/cross-store/payout/route.ts` |
| 지급 취소 API | `app/api/cross-store/payout/cancel/route.ts` |
| Settlement Tree API | `app/api/reports/settlement-tree/route.ts` |
| UI | `app/payouts/settlement-tree/page.tsx` + `ManagerPrepaymentModal.tsx` |
| Pure helpers | `lib/server/queries/staffWorkLogsAggregate.ts` |
| DB migrations | `database/075_*.sql`, `database/076_*.sql` |
| 적용 확인 SQL | `database/checks/verify_cross_store_settlement_runtime.sql` |
