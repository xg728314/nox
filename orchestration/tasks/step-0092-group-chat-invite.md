[ROUND]
STEP-009.2

[TASK TYPE]
group chat invite and membership management

[OBJECTIVE]
현재 존재하지만 사용 불가능한 group chat 기능에
멤버 초대/추가/제거 기능을 구현하여 실사용 가능 상태로 만든다.

[CONSTRAINTS]
1. store_uuid scope 유지 (다른 store 멤버 금지)
2. membership status = approved만 허용
3. created_by_membership_id 또는 owner만 멤버 관리 가능
4. soft-delete(left_at) 방식 유지
5. 기존 chat 흐름 변경 금지
6. broad refactor 금지

[SCOPE]
- app/api/chat/rooms/route.ts (group create 보강)
- app/api/chat/rooms/[id]/participants/route.ts (신규)
- app/chat/hooks/useGroupChat.ts (신규)
- app/chat/components/GroupCreateModal.tsx
- app/chat/components/GroupMembersPanel.tsx
- app/chat/components/MemberPicker.tsx
- 필요한 최소 타입 수정

[IMPLEMENTATION]
1. group 생성 시 member_ids 처리 추가
2. participants add/remove API 구현
3. membership 검증 (store_uuid, status)
4. left_at 기반 soft leave 처리
5. hook으로 로직 분리
6. component로 UI 분리
7. page는 wiring만

[FAIL IF]
- 다른 store 멤버 초대 가능
- 권한 없는 멤버 추가/제거 가능
- 기존 direct/store/room_session 영향
- tsc 실패

[COMPLETE IF]
- group 생성 시 멤버 포함
- 멤버 추가/제거 가능
- soft leave 동작
- 권한 검증 정상
- tsc 통과

[OUTPUT FORMAT]
1. FILES CHANGED
2. GROUP CHAT DESIGN DECISION
3. API CHANGES
4. EXACT DIFF SUMMARY
5. PERMISSION MODEL
6. VALIDATION RESULT
7. STEP-009.2 COMPLETE 여부