[ROUND]
STEP-009.5

[TASK TYPE]
chat unread badge and notification UX

[OBJECTIVE]
채팅 unread 데이터를 기반으로 사용자에게 알림 UX를 제공한다.

이번 단계 목표:
- 전체 unread 합계 표시
- 방별 unread 안정화
- 현재 방 예외 처리 보장
- realtime 없이 자연스러운 갱신

[CONSTRAINTS]
1. 기존 unread 구조 유지 (chat_participants.unread_count)
2. realtime 재도입 금지
3. broad refactor 금지
4. page에 business logic 추가 금지
5. store_uuid / membership scope 유지

[DESIGN RULES]
1. unread 합계는 API에서 계산한다
2. client는 단순 표시 + refresh 역할
3. 현재 보고 있는 방은 unread 증가 대상에서 제외되어야 한다
4. UI는 component, 로직은 hook
5. polling 또는 visibilitychange 사용 가능

[SCOPE]
허용:
- `app/api/chat/unread/route.ts`
- `app/chat/hooks/useChatUnread.ts`
- `app/chat/page.tsx`
- 필요한 최소 component 수정

범위 밖:
- push notification
- websocket/realtime
- message-level read
- unrelated chat features

[IMPLEMENTATION]
1. GET /api/chat/unread 확인 및 필요 시 보강
   - sum(unread_count)
   - membership_id 기준
2. useChatUnread hook 생성
   - totalUnread
   - refresh()
   - optional interval/visibility handling
3. chat/page.tsx 상단에 badge 표시
4. 기존 방별 unread 유지
5. 현재 방 open 시 unread reset 흐름 확인

[FAIL IF]
1. unread 합계 틀림
2. 현재 방에서도 unread 증가
3. 다른 store 데이터 섞임
4. tsc 실패
5. 기존 채팅 흐름 깨짐

[COMPLETE IF]
1. 전체 unread badge 표시
2. 방별 unread 정상
3. 현재 방 예외 처리
4. refresh 타이밍 정상
5. tsc 통과

[OUTPUT FORMAT]
1. FILES CHANGED
2. UNREAD UX DESIGN
3. API / HOOK CHANGES
4. EXACT DIFF SUMMARY
5. BADGE BEHAVIOR
6. VALIDATION RESULT
7. STEP-009.5 COMPLETE 여부