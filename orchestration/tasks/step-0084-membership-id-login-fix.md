[ROUND]
STEP-008.4

[TASK TYPE]
membership_id login propagation fix

[OBJECTIVE]
로그인 성공 후 클라이언트가 membership_id 를 안정적으로 보유하도록 auth/login 흐름을 수정한다.

현재 문제:
- app/chat/[chat_room_id]/page.tsx 감사에서 확인된 바와 같이,
  과거 chat UI 는 localStorage.membership_id 를 기대했지만
  app/login/page.tsx 는 access_token / user_id / store_uuid / role 만 저장하고 membership_id 는 저장하지 않았다.
- 이로 인해 membership 기반 클라이언트 판정이 깨질 수 있다.

이번 단계 목표:
- 로그인 응답에 membership_id 를 포함한다
- 로그인 페이지에서 membership_id 를 localStorage 에 저장한다
- 기존 로그인 흐름 / role / store scope 반환은 유지한다

[CONSTRAINTS]
1. broad auth refactor 금지
2. 실제 로그인 route / page 의 현재 구조 기준으로만 수정
3. membership_id 는 서버에서 신뢰 가능한 값으로만 내려와야 한다
4. 클라이언트가 임의 계산/추측해서 membership_id 를 만들면 안 된다
5. 기존 access_token / role / store_uuid 처리 흐름을 깨면 안 된다

[DESIGN RULES]
1. membership_id 는 resolveAuthContext 또는 동일 신뢰 경로 기반이어야 한다
2. login 응답 shape 는 최소 범위에서만 확장한다
3. app/login/page.tsx 는 membership_id 를 저장만 하고 비즈니스 로직을 늘리지 않는다
4. 기존 로그인 후 라우팅 흐름은 유지한다

[SCOPE]
허용:
- auth/login 관련 route
- app/login/page.tsx
- 관련 최소 타입 수정

범위 밖:
- 전면 auth redesign
- session storage 정책 변경
- unrelated pages 수정
- chat 구조 분리

[RECOMMENDED TARGET SHAPE]
가능한 목표 구조 예시:

API response:
{
  access_token,
  user_id,
  membership_id,
  store_uuid,
  role,
  ...
}

Client:
localStorage.setItem("membership_id", membership_id)

[FAIL IF]
다음 중 하나라도 실패다.

1. membership_id 가 여전히 응답/저장되지 않음
2. membership_id 를 클라이언트가 추측/합성함
3. 기존 로그인 성공 흐름 깨짐
4. tsc 실패
5. auth scope 약화

[COMPLETE IF]
다음을 모두 만족하면 완료다.

1. login API 가 membership_id 반환
2. login page 가 membership_id 저장
3. 기존 로그인 흐름 유지
4. `npx tsc --noEmit` 통과

[ALLOWED_FILES]
- auth/login 관련 route files
- `app/login/page.tsx`
- 관련 최소 auth helper/types files only if strictly necessary

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
2. MEMBERSHIP_ID FIX DECISION
3. AUTH RESPONSE CHANGES
4. EXACT DIFF SUMMARY
5. WHAT WAS REMOVED OR CORRECTED
6. VALIDATION RESULT
7. STEP-008.4 COMPLETE 여부

[STOP CONDITIONS]
다음 상황이면 그대로 보고:
- 현재 로그인 route 가 membership_id 를 안전하게 알 수 없는 구조인 경우
- membership_id 반환을 위해 auth 전면 재설계가 필요한 경우

이 경우:
"중단 + 필요한 선행 조건"만 보고