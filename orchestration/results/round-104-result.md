# ROUND 104 결과: COUNTER-MANAGER-FIRST-NAME-EDIT-001

## 1. 변경 파일 목록

| 파일 | 변경 |
|------|------|
| `app/counter/page.tsx` | 바텀시트 플로우를 store → category → manager 로 변경, 이름 인라인 수정 추가 |
| `app/api/sessions/participants/[participant_id]/route.ts` | `update_external_name` 액션에 audit 로그 추가 |

## 2. 바텀시트 변경 내용

### 이전 (round 103)
store → category → name (이름 입력 + 자동 매칭 + 실장 자동 연결)

### 이후 (round 104)
store → category → manager → 완료

- name 단계 완전 제거
- 가게 선택 시 실장 목록 로드
- 종목 선택 후 바로 manager 선택 단계로 이동
- manager 선택 후 "완료" 버튼으로 participant 확정
- 이름 입력은 바텀시트에서 하지 않음

### 제거된 상태 변수
- `nameInput`, `nameMatches`, `nameConfirmed` — 전부 제거
- `addHostess`, `setAddHostess` — 제거 (이름 매칭 불필요)

### 유지된 상태 변수
- `addHostessList` — 현재 미사용이나 향후 활용 가능, 선언만 유지

## 3. Participant 생성 확정 시점

바텀시트에서 **store + category + manager** 선택 완료 시 `handleSheetCommit` 호출.
이 시점에 PATCH로 전송하는 payload:
- `category`
- `time_minutes`
- `entered_at` (확정 시점 ISO string)
- `manager_membership_id` (선택된 실장)

`membership_id`, `external_name` 은 전송하지 않음. 이름은 카드에서 별도 입력.

## 4. 이름 인라인 수정 방식

### 미지정 카드 (membership_id 없음)
기존과 동일 — 카드 내 `<input>` 으로 이름 입력, `onBlur` 시 `handleExternalNameBlur` 호출.

### 확정 카드 (membership_id 있음) — 신규
- 기존의 텍스트 `displayName` 을 `<input>` 으로 교체
- `defaultValue`: `h.external_name ?? h.name ?? ""`
- `placeholder`: "이름 입력"
- `onBlur` 시 `handleExternalNameBlur(h.id, h.external_name, e.target.value)` 호출
- 밑줄 스타일 (`border-b border-white/20`, focus 시 `border-cyan-400`)
- `onClick` 에서 `e.stopPropagation()` 으로 카드 선택(토글)과 분리

### 이름 규칙
- 이름이 비어 있어도 participant는 유효
- 이름 오입력이어도 저장 허용
- 이름 외 필드 (category, manager, store, 정산 값)는 인라인 수정 불가

## 5. 이름 수정 audit 기록 방식

### 파일: `app/api/sessions/participants/[participant_id]/route.ts`

`update_external_name` 액션에서 이름 변경 시 (`beforeName !== afterName`) audit_events INSERT:

```json
{
  "store_uuid": "authContext.store_uuid",
  "actor_profile_id": "authContext.user_id",
  "actor_role": "authContext.role",
  "actor_type": "authContext.role",
  "session_id": "p.session_id",
  "entity_table": "session_participants",
  "entity_id": "participant_id",
  "action": "update_external_name",
  "before": { "external_name": "이전값" },
  "after": { "external_name": "이후값" }
}
```

기록 항목: participant_id, session_id, before name, after name, actor (profile_id + role), timestamp (DB default).

## 6. 미확인 권한/제약사항

- `update_external_name` 액션은 `store_uuid` scope 체크 (session이 본인 매장 소속인지 확인). 타가게 session의 participant 이름은 수정 불가.
- settlement, checkout 로직 변경 없음.
- DB schema 추가 없음 (기존 `external_name`, `audit_events` 활용).
- `addHostessList` 상태는 선언만 유지, UI에서 미사용. 향후 필요 시 제거 가능.

## 7. 검증

- `tsc --noEmit`: 0 errors
