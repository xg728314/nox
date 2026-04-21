# NOX PATCH — ROOM FEE SYSTEM (LOCKED)

## TASK TYPE
PATCH (ORDER TYPE + UI + CALCULATION MAPPING)

## WORKSPACE
C:\work\nox

## OBJECTIVE

현재 NOX 주문 구조에 룸티를 추가한다.

룸티는 1개가 아니라 2종류로 분리한다.

1. room_fee_base
2. room_fee_extra

이 둘은 성격이 다르므로 절대 하나로 합치지 않는다.

---

## LOCKED BUSINESS RULES

### 1. room_fee_base
정의:
- 술 없이 연장할 때 발생하는 룸티
- 입금가 있음
- 가게 매출 보전 목적

정산:
- store_revenue += deposit_price
- store_profit += deposit_price - cost_basis
- manager_profit += 0
- hostess_profit += 0

초기 구현:
- cost_basis 없으면 0으로 처리 가능

표시명:
- 룸티(연장)

---

### 2. room_fee_extra
정의:
- 술은 들어갔지만 실장이 추가로 올리는 룸티
- 입금가 없음
- 전액 실장 수익

정산:
- store_revenue += 0
- store_profit += 0
- manager_profit += sale_price
- hostess_profit += 0

표시명:
- 룸티(추가)

---

## IMPORTANT DOMAIN RULE

시간 정산과 주문 청구는 분리한다.

- 시간/연장 = 세션 진행 기록
- 룸티/주류 = 주문 청구 기록

즉:
- 연장했다고 룸티 자동 생성 금지
- 주류가 들어갔다고 룸티 자동 차단 금지
- 둘 다 수동 선택 입력 가능해야 함

---

## IMPLEMENTATION REQUIREMENTS

### [1] ORDER TYPE 확장

기존 orders type에 아래 추가:
- room_fee_base
- room_fee_extra

기존:
- liquor
- tip
- purchase

확장 후:
- liquor
- tip
- purchase
- room_fee_base
- room_fee_extra

---

### [2] 주문 입력 UI

카운터 주문 입력 영역에 룸티 추가 UI를 넣는다.

권장 방식:
- 버튼 2개
  - 룸티(연장)
  - 룸티(추가)

또는
- 룸티 버튼 1개 + 타입 선택

실사용 속도 때문에 버튼 2개가 더 적합하면 그렇게 구현해도 됨.

---

### [3] 입력 필드

#### room_fee_base
필수 입력:
- 판매가(sale_price)
- 입금가(deposit_price)

선택:
- 수량(qty) 기본 1

#### room_fee_extra
필수 입력:
- 판매가(sale_price)

금지:
- deposit_price 입력받지 않음

선택:
- 수량(qty) 기본 1

---

### [4] 계산 매핑

주문 저장 시 내부 계산 필드가 있다면 다음처럼 반영:

#### room_fee_base
- store_revenue = deposit_price
- store_profit = deposit_price - cost_basis
- manager_profit = 0

#### room_fee_extra
- store_revenue = 0
- store_profit = 0
- manager_profit = sale_price

hostess 관련 이익 배분은 없음

---

### [5] 주문 목록 표시

주문 목록에서 구분 가능하게 표시:

예:
- 양주 1병 180,000
- 룸티(연장) 1회 100,000
- 룸티(추가) 1회 100,000

삭제(x) 가능 유지

---

### [6] 세션/영수증/요약 반영

기존 주문 목록/영수증/세션 요약이 order type을 표시한다면
room_fee_base / room_fee_extra도 깨지지 않게 반영한다.

최소 요구:
- 저장 가능
- 목록 표시 가능
- 영수증에서 보이거나 최소한 누락되지 않음

---

## CONSTRAINTS

- 기존 주류 계산 로직 변경 금지
- 기존 정산 핵심 로직 무단 변경 금지
- store_uuid 보안 구조 변경 금지
- 자동 생성 규칙 추가 금지
- 룸티 2종류를 하나로 합치지 말 것
- 무관한 대규모 리팩터 금지

---

## VALIDATION REQUIRED

반드시 확인:

1. 룸티(연장) 추가 가능
2. 룸티(추가) 추가 가능
3. 둘 다 주문 목록에 남는가
4. 삭제 가능한가
5. room_fee_base는 deposit_price 기반으로 store 측 값 반영되는가
6. room_fee_extra는 manager 수익 항목으로 처리되는가
7. 기존 liquor/tip/purchase 동작 안 깨졌는가
8. TypeScript 에러 없는가

가능하면:
- tsc --noEmit
- npm run build

---

## OUTPUT FORMAT

FILES CHANGED:
- ...

ROOT CAUSE:
- ...

WHAT CHANGED:
- ...

ROOM FEE BASE RULE:
- ...

ROOM FEE EXTRA RULE:
- ...

VALIDATION:
- ...

KNOWN LIMITS:
- ...