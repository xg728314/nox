# ROUND 107 결과: PARTICIPANT-NAME-CORRECTION-PERMISSION-TIGHTEN-001

## 1. 수정한 권한 조건

### 파일: `app/api/sessions/participants/[participant_id]/route.ts`

#### 이전
```typescript
const isSessionStore = session.store_uuid === authContext.store_uuid
const isOriginStore = p.origin_store_uuid === authContext.store_uuid
if (!isSessionStore && !isOriginStore) → 403
```
→ origin store 전체 owner/manager 허용

#### 이후
```typescript
const isSessionStore = session.store_uuid === authContext.store_uuid
const isOriginManagerSelf = !!(
  p.origin_store_uuid &&
  p.origin_store_uuid === authContext.store_uuid &&
  p.manager_membership_id &&
  p.manager_membership_id === authContext.membership_id
)
if (!isSessionStore && !isOriginManagerSelf) → 403
```
→ origin store에서는 해당 participant의 `manager_membership_id` 본인만 허용

## 2. 허용/차단 매트릭스

| 요청자 | 조건 | 결과 |
|--------|------|------|
| working store owner | `isSessionStore = true` | **허용** |
| working store manager | `isSessionStore = true` | **허용** |
| working store hostess | line 12 role guard | **403** |
| origin store 담당 manager 본인 | `isOriginManagerSelf = true` | **허용** |
| origin store 다른 manager | `isSessionStore = false`, `isOriginManagerSelf = false` | **403** |
| origin store owner | `isSessionStore = false`, `isOriginManagerSelf = false` (owner의 membership_id ≠ manager_membership_id) | **403** |
| 무관한 매장 manager | 양쪽 모두 false | **403** |
| hostess (모든 매장) | line 12 role guard | **403** |

## 3. 근거 필드

| 필드 | 테이블 | 용도 |
|------|--------|------|
| `session.store_uuid` | `room_sessions` | working store 판정 |
| `authContext.store_uuid` | resolveAuthContext | 요청자 소속 매장 |
| `authContext.membership_id` | resolveAuthContext | 요청자 membership |
| `p.origin_store_uuid` | `session_participants` | participant 소속 매장 |
| `p.manager_membership_id` | `session_participants` | participant 담당 실장 |

## 4. 미확인 제약사항

- `manager_membership_id`가 null인 participant는 origin store 측에서 아무도 수정 불가 (working store 측에서만 수정 가능)
- origin store owner가 이름 수정 불가 — task 명세에 "origin store 전체 owner/manager에게 열면 안 됨"으로 명시되어 있으므로 의도된 동작

## 5. 검증

- `tsc --noEmit`: 0 errors
- settlement/checkout 변경 없음
- DB schema 추가 없음
- UI 변경 없음
