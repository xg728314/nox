# ROUND: PARTICIPANT-ORIGIN-STORE-MATCH-FIX-001 결과

## 1. origin store 저장 방식

### 이전 (버그)
- `handleSheetCommit`에서 `origin_store_uuid`를 PATCH body에 포함하지 않음
- `membership_id`도 body에 없어서 PATCH API가 `unspec_filled` 분기 대신 `category_updated` 분기를 탐 → membership_id가 placeholder UUID로 유지됨
- PATCH API `unspec_filled` 분기에서 `origin_store_uuid`를 `updatePayload`에 포함하지 않음

### 이후 (수정)
- `app/counter/page.tsx`: `addStoreUuid` 상태 추가. `loadAddManagerList` 응답에서 `store_uuid` 캡처
- `handleSheetCommit`: `membership_id: null` + `origin_store_uuid: addStoreUuid` (타매장일 때만) 전송
- `app/api/sessions/participants/[participant_id]/route.ts`:
  - body 타입에 `origin_store_uuid?: string` 추가
  - `unspec_filled` 분기 `updatePayload`에 `origin_store_uuid` 포함
  - `membership_id: null`이 전송되므로 `body.membership_id !== undefined` → `unspec_filled` 분기 진입

## 2. GET 응답에 추가/수정된 필드

### `app/api/rooms/[room_uuid]/participants/route.ts`
- `origin_store_name: string | null` — 신규. `stores.store_name` 조회하여 포함
- `match_status` — 기존이나 판정 기준 변경 (아래 참조)
- `name_edited` — 기존 유지

### `app/counter/page.tsx` Participant 타입
- `origin_store_name?: string | null` 추가

## 3. 카드 표시 방식

- `originStoreName` 결정: `h.origin_store_name` (API 응답) → `stores.find(...)` fallback → `"타매장"` fallback
- `isCrossStore`: `origin_store_uuid !== currentStoreUuid` 시 amber badge `T` 표시
- `origin_store_name`: amber 텍스트로 매장명 표시 (category · manager · 매장명)
- `match_status === "unmatched"`: 빨간 badge `매칭실패`
- `name_edited`: 회색 badge `수정됨`

## 4. match_status 판정 기준

### 이전 (버그)
모든 participant에 대해 `authContext.store_uuid` (working store) 기준으로 매칭 → 타매장 participant가 항상 unmatched

### 이후 (수정)
```
matchStoreUuid = p.origin_store_uuid ?? authContext.store_uuid
hostessNameSet = hostessNameSetByStore.get(matchStoreUuid)
```
- participant별로 `origin_store_uuid`가 있으면 해당 매장 기준
- 없으면 working store 기준
- 매장별 hostess 이름 Set 일괄 구축 (store_memberships → hostesses join)

### PATCH `update_external_name` 시
동일하게 `targetStoreUuid = p.origin_store_uuid ?? session.store_uuid` 기준 (기존 코드, 변경 없음)

## 5. checkout 400 실제 원인

### 근거: `app/api/sessions/checkout/route.ts` line 95~101
```typescript
const unresolvedParticipants = (activeParticipants ?? []).filter(
  (p) =>
    p.membership_id === PLACEHOLDER_UUID ||  // ← 이것
    !p.category ||
    p.category.trim() === "" ||
    p.time_minutes === 0
)
```

### 원인
round 104에서 `handleSheetCommit`이 `membership_id`를 body에 포함하지 않게 변경됨 → PATCH API가 `body.membership_id !== undefined` 분기(`unspec_filled`)를 안 탐 → `body.category !== undefined` 분기(`category_updated`)를 탐 → category/price만 업데이트되고 `membership_id`는 placeholder UUID(`00000000-...`)로 유지 → checkout 시 unresolved로 판정 → 400 반환

### 수정
`handleSheetCommit`에 `membership_id: null` 추가 → `unspec_filled` 분기 진입 → `membership_id: null`로 UPDATE → placeholder UUID 제거

## 6. PATCH API 실장 검증 변경

### 이전
```
mgrMembership.store_uuid !== authContext.store_uuid → 400
```
authContext 매장 실장만 허용 → 타매장 실장 선택 불가

### 이후
```
const allowedStore = body.origin_store_uuid ?? authContext.store_uuid
mgrMembership.store_uuid !== allowedStore && mgrMembership.store_uuid !== authContext.store_uuid → 400
```
선택한 소속 가게 실장 또는 현재 매장 실장 허용

## 7. 변경 파일

| 파일 | 변경 |
|------|------|
| `app/counter/page.tsx` | `addStoreUuid` 상태 추가, `handleSheetCommit`에 `membership_id: null` + `origin_store_uuid` 추가, Participant 타입에 `origin_store_name` 추가 |
| `app/api/sessions/participants/[participant_id]/route.ts` | body 타입에 `origin_store_uuid` 추가, `unspec_filled`에 origin_store_uuid 저장, 실장 검증 origin_store 허용 |
| `app/api/rooms/[room_uuid]/participants/route.ts` | origin_store 기준 매칭 판정, origin_store_name 응답 포함, 매장별 hostess name set 구축 |

## 8. 검증
- `tsc --noEmit`: 0 errors
- settlement/checkout 로직 변경 없음
- DB schema 추가 없음
