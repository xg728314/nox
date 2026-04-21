[ROUND]
STEP-009.3A

[TASK TYPE]
chat pin migration sync fix

[OBJECTIVE]
채팅 상단고정 기능이 현재 DB 스키마 불일치로 실패하는 문제를 복구한다.

현재 증상:
- UI 에러: "Could not find the 'pinned_at' column of 'chat_participants' in the schema cache"
- PATCH /api/chat/rooms/[id]/pin 가 500 실패
- 원인은 DB migration 미적용, 실제 컬럼 미존재, 또는 schema cache 불일치 가능성이 높다

이번 단계 목표:
- chat_participants.pinned_at 컬럼의 실제 존재 여부 확인
- migration 적용 상태 확인
- pin API 와 DB 스키마를 일치시킨다
- pin 기능이 정상 동작하도록 복구한다

[CONSTRAINTS]
1. 문제 원인을 실제 DB 기준으로 확인한다
2. broad refactor 금지
3. pin 기능 외 다른 chat 기능 변경 금지
4. 추측 금지. 실제 migration / schema / route 기준으로만 수정한다
5. 기존 pin 설계(participant-level pinned_at)는 유지한다

[DESIGN RULES]
1. pinned_at 는 chat_participants 수준이어야 한다
2. DB 컬럼이 없으면 migration/apply 상태를 바로잡는다
3. API 와 DB 스키마는 동일해야 한다
4. 임시 우회 문자열/다른 컬럼으로 대체하지 않는다

[SCOPE]
허용:
- chat migration / SQL files
- pin 관련 route
- 최소 범위 schema sync 확인/수정

범위 밖:
- 채팅 나가기/삭제
- unread
- group invite
- unrelated pages

[IMPLEMENTATION]
1. database/029_chat_participants_pinned_at.sql 확인
2. 실제 DB 에 chat_participants.pinned_at 존재 여부 확인
3. 미적용 상태면 정확한 적용 경로/파일 보정
4. /api/chat/rooms/[id]/pin 과 GET /api/chat/rooms 가 pinned_at 을 정상 사용하도록 정합성 확인
5. npx tsc --noEmit

[FAIL IF]
1. pinned_at 가 여전히 없음
2. pin API 500 지속
3. participant-level pin 설계가 깨짐
4. tsc 실패

[COMPLETE IF]
1. pinned_at 컬럼 존재 확인
2. pin API 정상 동작
3. rooms list pinned 정렬 정상
4. npx tsc --noEmit 통과

[ALLOWED_FILES]
- chat migration / SQL files
- `app/api/chat/rooms/route.ts`
- `app/api/chat/rooms/[id]/pin/route.ts`

[FORBIDDEN_FILES]
- counter files
- settlement files
- unrelated pages
- package.json
- tsconfig.json
- next.config.*

[OUTPUT FORMAT]
1. FILES CHANGED
2. PIN FIX ROOT CAUSE
3. SCHEMA SYNC CHANGES
4. EXACT DIFF SUMMARY
5. VALIDATION RESULT
6. STEP-009.3A COMPLETE 여부