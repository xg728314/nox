# ROUND 105 결과: CROSS-STORE-NAME-CORRECTION-001

## 1. 변경 파일 목록

| 파일 | 변경 |
|------|------|
| `app/api/rooms/[room_uuid]/participants/route.ts` | `match_status`, `name_edited` 필드 추가 |
| `app/api/sessions/participants/[participant_id]/route.ts` | origin store 실장 수정 권한 + audit에 match_status 포함 |
| `app/api/manager/participants/route.ts` | **신규** — 실장 담당 participant 조회 (match_status 포함) |
| `app/counter/page.tsx` | Participant 타입 확장 + 매칭 실패/수정됨 badge 표시 |
| `app/manager/page.tsx` | 진행 중 참여자 섹션 추가 (매칭 실패 수정 UI) |

## 2. 상태 표시 방식

### 판정 기준
- participant의 `external_name` 또는 `name`(hostesses 테이블)이 해당 매장 hostesses 이름 Set에 존재 → `matched`
- 그 외 (이름 없음, 불일치) → `unmatched`
- 이름 Set: `hostesses.name` + `hostesses.stage_name` 모두 포함

### 카운터 UI 표시
- `unmatched`: 빨간 badge `매칭실패`
- `name_edited`: 회색 badge `수정됨`
- `matched`: 별도 표시 없음

### 실장 화면 표시
- `unmatched` 참여자: 빨간 border 카드 + `매칭실패` badge + 이름 편집 input
- `matched` 참여자: 일반 카드 + 이름 텍스트
- `name_edited`: `수정됨` badge

## 3. 매칭 판정 로직

```
participants GET 응답 시:
1. store_memberships에서 해당 매장 hostess role 멤버십 조회
2. hostesses 테이블에서 name, stage_name 수집 → Set
3. participant.external_name 또는 name이 Set에 있으면 matched
4. 없으면 unmatched (이름 없는 경우 포함)
```

이름 수정(PATCH) 시에도 동일 로직으로 match_status 재계산.

## 4. 실장 화면 변경 내용

### 신규 API: `GET /api/manager/participants`
- 본인 `membership_id`가 `manager_membership_id`인 active hostess participants 조회
- origin_store 아가씨 이름 Set 기반 match_status 계산
- audit_events에서 name_edited 판정
- session → room_sessions → rooms join으로 room_name, store_name 포함

### 실장 대시보드 (`app/manager/page.tsx`)
- "진행 중 참여자" 섹션 추가
- unmatched: 빨간 카드 + 이름 편집 input (onBlur → PATCH)
- matched: 일반 카드 + 이름 텍스트 표시

## 5. 수정 UI 방식

### 카운터 (기존)
- 확정 카드: inline `<input>` + `onBlur` → `handleExternalNameBlur` → PATCH

### 실장 화면 (신규)
- unmatched 카드: `<input>` + `onBlur` → `handleParticipantNameEdit` → PATCH
- 수정 후 목록 자동 갱신 (`fetchManagedParticipants`)

## 6. audit 확장 내용

`update_external_name` 액션의 audit_events에 match_status 추가:

```json
{
  "before": { "external_name": "미지", "match_status": "unmatched" },
  "after": { "external_name": "김미자", "match_status": "matched" }
}
```

## 7. 권한 검증 방식

### PATCH `update_external_name`
허용 조건 (OR):
1. `session.store_uuid === authContext.store_uuid` (세션 매장 소속)
2. `participant.origin_store_uuid === authContext.store_uuid` (origin store 실장)

둘 다 아니면 403 FORBIDDEN.

### GET `/api/manager/participants`
- `authContext.role`이 `manager` 또는 `owner`만 허용
- `manager_membership_id === authContext.membership_id`인 participant만 반환
- 다른 participant, 다른 방, 다른 매장 내부는 조회 불가

### 수정 허용 범위
- 이름(`external_name`)만 수정 가능
- category, manager, store, time, settlement 관련 값 변경 → 기존 PATCH 로직에서 별도 action으로 처리 (update_external_name 분기에서는 이름만 UPDATE)

## 8. 검증

- `tsc --noEmit`: 0 errors
- DB schema 추가 없음 (기존 external_name, audit_events 활용)
- settlement/checkout 로직 변경 없음
