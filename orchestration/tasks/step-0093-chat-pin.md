[ROUND]
STEP-009.3

[TASK TYPE]
chat personal pin / unpin

[OBJECTIVE]
채팅방을 사용자 개인 기준으로 상단고정/해제할 수 있게 한다.

이번 단계 목표:
- 특정 사용자가 자신의 채팅방 목록에서 특정 방을 상단고정할 수 있어야 한다
- 고정은 participant(개인) 기준이어야 한다
- 다른 참여자의 정렬에는 영향이 없어야 한다
- 기존 unread / last_message 정렬과 조화롭게 동작해야 한다

[CONSTRAINTS]
1. room-global pin 금지 (개인 pin이어야 함)
2. broad refactor 금지
3. store_uuid / membership scope 유지
4. page에 business logic 추가 금지
5. 기존 direct/group/store/room_session 흐름 유지
6. 추측 금지. 현재 chat schema/API 기준으로만 수정한다

[DESIGN RULES]
1. pinned state는 chat_participants 수준에 둔다
2. pinned 값은 boolean보다 pinned_at timestamp가 더 적절하다
3. pin/unpin은 현재 로그인한 participant row만 수정한다
4. GET /api/chat/rooms 정렬에 pinned를 반영한다
5. component 내부에 직접 fetch/mutation 넣지 않는다
6. useChatRooms가 pin/unpin 로직을 소유한다

[SCOPE]
허용:
- chat migration / SQL files
- `app/api/chat/rooms/route.ts`
- `app/api/chat/rooms/[id]/pin/route.ts` (신규 가능)
- `app/chat/hooks/useChatRooms.ts`
- `app/chat/components/ChatRoomListItem.tsx`
- `app/chat/page.tsx` 최소 wiring

범위 밖:
- system pin
- 알림
- message-level read
- realtime 재도입
- unrelated chat restructure

[RECOMMENDED TARGET SHAPE]
가능한 목표 구조 예시:

schema:
- chat_participants.pinned_at timestamptz null

API:
- PATCH /api/chat/rooms/[id]/pin
  - current participant only
  - pinned=true -> pinned_at=now()
  - pinned=false -> pinned_at=null

GET /api/chat/rooms:
- participant row에서 pinned_at 포함
- order:
  1) pinned_at desc nulls last
  2) unread_count desc
  3) last_message_at desc

hook:
- useChatRooms
  - togglePin(roomId, nextPinned)

UI:
- ChatRoomListItem
  - pin icon/button
  - pinned visual state

[FAIL IF]
다음 중 하나라도 실패다.

1. pin이 room 전역에 적용됨
2. 다른 participant 정렬에 영향 줌
3. pin/unpin 권한 검증 없음
4. page에 mutation body 추가
5. tsc 실패
6. 기존 rooms list 동작 손상

[COMPLETE IF]
다음을 모두 만족하면 완료다.

1. participant 기준 pinned_at 저장
2. pin/unpin API 동작
3. rooms list 정렬에 pin 반영
4. UI에서 pin 토글 가능
5. 기존 채팅 흐름 유지
6. `npx tsc --noEmit` 통과

[ALLOWED_FILES]
- chat migration / SQL files
- `app/api/chat/rooms/route.ts`
- `app/api/chat/rooms/[id]/pin/route.ts`
- `app/chat/hooks/useChatRooms.ts`
- `app/chat/components/ChatRoomListItem.tsx`
- `app/chat/page.tsx`

[FORBIDDEN_FILES]
- counter files
- settlement files
- unrelated pages
- package.json
- tsconfig.json
- next.config.*

[OUTPUT FORMAT]
1. FILES CHANGED
2. CHAT PIN DESIGN DECISION
3. SCHEMA / API CHANGES
4. EXACT DIFF SUMMARY
5. WHAT NOW SORTS FIRST
6. VALIDATION RESULT
7. STEP-009.3 COMPLETE 여부

[STOP CONDITIONS]
- 현재 rooms list query 구조상 participant-level ordering 반영이 안전하지 않은 경우
- pin 구현에 광범위한 schema/API 재설계가 필요한 경우

이 경우:
"중단 + 필요한 선행 조건"만 보고