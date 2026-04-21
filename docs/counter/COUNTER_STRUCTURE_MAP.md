# COUNTER STRUCTURE MAP (LOCKED)

## 목적
이 문서는 현재 Counter 구조를 고정한다.
다음 작업자는 이 문서를 기준으로 수정 위치와 책임 경계를 판단해야 한다.

---

## 1. 현재 구조 요약

### 최상위 원칙
- `CounterPageV2` = 조립 컨테이너
- `hooks/` = 비즈니스 로직
- `components/` = UI
- page에 비즈니스 로직 추가 금지
- component에 API 호출 로직 추가 금지
- hook에 JSX 추가 금지

---

## 2. 현재 파일 구조

### Page
- `app/counter/CounterPageV2.tsx`

### Hooks
- `app/counter/hooks/useRooms.ts`
- `app/counter/hooks/useFocusedSession.ts`
- `app/counter/hooks/useOrderMutations.ts`
- `app/counter/hooks/useParticipantMutations.ts`
- `app/counter/hooks/useCheckoutFlow.ts`

### Components
- `app/counter/components/CounterSidebar.tsx`
- `app/counter/components/InterimModeModal.tsx`
- `app/counter/components/RoomCardV2.tsx`
- `app/counter/components/ClosedRoomCardV2.tsx`
- `app/counter/components/ParticipantSetupSheetV2.tsx`
- `app/counter/components/ManagerChangeModalV2.tsx`
- `app/counter/components/CustomerModal.tsx`

---

## 3. 현재 책임 분리

### CounterPageV2
역할:
- hooks 조립
- page-level UI state 관리
- cross-hook wiring
- render tree 구성

남아 있는 책임:
- error
- timeBasis
- sidebarOpen
- currentRole
- unreadChat
- busy
- orderOpen
- inventoryItems
- hostessStats
- customerModalOpen
- sheet / patchSheet
- mgr / patchMgr

남아 있는 helper/fetch:
- fetchUnreadChat
- fetchInventory
- fetchHostessStats
- loadManagersForStore
- ensureSession
- enterFocus
- exitFocus

남아 있는 handler:
- handleNameBlur
- handleDeleteUnsetParticipant
- handleAddRoom
- toggleSelect
- openSheetForEdit
- handleSheetCommit
- openMgrModal
- handleSaveManager
- searchCustomers
- createCustomer
- handleSaveCustomer

---

### useRooms
역할:
- room 목록 fetch
- daily summary 관리
- store 기준 room 상태 동기화
- polling / realtime bridge 내부 책임 보유 시 이 hook이 소유

소유 데이터 예시:
- rooms
- dailySummary
- loading
- now
- currentStoreUuid

---

### useFocusedSession
역할:
- focus된 room/session 상세 로딩
- focusData 관리
- fetchFocusData
- fetchOrders
- focus cache

소유 데이터 예시:
- focusRoomId
- focusData
- focusCache

---

### useOrderMutations
역할:
- 주문 입력 상태
- 주문 추가
- 빠른 반복 주문
- 주문 삭제
- 주문 후 focus refresh 연결

소유 데이터 예시:
- orderForm
- handleAddOrder
- handleQuickRepeatOrder
- handleDeleteOrder

---

### useParticipantMutations
역할:
- participant 선택/추가/변경 로직
- 아가씨 추가
- mid-out
- room extend
- participant mutation 이후 refresh 연결

소유 데이터 예시:
- selectedIds
- handleAddHostess
- handleMidOut
- handleExtendRoom

---

### useCheckoutFlow
역할:
- checkout 흐름
- interim receipt 생성
- closed room 클릭 진입
- interim modal open/close
- swipe 기반 UI state
- checkout/interim 후 refresh 연결

소유 데이터 예시:
- interimModalOpen
- setInterimModalOpen
- handleCheckout
- handleInterimReceipt
- createInterimReceipt
- handleClosedRoomClick
- swipeX
- onSwipeStart
- onSwipeMove
- onSwipeEnd

---

### CounterSidebar
역할:
- sidebar UI 렌더
- room summary / owner 메뉴 / 보조 정보 표시

### InterimModeModal
역할:
- 중간계산 모드 선택 UI
- elapsed / half_ticket 선택 이벤트 전달

---

## 4. 데이터 흐름

### Room List
`useRooms`
→ `CounterPageV2`
→ `RoomCardV2` / `ClosedRoomCardV2`

### Focus Session
room click
→ `enterFocus`
→ `useFocusedSession`
→ `focusData`
→ `RoomCardV2` 하위 렌더/조작

### Order Mutation
UI action
→ `useOrderMutations`
→ API mutation
→ `fetchFocusData` / `fetchOrders`

### Participant Mutation
UI action
→ `useParticipantMutations`
→ API mutation
→ `fetchFocusData`

### Checkout / Interim
UI action
→ `useCheckoutFlow`
→ receipt / checkout 처리
→ `InterimModeModal`
→ refresh

---

## 5. 절대 금지 사항

### 금지 1
`CounterPageV2`에 신규 비즈니스 로직 추가 금지

### 금지 2
`CounterPageV2`에 새 mutation body 직접 작성 금지

### 금지 3
`components/` 내부에서 API fetch / mutation 직접 작성 금지

### 금지 4
`hooks/` 내부에 JSX 작성 금지

### 금지 5
동일 책임을 page와 hook이 중복 소유하는 상태 금지

---

## 6. 신규 기능 추가 원칙

신규 기능은 아래 순서로만 추가한다.

1. 책임 위치 결정
2. 기존 hook 확장 가능한지 검토
3. 기존 hook 책임과 다르면 새 hook 생성
4. UI는 component에서만 추가
5. page는 wiring만 수행

---

## 7. 현재 구조 단계 판정

- STEP 1: rooms/sidebar 분리 완료
- STEP 2: focus/orders/participants 분리 완료
- STEP 3: checkout/interim/receipt 흐름 분리 완료

현재 상태:
**God Component 탈출 완료**
**기능 개발 재개 가능**