[ROUND]
STEP-009.4

[TASK TYPE]
chat leave / close behavior

[OBJECTIVE]
채팅방 나가기 및 종료 규칙을 도입한다.

이번 단계 목표:
- direct chat: 나만 나가기
- group chat: 나만 나가기
- group chat: creator 또는 owner 가 그룹 종료 가능
- store chat: 나가기/삭제 불가
- room_session chat: 기존 checkout 자동 종료 유지

중요:
이번 단계는 hard delete 가 아니라 soft leave / soft close 를 구현하는 단계다.

[CONSTRAINTS]
1. 메시지 hard delete 금지
2. chat_participants.left_at 기반 personal leave 유지
3. chat_rooms.is_active / closed_at / closed_reason 기반 room close 유지
4. broad refactor 금지
5. store_uuid / membership scope 유지
6. direct/group/store/room_session 타입 규칙을 혼동하면 안 된다

[DESIGN RULES]
1. direct chat 삭제 대신 "나만 나가기"를 사용한다
2. group chat 멤버는 자기 자신만 나갈 수 있다
3. group chat 전체 종료는 creator 또는 owner 만 가능하다
4. store chat 는 leave/close 불가다
5. room_session chat 는 수동 close 대신 checkout lifecycle 만 사용한다
6. 모든 leave 는 soft leave(left_at=now()) 여야 한다
7. 모든 close 는 soft close(is_active=false, closed_at, closed_reason) 여야 한다

[SCOPE]
허용:
- `app/api/chat/rooms/[id]/leave/route.ts` (신규 가능)
- `app/api/chat/rooms/[id]/close/route.ts` (신규 가능)
- `app/api/chat/rooms/route.ts` (필요 시 목록 숨김 규칙 보강)
- `app/chat/hooks/useGroupChat.ts`
- `app/chat/hooks/useChatRooms.ts`
- `app/chat/components/GroupMembersPanel.tsx`
- `app/chat/components/ChatRoomListItem.tsx`
- 필요한 최소 chat UI wiring

범위 밖:
- message delete
- store chat mute
- unread redesign
- realtime
- unrelated chat restructure

[TYPE RULES]
1. direct
- active participant 는 "나만 나가기" 가능
- 구현: 내 chat_participants.left_at = now()
- 상대방 채팅은 유지

2. group
- active participant 는 "나만 나가기" 가능
- creator / owner 는 그룹 전체 종료 가능
- 그룹 종료 구현: chat_rooms.is_active = false, closed_at = now(), closed_reason = 'manual'

3. store
- leave 불가
- close 불가

4. room_session
- 수동 leave/close 도입 금지
- checkout 자동 종료만 유지

[API EXPECTATIONS]
LEAVE:
- 대상 room 존재 + 같은 store_uuid + 현재 active participant 확인
- type 이 direct/group 일 때만 허용
- 자기 자신의 participant row만 left_at = now()
- 이미 left 상태면 404 또는 no-op 명확 처리

CLOSE:
- 대상 room 존재 + 같은 store_uuid 확인
- type = group 일 때만 허용
- creator 또는 owner 권한 필요
- is_active = false, closed_at = now(), closed_reason = 'manual'

[FAIL IF]
1. direct/group 나가기가 hard delete 로 구현됨
2. store chat 도 나가기가 가능해짐
3. room_session 수동 종료가 허용됨
4. 권한 없는 사용자가 group close 가능
5. tsc 실패
6. 기존 채팅 목록/접근 규칙 깨짐

[COMPLETE IF]
1. direct 나만 나가기 가능
2. group 나만 나가기 가능
3. group 종료 가능 (creator/owner)
4. store leave/close 차단
5. room_session 기존 lifecycle 유지
6. npx tsc --noEmit 통과

[ALLOWED_FILES]
- `app/api/chat/rooms/[id]/leave/route.ts`
- `app/api/chat/rooms/[id]/close/route.ts`
- `app/api/chat/rooms/route.ts`
- `app/chat/hooks/useGroupChat.ts`
- `app/chat/hooks/useChatRooms.ts`
- `app/chat/components/GroupMembersPanel.tsx`
- `app/chat/components/ChatRoomListItem.tsx`
- 필요한 최소 chat page wiring files

[FORBIDDEN_FILES]
- counter files
- settlement files
- unrelated pages
- package.json
- tsconfig.json
- next.config.*

[OUTPUT FORMAT]
1. FILES CHANGED
2. LEAVE/CLOSE DESIGN DECISION
3. API CHANGES
4. EXACT DIFF SUMMARY
5. TYPE-BY-TYPE BEHAVIOR
6. VALIDATION RESULT
7. STEP-009.4 COMPLETE 여부