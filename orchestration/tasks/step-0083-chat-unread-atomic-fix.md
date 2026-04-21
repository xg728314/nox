[ROUND]
STEP-008.3

[TASK TYPE]
chat unread atomic fix

[OBJECTIVE]
chat 메시지 전송 시 unread_count 증가를 read-modify-write 방식에서 atomic update 방식으로 교체한다.

현재 문제:
- POST /api/chat/messages 가 각 participant 의 unread_count 를 읽고 +1 후 다시 쓰는 구조다
- 동시 전송 시 increment 유실이 발생할 수 있다

이번 단계 목표:
- unread_count 증가를 원자적으로 처리한다
- sender 제외 / left_at IS NULL 조건을 유지한다
- 기존 메시지 전송 흐름은 깨지지 않게 한다

[CONSTRAINTS]
1. broad refactor 금지
2. DB → API 순서로 수정
3. store_uuid / membership scope 의미를 깨지 않는다
4. sender 본인은 unread 증가 대상이 아니어야 한다
5. left_at 있는 participant 는 제외되어야 한다
6. 추측 금지. 실제 schema / route 기준으로만 수정한다

[DESIGN RULES]
1. unread increment 는 단일 SQL 연산이어야 한다
2. read-modify-write 루프를 제거해야 한다
3. 가능하면 DB function / RPC 사용
4. API route 는 atomic helper 를 호출만 하게 유지한다
5. 기존 message insert 흐름은 유지한다

[SCOPE]
허용:
- chat 관련 migration / SQL function
- `app/api/chat/messages/route.ts`
- 관련 최소 타입 수정

범위 밖:
- realtime 재도입
- unread UI redesign
- read receipt 확장
- unrelated chat restructure

[RECOMMENDED TARGET SHAPE]
가능한 목표 구조 예시:

SQL:
- create or replace function increment_chat_unread(p_chat_room_id uuid, p_sender_membership_id uuid)
returns void
as $$
  update chat_participants
  set unread_count = unread_count + 1
  where chat_room_id = p_chat_room_id
    and membership_id <> p_sender_membership_id
    and left_at is null;
$$ language sql;

API:
- POST /api/chat/messages
  - message insert 성공 후
  - rpc("increment_chat_unread", { ... }) 호출
  - 기존 per-participant loop 제거

[FAIL IF]
다음 중 하나라도 실패다.

1. read-modify-write loop 가 남아 있음
2. unread increment 가 여전히 race 가능
3. sender unread 증가
4. left_at participant 증가
5. tsc 실패
6. 기존 send 흐름 손상

[COMPLETE IF]
다음을 모두 만족하면 완료다.

1. unread increment 가 atomic SQL/RPC 로 대체됨
2. API route 에서 기존 loop 제거됨
3. sender 제외 / left_at 제외 유지
4. 기존 send flow 유지
5. `npx tsc --noEmit` 통과

[ALLOWED_FILES]
- chat 관련 migration / SQL files
- `app/api/chat/messages/route.ts`

[FORBIDDEN_FILES]
- counter files
- settlement files
- unrelated pages
- package.json
- tsconfig.json
- next.config.*

[OUTPUT FORMAT]
최종 보고는 아래 형식만 사용한다.

1. FILES CHANGED
2. UNREAD ATOMIC FIX DECISION
3. SCHEMA / FUNCTION CHANGES
4. EXACT DIFF SUMMARY
5. WHAT WAS REMOVED
6. VALIDATION RESULT
7. STEP-008.3 COMPLETE 여부

[STOP CONDITIONS]
다음 상황이면 그대로 보고:
- 현재 DB 권한/환경상 RPC 추가가 불가능한 경우
- unread semantics 가 기존 route 외 다른 곳에 퍼져 있어 안전한 최소 수정이 불가능한 경우

이 경우:
"중단 + 필요한 선행 조건"만 보고