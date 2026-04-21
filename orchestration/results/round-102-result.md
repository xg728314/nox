# ROUND 102 결과: session_participants.manager_membership_id 구현

## 1. 변경 파일 목록

| 파일 | 변경 |
|------|------|
| `database/010_session_participant_manager.sql` | 신규 migration 파일 |
| `database/002_actual_schema.sql` | manager_membership_id 컬럼 추가 반영 |
| `app/api/sessions/participants/[participant_id]/route.ts` | PATCH body에 manager_membership_id 추가 + 3중 검증 |
| `app/api/rooms/[room_uuid]/participants/route.ts` | GET 응답에 manager_membership_id/name 포함 (session > hostesses 우선순위) |
| `app/counter/page.tsx` | handleSheetCommit에서 manager_membership_id PATCH 전달 |

## 2. Migration SQL

```sql
ALTER TABLE session_participants
  ADD COLUMN manager_membership_id UUID REFERENCES store_memberships(id);

CREATE INDEX idx_session_participants_manager
  ON session_participants(manager_membership_id)
  WHERE manager_membership_id IS NOT NULL;
```

Supabase MCP로 실제 적용 완료 (piboecawkeqahyqbcize).

## 3. PATCH 검증 규칙

manager_membership_id가 body에 있으면 3중 검증:
1. store_memberships에 해당 UUID 존재 + deleted_at IS NULL
2. role = 'manager' 확인
3. manager의 store_uuid = 세션의 store_uuid (authContext.store_uuid) 확인

실패 시 400 반환.

## 4. GET 응답 우선순위

1. `session_participants.manager_membership_id` (세션 단위, 바텀시트에서 선택)
2. `hostesses.manager_membership_id` (기본 담당, fallback)

resolved된 manager_membership_id로 managers 테이블에서 이름 조회.

## 5. 미확인 사항

- manager settlement summary에서 session 단위 manager_membership_id 활용은 이번 round 범위 아님 (기존 hostesses.manager_membership_id 기반 유지)
- settlement 계산 로직 변경 없음
- checkout 로직 변경 없음
