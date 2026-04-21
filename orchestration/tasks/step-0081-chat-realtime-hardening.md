[ROUND]
STEP-008.1

[TASK TYPE]
chat realtime security hardening

[OBJECTIVE]
현재 채팅 realtime 구독의 무권한 메시지 노출 가능성을 제거한다.

배경:
감사 결과에 따르면 app/chat/[chat_room_id]/page.tsx 가 NEXT_PUBLIC_SUPABASE_ANON_KEY 기반의 client realtime subscription 을 직접 열고 있고,
chat_messages 에 대한 RLS/participant gate 가 없어 chat_room_id 를 아는 사용자가 타인의 채팅을 실시간으로 수신할 가능성이 있다.

이번 단계의 목표:
- chat realtime 에 참여자 검증이 실제로 걸리게 한다
또는
- 안전한 검증이 불가능하면 client realtime 을 중단한다

중요:
이번 단계는 보안 봉합 단계다.
새 채팅 기능 추가, 그룹채팅 확장, UI 개선은 범위 밖이다.

[CONSTRAINTS]
1. store_uuid 는 절대 보안 스코프다
2. chat participant 검증 없이 realtime 을 유지하면 안 된다
3. broad refactor 금지
4. 추측 금지. 실제 schema / policy / route / page 코드 기준으로만 수정한다
5. 안전한 realtime 보장이 안 되면 realtime 을 비활성화하는 쪽을 선택한다
6. unrelated 파일 수정 금지

[DESIGN RULES]
1. realtime 보안은 REST 보안보다 약하면 안 된다
2. chat room 참여자만 해당 메시지를 수신해야 한다
3. left_at 이 있는 participant 는 접근 불가여야 한다
4. suspended / invalid membership 가 있으면 우회가 없어야 한다
5. client-side filter(chat_room_id=...) 만으로 보안을 주장하면 안 된다
6. component/page 에 새로운 비즈니스 로직을 대량 추가하지 않는다

[SCOPE]
이번 라운드 허용 범위:
- chat 관련 SQL / migration / policy 수정
- chat realtime 사용부 수정
- 필요한 최소 auth/scope helper 수정
- tsc 검증

범위 밖:
- unread redesign
- group invite API
- message edit/delete
- broad chat restructure
- unrelated feature changes

[PRIMARY SUCCESS CONDITION]
다음 둘 중 하나를 만족해야 한다.

A안:
- chat_messages realtime 이 participant-gated RLS/policy 하에서만 동작
- 해당 gate 가 실제 chat participant membership 을 검증
- unauthorized subscription 이 불가능

B안:
- client direct realtime 제거 또는 비활성화
- 메시지 수신은 기존 REST fetch 기반으로만 동작
- unauthorized live snooping path 제거

[FAIL IF]
다음 중 하나라도 발생하면 실패다.

1. realtime 이 여전히 anon/public client subscribe + 무권한 수신 가능 상태
2. participant 검증 없이 realtime 유지
3. 보안보다 UX를 우선해 구멍을 남김
4. unrelated 파일 대량 수정
5. tsc --noEmit 실패
6. schema/policy 와 client behavior 가 서로 안 맞음

[COMPLETE IF]
다음을 모두 만족하면 완료다.

1. unauthorized realtime snooping path 제거
2. 적용 방식(A안 또는 B안)을 명확히 설명
3. 필요한 schema/policy/client 수정이 정합적으로 반영
4. 기존 REST 채팅 동작은 유지
5. `npx tsc --noEmit` 통과

[ALLOWED_FILES]
- chat 관련 SQL / migration files
- `app/chat/[chat_room_id]/page.tsx`
- chat 관련 minimal helper/auth files only if strictly necessary

주의:
실제 코드베이스의 chat schema/policy/realtime 관련 파일만 최소 범위로 수정한다.

[FORBIDDEN_FILES]
- unrelated counter files
- unrelated settlement files
- package.json
- tsconfig.json
- next.config.*
- broad orchestration rule files
- unrelated app pages

[IMPLEMENTATION ORDER]
1. 현재 chat_messages / chat_participants / chat_rooms schema 와 policy 상태 확인
2. participant-gated realtime 을 안전하게 만들 수 있는지 판단
3. 가능하면 A안(RLS/policy) 적용
4. 불가능하거나 위험하면 B안(realtime disable) 적용
5. app/chat/[chat_room_id]/page.tsx 와 정책 상태 정합성 확인
6. `npx tsc --noEmit`

[OUTPUT FORMAT]
최종 보고는 아래 형식만 사용한다.

1. FILES CHANGED
2. REALTIME HARDENING DECISION (A안 or B안)
3. POLICY / SCHEMA CHANGES
4. EXACT DIFF SUMMARY
5. SECURITY RISK REMOVED
6. WHAT REMAINS UNFIXED
7. VALIDATION RESULT (`npx tsc --noEmit`)
8. STEP-008.1 COMPLETE 여부

[STOP CONDITIONS]
다음 상황이면 구현 중단 후 그대로 보고:
- chat realtime 보안을 안전하게 보장하려면 프로젝트 전역 RLS 정책 재설계가 필요한 경우
- 현재 schema 만으로 participant-gated realtime policy 를 정확히 작성할 수 없는 경우
- 안전한 A안 적용이 불가능하고 B안 적용도 제품적으로 금지된 경우

이 경우 억지 구현하지 말고
"구현 중단 + 필요한 선행 조건"만 보고한다.