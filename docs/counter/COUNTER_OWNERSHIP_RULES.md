# COUNTER OWNERSHIP RULES (LOCKED)

## 목적
이 문서는 Counter 관련 파일별 책임 소유권을 잠근다.
작업자는 변경 전에 반드시 이 문서를 기준으로 책임 위치를 판단해야 한다.

---

## 1. 공통 원칙

### 1-1. page ownership
`CounterPageV2`는 조립만 담당한다.
비즈니스 규칙, mutation body, receipt 계산, participant 처리 상세 로직은 소유하지 않는다.

### 1-2. hook ownership
hook은 도메인 로직과 상태를 소유한다.
여러 UI에서 재사용 가능해야 한다.

### 1-3. component ownership
component는 표현(UI)만 담당한다.
상위에서 받은 props를 기준으로 렌더링/이벤트 전달만 수행한다.

---

## 2. 파일별 소유권

### CounterPageV2.tsx
소유:
- hook 조립
- page-level open/close state
- cross-hook dependency wiring
- top-level effects
- render composition

비소유:
- 주문 mutation 상세
- participant mutation 상세
- checkout/interim 상세
- receipt 생성 상세
- 주문 폼 내부 규칙
- participant 선택 규칙

---

### useRooms.ts
소유:
- room fetch
- room list state
- room refresh
- summary fetch
- room polling/realtime 관련 상태

비소유:
- focus session detail
- order mutation
- participant mutation
- checkout mutation

---

### useFocusedSession.ts
소유:
- focus room/session detail
- focusData
- fetchFocusData
- fetchOrders
- focus cache

비소유:
- room list fetch
- order submit/delete mutation
- participant mutation
- checkout logic

---

### useOrderMutations.ts
소유:
- orderForm state
- add order
- repeat order
- delete order
- order mutation validation
- mutation 후 refetch 연결

비소유:
- focus source of truth 자체
- participant mutation
- checkout logic
- sidebar UI

---

### useParticipantMutations.ts
소유:
- selectedIds
- add hostess
- mid-out
- extend room
- participant mutation validation
- mutation 후 refresh 연결

비소유:
- order mutation
- checkout
- receipt flow
- room list fetch

---

### useCheckoutFlow.ts
소유:
- checkout submit
- interim receipt 생성
- closed room entry logic
- interim modal state
- swipe UI state/handlers
- checkout 이후 refresh 연결
- receipt 흐름 진입/실행

비소유:
- inventory fetch
- room list source of truth
- participant mutation
- customer search/create

---

### CounterSidebar.tsx
소유:
- sidebar UI
- summary 표시
- owner 메뉴 표시
- navigation / static actions rendering

비소유:
- summary fetch
- state source of truth
- API logic

---

### InterimModeModal.tsx
소유:
- interim mode 선택 UI
- open/close 표시
- elapsed / half_ticket 선택 이벤트 전달

비소유:
- receipt 생성
- checkout 계산
- API 호출
- room/session source state

---

### RoomCardV2.tsx / ClosedRoomCardV2.tsx
소유:
- room card UI
- room 상태 시각화
- 상위 이벤트 호출

비소유:
- 실제 mutation 로직
- API 호출
- store scope 판단

---

### ParticipantSetupSheetV2.tsx
소유:
- participant setup UI
- 입력 표시/이벤트 전달

비소유:
- participant persistence
- business rule source of truth

---

### ManagerChangeModalV2.tsx
소유:
- manager 변경 UI
- 이벤트 전달

비소유:
- manager fetch/save API
- permission 판단

---

### CustomerModal.tsx
소유:
- customer UI
- search/create 결과 표시
- 입력 이벤트 전달

비소유:
- customer persistence source of truth
- store scope/security 판단

---

## 3. 신규 기능 배치 규칙

### 외상(credit)
원칙:
- checkout / receipt 흐름과 직접 연결
- page에 넣지 말 것
- `useCheckoutFlow` 확장 가능 여부 먼저 검토
- 책임이 과도하게 커지면 `useCreditFlow` 신규 생성

### 계좌 선택
원칙:
- settlement/receipt/manager payout 연결 기능
- 단순 modal이면 component
- 계좌 조회/선택/저장 규칙은 hook

### 내정보
원칙:
- CounterPageV2에 넣지 말 것
- 독립 메뉴/페이지/section으로 분리
- 계좌관리 / 매출조회는 별도 모듈 책임

---

## 4. 실패 패턴

다음은 실패로 간주한다.

### 실패 1
`CounterPageV2`에 `useState` 추가 후 기능 로직 직접 작성

### 실패 2
component 파일에 fetch / mutation 직접 추가

### 실패 3
기존 hook 책임과 무관한 로직을 무리하게 밀어넣어 hook 비대화

### 실패 4
동일 상태를 page와 hook이 동시에 소유

### 실패 5
“급해서 일단 page에 넣고 나중에 분리” 방식 사용

---

## 5. 변경 전 체크리스트

작업 전 반드시 확인:
1. 이 로직은 UI인가 도메인인가
2. 이미 소유 중인 hook이 있는가
3. 새 hook이 필요한가
4. page에 남겨야 하는 이유가 진짜 있는가
5. component가 source of truth를 가지려는 구조는 아닌가

---

## 6. 최종 규칙

Counter 구조는 다음 원칙을 유지해야 한다.

- page는 조립
- hook은 로직
- component는 UI

이 규칙을 깨는 변경은 기능 완성 여부와 상관없이 구조 실패로 간주한다.