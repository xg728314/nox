[ROUND]
STEP-008.5

[TASK TYPE]
chat structure split

[OBJECTIVE]
현재 chat page 구조를 분리하여 god-page 상태를 해소한다.

현재 문제:
- app/chat/page.tsx 와 app/chat/[chat_room_id]/page.tsx 가
  fetch + state + auth header 구성 + modal 관리 + UI 렌더를 동시에 가진다
- hooks 없음
- components 없음
- 유지보수와 기능 확장이 어려운 구조다

이번 단계 목표:
- chat page 를 composition container 로 축소
- chat 로직을 hooks 로 분리
- chat UI 를 components 로 분리
- 기존 동작은 유지

중요:
이번 라운드는 구조 분리 단계다.
새 기능 추가, UX redesign, unread 방식 변경, realtime 재도입은 범위 밖이다.

[CONSTRAINTS]
1. 동작 변화 최소화
2. broad redesign 금지
3. 기존 REST-only chat 동작 유지
4. page 에 새로운 business logic 추가 금지
5. hooks 는 JSX 를 가지면 안 된다
6. components 는 fetch/mutation 을 가지면 안 된다
7. 추측 금지. 현재 코드 기준으로만 분리한다

[DESIGN RULES]
1. app/chat/page.tsx 는 room list 조립만 담당
2. app/chat/[chat_room_id]/page.tsx 는 room detail 조립만 담당
3. fetch / pagination / send / modal state 는 hooks 로 이동
4. room list / list item / dm modal / message list / composer 는 components 로 이동
5. auth header boilerplate 는 가능하면 기존 공용 helper 재사용을 우선 검토한다
6. realtime 은 재도입하지 않는다
7. 기존 API route 들은 건드리지 않는다 (구조 분리만)

[SCOPE]
허용:
- app/chat/page.tsx
- app/chat/[chat_room_id]/page.tsx
- app/chat/hooks/*
- app/chat/components/*
- chat 에 직접 필요한 최소 helper 재사용

범위 밖:
- API route behavior 변경
- DB/schema 변경
- realtime 재도입
- group invite 구현
- unread redesign

[RECOMMENDED TARGET SHAPE]
가능한 목표 구조 예시:

app/chat/hooks/useChatRooms.ts
- rooms list fetch
- loading/error
- new DM modal open/close
- create/open DM action

app/chat/hooks/useChatMessages.ts
- message fetch
- cursor pagination
- send message
- loading/sending/error
- visibilitychange refetch

app/chat/components/ChatRoomList.tsx
app/chat/components/ChatRoomListItem.tsx
app/chat/components/NewDmModal.tsx
app/chat/components/MessageList.tsx
app/chat/components/MessageBubble.tsx
app/chat/components/ChatComposer.tsx

핵심:
- page 는 hook 조립 + component 렌더만
- hook 은 도메인 상태/동작만
- component 는 UI 만

[FAIL IF]
다음 중 하나라도 실패다.

1. page 에 fetch/mutation body 가 대량으로 남아 있음
2. component 내부에 직접 API fetch/mutation 추가
3. hooks 내부에 JSX 추가
4. 기존 chat 동작 손상
5. realtime 이 다시 살아남
6. tsc 실패

[COMPLETE IF]
다음을 모두 만족하면 완료다.

1. rooms list 로직이 hook 으로 분리됨
2. message/pagination/send 로직이 hook 으로 분리됨
3. 주요 UI 가 components 로 분리됨
4. 두 page 가 composition container 역할만 수행
5. 기존 REST-only chat 동작 유지
6. `npx tsc --noEmit` 통과

[ALLOWED_FILES]
- `app/chat/page.tsx`
- `app/chat/[chat_room_id]/page.tsx`
- `app/chat/hooks/useChatRooms.ts`
- `app/chat/hooks/useChatMessages.ts`
- `app/chat/components/ChatRoomList.tsx`
- `app/chat/components/ChatRoomListItem.tsx`
- `app/chat/components/NewDmModal.tsx`
- `app/chat/components/MessageList.tsx`
- `app/chat/components/MessageBubble.tsx`
- `app/chat/components/ChatComposer.tsx`

주의:
실제 구조상 필요한 최소 범위 안에서만 생성/수정한다.

[FORBIDDEN_FILES]
- app/api/chat/*
- database/*
- counter files
- settlement files
- package.json
- tsconfig.json
- next.config.*

[IMPLEMENTATION ORDER]
1. app/chat/page.tsx 책임 분석
2. useChatRooms 추출
3. room list / dm modal components 추출
4. app/chat/[chat_room_id]/page.tsx 책임 분석
5. useChatMessages 추출
6. message list / bubble / composer components 추출
7. page 를 composition-only 로 정리
8. dead code / unused import 정리
9. `npx tsc --noEmit`

[OUTPUT FORMAT]
최종 보고는 아래 형식만 사용한다.

1. FILES CHANGED
2. CHAT STRUCTURE SPLIT DECISION
3. EXACT DIFF SUMMARY
4. REMOVED FROM PAGES
5. WHAT REMAINS IN PAGES
6. VALIDATION RESULT
7. STEP-008.5 COMPLETE 여부

[STOP CONDITIONS]
다음 상황이면 그대로 보고:
- 현재 page 코드가 예상보다 강하게 얽혀 있어 안전한 최소 분리가 불가능한 경우
- helper 재사용 없이 중복 fetch/auth 코드 제거가 불가능한 경우
- 구조 분리만으로 끝나지 않고 API 변경까지 필요해지는 경우

이 경우:
"중단 + 필요한 선행 조건"만 보고