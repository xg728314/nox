---
name: hostess-lifecycle
description: NOX 아가씨 (hostess) 생명주기 · provisional 생성 · rename · merge · 미완 unmerge · 실장 assign. 오탈자 정리 · 중복 병합 흐름.
---

# Hostess Lifecycle

## Create (provisional)

`POST /api/hostesses/provisional`
- body: `{ name, store_uuid, external_name_alias?, manager_membership_id? }`
- 생성: `profiles` (id UUID 명시!) → `store_memberships` (role=hostess, status=approved) → `hostesses`
- alias 학습 · 다음 파싱부터 이 별칭 자동 매칭

## Rename

`PATCH /api/hostesses/[membership_id]/rename`
- body: `{ new_name, reason? }`
- 권한: super_admin · 본인 · 같은 매장 owner/manager
- `profiles.full_name` 업데이트 + `alias_learnings` 학습 (old_name → new_name)
- audit_events 로그

## Merge (병합)

`POST /api/hostesses/[membership_id]/merge`
- body: `{ into_membership_id, reason? }`
- 권한: super_admin · owner (from 매장 소속)
- 소급 UPDATE:
  - `session_participants.membership_id`
  - `cross_store_work_records.hostess_membership_id`
  - `staff_payout_states.hostess_membership_id`
  - `chat_pattern_dispatches.hostess_membership_id`
  - `hostess_schedules.hostess_membership_id`
  - `transfer_requests.hostess_membership_id`
  - `alias_learnings` (resolved_id=from → into · resolved_value 도 갱신)
- from 소프트 삭제:
  - `profiles.deleted_at` + optional `merged_into_membership_id` pointer
  - `store_memberships.deleted_at` + pointer
  - `hostesses.deleted_at` + pointer
- 감사: `hostess_merge_history` + audit_events

### PGRST204 fallback (필수)

`merged_into_membership_id` 컬럼은 migration 175 apply 시에만 존재.
미apply 시 PostgREST 는 **PGRST204** (schema cache miss) 에러.

```typescript
const isMissingColErr = (r) => r.error?.code === "42703" || r.error?.code === "PGRST204"

let r = await sb.from(table).update({ deleted_at, updated_at, merged_into_membership_id }).eq(...)
if (isMissingColErr(r)) {
  r = await sb.from(table).update({ deleted_at, updated_at }).eq(...)  // pointer 뺌
  if (isMissingColErr(r)) {
    r = await sb.from(table).update({ deleted_at }).eq(...)  // updated_at 도 뺌 (hostesses)
  }
}
```

**Without this**: soft-delete 안 됨 → merge 후 hostess 목록에 잔존.

## Unmerge (미완 · TODO)

병합 되돌리기. 필요한 것:
1. Migration: `hostess_merge_history.participant_reassignments JSONB` (per-participant `previous_membership_id` 스냅샷)
2. API: `POST /api/hostesses/[id]/unmerge` (본 merge_history 기반)
3. 소급 reverse: session_participants 복원 · deleted_at NULL 처리
4. UI: hostess-manage 페이지에 "분리" 버튼 · 24h 내만

## Manager assign

`PATCH /api/hostesses/[membership_id]/assign`
- body: `{ manager_membership_id: uuid | null }`
- `hostesses.manager_membership_id` 갱신
- UI: `/m/hostess-manage` + `/m/attendance` 페이지의 dropdown

## 정산 세분화 (실장별)

- session_participants.manager_membership_id 로 group by
- API: `/api/manager/settlement/summary` — owner visibility 마스킹 자동 적용
- 실장 지정 안 하면 (`null`) → NULL 그룹 · owner 만 볼 수 있음

## Session 담당 실장 (별개 개념)

- `room_sessions.manager_membership_id` — 그 세션 담당
- 체크인 액션한 사람 = 세션 매니저 (초기)
- 대신 체크인 케이스 → `PATCH /api/sessions/{id}` 로 변경
- UI: 외부조판 (`/m/staff`) 세션 카드 열림 시 "✏️ 실장 변경" 버튼

## 자주 하는 실수

- ❌ merge 후 UI 에 안 사라짐 → PGRST204 fallback 누락 (재확인)
- ❌ owner 경로 쿼리에 deleted_at 필터 누락
- ❌ provisional 에 role/email insert (컬럼 없음)
- ❌ session 담당 실장 ↔ hostess 담당 실장 혼동 (둘 다 있음 · 다른 개념)

## 체크리스트

- [ ] merge/rename/assign 코드 수정 시 audit_events 로그 유지
- [ ] soft-delete 는 PGRST204 fallback 포함
- [ ] 목록 쿼리 `.is("deleted_at", null)` 필터 (owner 경로 포함)
- [ ] 오탈자 자동 정리: /m/hostess-manage 페이지 (Levenshtein ≤ 2)
- [ ] 조판 UI 에 중복 배지 (같은 매장 같은 이름)
