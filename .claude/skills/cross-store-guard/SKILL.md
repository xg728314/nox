---
name: cross-store-guard
description: NOX 타매장 정산/이적 코드 작성 시 origin_store_uuid 기준 · transfer_requests · super_admin bypass 양쪽 분기 규칙
---

# Cross-Store Guard

아가씨는 원소속 매장(`origin_store_uuid`)에 영원히 귀속. 워킹매장은 장소만 제공.

## 핵심 규칙

1. **정산은 무조건 `origin_store_uuid` 기준**
   - `session_participants.store_uuid` = 워킹 매장 (일한 곳)
   - `hostess.origin_store_uuid` = 원소속 매장 (돈 받는 곳)
   - 두 값이 다르면 cross-store 케이스 → 원소속 기준 집계

2. **워킹매장 수수료 없음**
   - 장소 대여 개념. 정산 dispatch 는 origin 매장에서 처리
   - `cross_store_work_records` 테이블에 workRecord 로 로그

3. **이적 (transfer) 승인 흐름**
   - 요청자 (아가씨 본인) → 출발매장 승인 → 도착매장 승인 → `origin_store_uuid` 갱신
   - `transfer_requests` 테이블 status: `pending` → `approved` / `rejected`

## super_admin bypass 함정

**과거 사고**: SELECT 는 `is_super_admin` 우회했는데 UPDATE 는 안 함 → `VERSION_CONFLICT` 발생.

```typescript
// ❌ 잘못
const { data } = await sb.from("t").select().eq("store_uuid", auth.store_uuid) // super_admin 도 자기 store 만
if (auth.is_super_admin) {
  // ...
}
await sb.from("t").update({...}).eq("store_uuid", auth.store_uuid) // super_admin 도 자기 store 만 → 다른 매장 데이터 못 건드림

// ✅ 올바름
const selectStoreUuid = auth.is_super_admin ? targetStoreUuid : auth.store_uuid
const updateStoreUuid = auth.is_super_admin ? targetStoreUuid : auth.store_uuid
await sb.from("t").select().eq("store_uuid", selectStoreUuid)
await sb.from("t").update({...}).eq("store_uuid", updateStoreUuid)
```

**규칙**: super_admin bypass 는 SELECT/UPDATE **양쪽** 대칭으로 분기.

## participants seed (cross-store 트리거)

- `session_participants` insert 시 DB 트리거가 `transfer_request_id` 요구
- 없으면 트리거 실패 → seed script 부러짐
- Fix: `transfer_requests` row 먼저 auto-create 후 그 id 로 insert

## 미적용 migration 주의

- `060_cross_store_items_work_log_link.sql` 미적용
- `staff_work_log_id`, `hostess_membership_id`, `category`, `work_type` 컬럼 부재
- `/api/staff-work-logs` route 는 `cross_store_work_records` 테이블 기준으로 재작성됨 (2026-04-24)

## 체크리스트

- [ ] 집계 시 `origin_store_uuid` (아가씨 원소속) 기준
- [ ] `session_participants.store_uuid` 는 워킹매장 (혼동 금지)
- [ ] super_admin bypass 시 SELECT/UPDATE 양쪽 대칭 분기
- [ ] transfer 승인 흐름 (출발 → 도착 순서) 준수
- [ ] participants insert 시 transfer_request_id 확보
