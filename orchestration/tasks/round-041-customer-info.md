[ROUND]
NOX-COUNTER-CUSTOMER-INFO-041

[TASK TYPE]
feature addition

[OBJECTIVE]
카운터에 손님 정보 입력/저장 기능을 추가한다.
방 운영 시작 시 손님 이름과 전화번호를 등록할 수 있게 하고,
방 헤더에도 손님 정보를 표시할 수 있게 만든다.

[CURRENT ISSUE]
- 현재 카운터에는 손님 설정 기능이 없음
- 방이 누구 손님인지 알기 어렵다
- 전화번호/기본 메모가 없어 재방문 고객 식별과 DB 축적이 안 된다

[LOCKED GOAL]
- 방별 손님 이름/전화번호를 입력 가능하게 한다
- 방 헤더에 손님명을 노출한다
- 손님 DB를 축적할 수 있는 구조를 만든다
- 이후 주의손님/공유 기능으로 확장 가능한 형태로 설계한다

[TARGET FILES]
- DB schema / migration for customer-related tables
- room/session related API files
- app/counter/CounterPageV2.tsx
- app/counter/components/RoomCardV2.tsx
- customer input related local component if needed
- directly related helper/type files only

[ALLOWED_FILES]
- directly related customer/session/counter files only

[FORBIDDEN_FILES]
- settlement core broad refactor
- unrelated APIs
- package.json
- tsconfig.json

[INSTRUCTIONS]
1. 손님(customer) 정보를 저장할 최소 구조를 설계하고 추가한다.
2. 손님 정보 최소 필드:
   - name
   - phone
   - phone_normalized
   - optional note
3. 방(room_session)과 손님(customer)을 연결하는 경로를 만든다.
4. 카운터에서 손님 이름과 전화번호를 입력/수정할 수 있게 한다.
5. 방 헤더에 손님 이름이 표시되게 한다.
   - 예: `1번방 · 사용 · 마블실장3 · 민주형님`
6. 기존 손님 검색/중복 방지를 고려하여 phone_normalized를 사용한다.
7. 향후 주의손님/공유 기능으로 확장 가능하게 구조를 설계하되, 이번 라운드는 입력/저장/표시에 집중한다.
8. 개인정보 저장이므로 필드/권한 범위는 최소로 시작한다.

[COMPLETION CRITERIA]
- 카운터에서 손님 이름/전화번호를 입력할 수 있다
- 방 헤더에 손님 이름이 표시된다
- 손님 정보가 DB에 저장된다
- 이후 watchlist 확장이 가능한 구조가 된다
- tsc --noEmit 0 errors

[OUTPUT FORMAT]
1. FILES CHANGED
2. SCHEMA SUMMARY
3. API FLOW
4. UI CHANGES
5. VALIDATION
