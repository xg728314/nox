# ROUND 101 결과: session_participants.manager_membership_id 설계

## 1. 왜 session_participants.manager_membership_id가 필요한가

현재 담당실장 정보는 `hostesses.manager_membership_id`에만 존재한다.
이 컬럼은 **아가씨의 기본 담당실장**(소속 관계)을 나타낸다.

하지만 실제 운영에서는:

- 같은 아가씨가 세션마다 다른 실장의 관리 하에 들어갈 수 있다
- 타점 아가씨는 `hostesses` 테이블에 등록되지 않을 수 있다 (membership_id가 placeholder이거나 타매장 소속)
- 바텀시트에서 store → category → **manager**를 선택해도, 그 선택을 DB에 저장할 컬럼이 없다

따라서 **세션 참여 단위**로 담당실장을 기록할 수 있는 컬럼이 필요하다.

## 2. 기존 hostesses.manager_membership_id와 무엇이 다른가

| 구분 | hostesses.manager_membership_id | session_participants.manager_membership_id (신규) |
|------|-------------------------------|------------------------------------------------|
| 의미 | 아가씨의 **기본** 담당실장 (소속 관계) | 이 세션에서 이 참여자를 **실제 담당하는** 실장 |
| 범위 | 아가씨 1명당 1명 (고정) | 세션 참여 1건당 1명 (세션별 변경 가능) |
| 타점 아가씨 | 타매장 hostesses 테이블에 있어야 조회 가능 | session_participants에 직접 기록 → 타점도 지원 |
| 변경 빈도 | 드물게 변경 (인사 이동) | 매 세션마다 다를 수 있음 |
| 정산 근거 | 간접 (hostesses join 필요) | 직접 (session_participants에서 바로 조회) |

**관계**: 신규 컬럼이 NULL이면 `hostesses.manager_membership_id`를 기본값으로 fallback.
신규 컬럼이 있으면 세션 단위 오버라이드.

## 3. Migration SQL 초안

```sql
-- migration: 010_session_participant_manager.sql
-- session_participants에 세션 단위 담당실장 컬럼 추가

ALTER TABLE session_participants
  ADD COLUMN manager_membership_id UUID REFERENCES store_memberships(id);

-- 인덱스: 실장별 세션 참여자 조회용
CREATE INDEX idx_session_participants_manager
  ON session_participants(manager_membership_id)
  WHERE manager_membership_id IS NOT NULL;

COMMENT ON COLUMN session_participants.manager_membership_id IS
  '이 세션에서 이 참여자를 담당하는 실장의 membership_id. NULL이면 hostesses.manager_membership_id fallback.';
```

**NULL 허용: YES**
- 기존 데이터는 모두 NULL (backfill 불필요)
- NULL = "기본 담당실장 사용" 의미
- NOT NULL로 하면 기존 데이터 전체 backfill 필요 + placeholder 문제 발생

## 4. API 영향 범위

### 4.1 participants PATCH (`app/api/sessions/participants/[participant_id]/route.ts`)

**변경 필요**:
- body 타입에 `manager_membership_id?: string` 추가
- `unspec_filled` 분기에서 `manager_membership_id` → updatePayload에 포함
- validation: `store_memberships`에 존재하는 UUID인지 확인
- validation: role이 `manager`인 membership인지 확인

```typescript
// body에서 수신
if (body.manager_membership_id) {
  updatePayload.manager_membership_id = body.manager_membership_id
}
```

### 4.2 rooms/[room_uuid]/participants GET (`app/api/rooms/[room_uuid]/participants/route.ts`)

**변경 필요**:
- select에 `manager_membership_id` 추가
- 응답 조립에서 우선순위 적용:
  1. `session_participants.manager_membership_id` (세션 단위)
  2. `hostesses.manager_membership_id` (기본 담당, fallback)
- manager 이름 조회 대상에 session 단위 manager_membership_id 추가

```
현재: hostesses.manager_membership_id → managers.name
변경: session_participants.manager_membership_id ?? hostesses.manager_membership_id → managers.name
```

### 4.3 settlement summary (`app/api/sessions/settlement/route.ts`)

**영향 분석**:
- 현재 settlement는 `manager_payout_amount` (금액)만 사용
- 실장 **누구에게** 귀속되는지는 settlement route에서 직접 다루지 않음
- **즉시 변경 불필요**, 하지만 향후 실장별 정산 집계 시 활용 가능

### 4.4 manager settlement summary (`app/api/manager/settlement/summary/route.ts`)

**영향 분석**:
- 현재: `hostesses.manager_membership_id = authContext.membership_id`로 "내 아가씨" 필터
- 변경 후: `session_participants.manager_membership_id`도 함께 조회해야 정확한 세션별 담당 집계 가능
- **향후 변경 권장** (이번 round 범위 아님):

```sql
-- 현재 (기본 담당만)
WHERE hostesses.manager_membership_id = :manager_id

-- 변경 후 (세션 단위 오버라이드 우선)
WHERE COALESCE(sp.manager_membership_id, h.manager_membership_id) = :manager_id
```

### 4.5 counter/page.tsx

**변경 필요**:
- `handleSheetCommit`에서 `patchBody.manager_membership_id = addManager.membership_id` 추가
- Participant 타입의 `manager_membership_id`는 이미 추가되어 있음

## 5. Backfill 필요 여부

**불필요.**

- 새 컬럼은 `NULL` 허용
- 기존 데이터는 모두 NULL → `hostesses.manager_membership_id` fallback 작동
- 기존 정산/리포트에 영향 없음

## 6. 위험요소

### 6.1 기존 데이터 NULL 처리

- **위험도: 낮음**
- NULL = "기본 담당 사용" 의미로 명확
- participants API에서 fallback 로직 이미 구현됨 (hostesses 테이블 조회)

### 6.2 Cross-store manager scope

- **위험도: 중간**
- 타점 아가씨의 경우, 선택한 실장은 **워킹매장의 실장**
- 하지만 `manager_membership_id`에 저장되는 UUID는 워킹매장의 `store_memberships.id`
- 정산은 `origin_store_uuid` 기준이므로, 담당실장과 정산 귀속 매장이 다를 수 있음
- **대응**: PATCH validation에서 `manager_membership_id`가 해당 세션의 `store_uuid` 소속인지 확인

### 6.3 정산 집계 영향

- **위험도: 낮음 (즉시)**
- 현재 settlement route는 `manager_payout_amount` (금액)만 집계
- 실장 **식별**은 하지 않음 → 새 컬럼 추가해도 기존 정산 로직 변경 없음
- 향후 "실장별 정산 요약"에서 이 컬럼 사용 시, NULL fallback 로직 필수

### 6.4 manager_membership_id vs manager_payout_amount 혼동

- **위험도: 낮음**
- `manager_membership_id`: 담당 실장이 **누구인지** (식별자)
- `manager_payout_amount`: 실장에게 **얼마 지급하는지** (금액)
- 이름이 유사하므로 코드 리뷰 시 주의 필요
