[ROUND]
NOX-COUNTER-INVENTORY-MODAL-042

[TASK TYPE]
feature integration and code split

[OBJECTIVE]
카운터 화면에서 재고관리 모달을 바로 열 수 있게 하고,
주문 품목이 재고관리 품목과 연동되도록 수정한다.
이번 라운드는 기능 추가뿐 아니라 inventory/order 관련 코드를 분산시켜 카운터 파일 집중도를 낮추는 것이 목적이다.

[CURRENT ISSUES]
- 가게 직원이 카운터 화면에서 바로 재고관리를 할 수 없음
- 주문 추가 폼의 품목이 재고관리 품목과 연결되지 않음
- 이 상태로는 재고 차감, 품목별 판매 집계, 재고 검증이 불안정함
- inventory/order 관련 코드가 카운터 페이지 쪽에 몰릴 가능성이 큼

[LOCKED GOALS]
1. 카운터 화면에서 재고관리 모달을 열 수 있어야 한다
2. 주문 품목은 재고관리 품목과 연동되어야 한다
3. inventory/order 관련 코드는 적절히 분산시켜야 한다
4. 카운터 본문 파일에 로직 과밀이 생기지 않게 한다

[TARGET FILES]
- app/counter/CounterPageV2.tsx
- app/counter/components/RoomCardV2.tsx
- app/counter/components/OrderSectionV2.tsx
- inventory modal/new component files under app/counter/components/
- inventory/order related helper files under app/counter/ if needed
- directly related API files only if actually required

[ALLOWED_FILES]
- counter V2 local files
- inventory/order directly related files only

[FORBIDDEN_FILES]
- settlement core
- unrelated APIs
- package.json
- tsconfig.json

[INSTRUCTIONS]
1. 카운터 화면에서 재고관리 모달을 열 수 있는 진입점을 추가한다.
2. 재고관리 모달에서 최소한 아래가 가능해야 한다:
   - 품목 목록 조회
   - 품목 추가
   - 품목 수정
   - 현재 재고 확인
3. 주문 추가 폼이 재고관리 품목과 연결되도록 수정한다.
4. 가능하면 주문 품목은 재고 품목 선택 기반으로 바꾼다.
5. 품목 직접입력이 남아야 한다면 예외 경로로만 둔다.
6. 주문 추가 후 품목명/단가/수량이 재고 품목 기준으로 반영되게 한다.
7. 이후 재고 차감/집계 확장이 가능하도록 데이터 연결 구조를 정리한다.
8. inventory/order 관련 코드를 카운터 본문에서 분리한다.
   - modal
   - item picker
   - helper
   - local types
   등으로 분산
9. 카운터 페이지 또는 다른 파일에 과도하게 코드가 몰려 있으면 이번 라운드에서 같이 정리한다.
10. 기능을 넓게 퍼뜨리지 말고, 카운터 ↔ 재고 ↔ 주문 연결에 집중한다.

[COMPLETION CRITERIA]
- 카운터에서 재고관리 모달을 열 수 있다
- 주문 품목이 재고관리 품목과 연동된다
- inventory/order 관련 코드가 적절히 분산된다
- tsc --noEmit 0 errors

[OUTPUT FORMAT]
1. FILES CHANGED
2. ROOT CAUSE OR GAP
3. EXACT DIFF SUMMARY
4. INVENTORY FLOW
5. CODE SPLIT SUMMARY
6. VALIDATION
