[ROUND]
STEP-009.1

[TASK TYPE]
room_session chat lifecycle hardening

[OBJECTIVE]
손님방 전용채팅(room_session)의 생명주기 규칙을 세션/체크아웃 기준으로 고정한다.

이번 단계 목표:
- room_session chat 은 active session 에 종속되어야 한다
- 해당 세션 참여자만 접근 가능해야 한다
- checkout 완료 시 room_session chat 이 자동으로 닫혀야 한다
- 닫힌 room_session chat 은 기본 목록에서 사라져야 한다
- 닫힌 room_session chat 은 메시지 조회/전송이 차단되어야 한다

중요:
이번 라운드는 room_session chat lifecycle 을 고정하는 단계다.
그룹 초대, 상단고정, 알림 확장은 범위 밖이다.

[CONSTRAINTS]
1. store_uuid 는 절대 보안 스코프다
2. room_session 채팅은 session_id 중심 규칙을 따라야 한다
3. broad refactor 금지
4. 추측 금지. 실제 schema / API / session / checkout 코드 기준으로만 수정한다
5. 기존 direct / group / store chat 동작을 깨면 안 된다
6. 기존 counter 구조를 오염시키면 안 된다

[DESIGN RULES]
1. room_session chat 접근은 session participation 또는 운영 role 기준이어야 한다
2. checkout 완료 시 room_session chat 은 close 처리되어야 한다
3. close 는 hard delete 가 아니라 soft-close 여야 한다
4. close 된 room_session chat 은 기본 chat 목록에서 숨겨야 한다
5. close 된 room_session chat 은 direct URL 접근 시에도 차단해야 한다
6. close 된 room_session chat 은 메시지 전송 차단해야 한다

[SCOPE]
허용:
- chat 관련 schema / migration files
- `app/api/chat/rooms/route.ts`
- `app/api/chat/messages/route.ts`
- checkout 또는 room close 와 직접 연결된 최소 route / hook / helper
- 필요한 최소 chat page behavior 수정

범위 밖:
- 그룹채팅 초대
- 상단고정
- 알림 시스템
- unread redesign
- unrelated UI redesign

[RECOMMENDED TARGET SHAPE]
가능한 목표 구조 예시:

chat_rooms:
- is_active boolean already used
- closed_at timestamptz nullable
- closed_reason text nullable ('checkout' | 'manual' | 'system')

Rules:
- room_session 생성/조회 시 is_active = true 기준
- checkout 완료 시 대응 room_session chat update:
  - is_active = false
  - closed_at = now()
  - closed_reason = 'checkout'

API expectations:
- GET /api/chat/rooms:
  - 기본 목록에서 inactive room_session 제외
- GET /api/chat/messages:
  - inactive room_session 접근 차단
- POST /api/chat/messages:
  - inactive room_session 전송 차단
- room/session checkout path:
  - 관련 room_session chat close 수행

[FAIL IF]
다음 중 하나라도 실패다.

1. checkout 후에도 room_session chat 이 계속 보임
2. checkout 후에도 메시지 전송 가능
3. direct/group/store 채팅까지 깨짐
4. closed room_session chat 이 URL 직접 접근으로 계속 열림
5. tsc 실패
6. store/session scope 검증 약화

[COMPLETE IF]
다음을 모두 만족하면 완료다.

1. room_session chat close 규칙 반영
2. checkout path 에 chat close 연결
3. close 된 room_session chat 목록 숨김
4. close 된 room_session chat 조회/전송 차단
5. direct/group/store chat 동작 유지
6. `npx tsc --noEmit` 통과

[ALLOWED_FILES]
- chat 관련 migration / SQL files
- `app/api/chat/rooms/route.ts`
- `app/api/chat/messages/route.ts`
- checkout / room close 와 직접 연결된 실제 파일
- 필요한 최소 chat page files only if strictly necessary

주의:
실제 코드베이스에서 checkout 완료 지점이 분산되어 있으면,
room_session close 를 넣는 최소/정확한 지점만 수정한다.

[FORBIDDEN_FILES]
- unrelated counter files
- unrelated settlement files
- package.json
- tsconfig.json
- next.config.*
- unrelated pages
- unrelated orchestration rules

[IMPLEMENTATION ORDER]
1. 현재 room_session chat read/send guards 확인
2. 현재 checkout 완료 지점 확인
3. 필요한 schema field(closed_at / closed_reason) 존재 여부 확인
4. room_session close migration/schema 보강 (필요 시)
5. checkout path 에 close 연동
6. GET /api/chat/rooms hidden rule 반영
7. GET/POST /api/chat/messages inactive room_session 차단 확인/보강
8. `npx tsc --noEmit`

[OUTPUT FORMAT]
최종 보고는 아래 형식만 사용한다.

1. FILES CHANGED
2. ROOM_SESSION LIFECYCLE DECISION
3. SCHEMA / API CHANGES
4. EXACT DIFF SUMMARY
5. CHECKOUT LINKAGE
6. WHAT IS NOW BLOCKED
7. VALIDATION RESULT
8. STEP-009.1 COMPLETE 여부

[STOP CONDITIONS]
다음 상황이면 그대로 보고:
- 현재 checkout 완료 지점을 안전하게 특정할 수 없는 경우
- room_session close 를 넣으려면 counter/settlement 전면 재설계가 필요한 경우
- chat inactive semantics 가 현재 API 와 충돌해 최소 수정으로 해결 불가능한 경우

이 경우:
"중단 + 필요한 선행 조건"만 보고