[ROUND]
STEP-008.2

[TASK TYPE]
chat room_session uniqueness fix

[OBJECTIVE]
room_session 채팅방이 session_id 기준으로 하나만 생성되도록 DB와 API를 수정한다.

현재 문제:
- DB unique index는 type='room' 기준
- 실제 코드에서는 type='room_session' 사용
- 결과적으로 unique constraint가 작동하지 않음

이번 단계 목표:
- room_session 기준으로 session_id unique 보장
- 중복 생성 방지
- 기존 API 동작 유지

[CONSTRAINTS]
1. DB → API 순서로 수정
2. 기존 chat API 동작을 깨지 않는다
3. store_uuid scope 유지
4. broad refactor 금지
5. 추측 금지 — 실제 schema 기준으로 수정

[DESIGN RULES]
1. session_id + type='room_session' 조합은 유일해야 한다
2. 기존 잘못된 index는 제거해야 한다
3. 새로운 index는 정확한 조건으로 생성해야 한다
4. API에서도 중복 생성 방어 로직 유지해야 한다

[SCOPE]
허용:
- chat 관련 migration
- chat_rooms index 수정
- rooms API minimal 수정

범위 밖:
- 채팅 기능 추가
- UI 변경
- unread 구조 변경

[IMPLEMENTATION PLAN]

1. 현재 index 확인
- database/005_chat.sql 등에서 기존 index 위치 확인

2. 새로운 migration 작성
- 기존 index DROP
- 새로운 partial unique index 생성

예시:

DROP INDEX IF EXISTS idx_chat_rooms_session_unique;

CREATE UNIQUE INDEX idx_chat_rooms_session_unique
ON chat_rooms(session_id)
WHERE type = 'room_session' AND session_id IS NOT NULL;

3. 기존 데이터 충돌 확인
- 중복 session_id 존재 시
- 가장 최근(created_at DESC) 1개만 유지
- 나머지는 is_active=false 또는 soft delete

4. API 보완 (필요 시)
- POST /api/chat/rooms 에서
- 동일 session_id 존재 시 reuse

[FAIL IF]

1. index가 여전히 type='room' 기준
2. session_id 중복 허용 상태 유지
3. 기존 room 생성 로직 깨짐
4. tsc 실패
5. DB/API 불일치

[COMPLETE IF]

1. room_session 기준 unique index 적용
2. 중복 생성 방지
3. 기존 API 정상 동작
4. tsc 통과

[ALLOWED_FILES]
- database migration files
- chat schema files
- app/api/chat/rooms/route.ts

[FORBIDDEN_FILES]
- counter files
- settlement files
- unrelated pages
- package.json
- tsconfig.json

[OUTPUT FORMAT]

1. FILES CHANGED
2. INDEX FIX DECISION
3. SCHEMA CHANGES
4. EXACT DIFF SUMMARY
5. DUPLICATE HANDLING
6. VALIDATION RESULT
7. STEP-008.2 COMPLETE 여부

[STOP CONDITIONS]

- 기존 데이터 충돌 해결이 위험한 경우
- index 수정이 다른 기능에 영향 주는 경우

이 경우:
"중단 + 데이터 상태 보고"