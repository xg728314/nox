# ROUND PATCH — COUNTER / RECEIPT / ACCOUNT / ORDER FIX

---

## [TASK TYPE]
PATCH (STRUCTURE + UI + STATE)

---

## [OBJECTIVE]

현재 카운터 화면에서 발생하는 다음 4가지 문제를 해결한다.

1. 계산서 프레임이 과도하게 커서 배경이 보이지 않는 문제
2. 담당실장 선택 후 계좌 선택 UI가 없는 구조 문제
3. 주문(양주/팁/사입) 입력 후 탭 이동 시 데이터가 사라지는 상태관리 버그
4. 전체 화면이 과도하게 넓어 실사용에 불편한 레이아웃 문제

---

## [CONSTRAINTS]

- 추측 금지
- 기존 settlement 계산 로직 변경 금지
- store_uuid 기반 보안 구조 변경 금지
- RLS 영향 주는 수정 금지
- 기존 API 구조 변경 금지 (읽기 추가는 허용)
- 무관한 파일 수정 금지
- 타입 에러 발생 시 즉시 중단

---

## [TARGET AREAS]

반드시 먼저 실제 파일 위치를 확인 후 수정:

- CounterPage 또는 Counter 관련 페이지
- 중간계산 / 계산서 Preview / Receipt 컴포넌트
- 주문 입력 UI (양주 / 팁 / 사입)
- 실장 / 계좌 관련 UI 또는 API
- 메인 레이아웃 (layout.tsx 또는 page wrapper)

---

# 1. RECEIPT UI FIX

## [문제]
계산서를 감싸는 바깥 컨테이너가 과도하게 커서
전체 화면이 흰 박스로 덮이는 상태

## [목표]

- 계산서 wrapper는 content 크기에 맞춰야 한다
- 배경이 보이도록 overlay 유지
- 계산서 외 영역이 과도하게 차지하면 안 된다

## [수정 방향]

- full-width wrapper 제거
- content-fit 구조로 변경
- overlay는 유지하되 dim 정도만 적용

## [확인 항목]

- 계산서 주변에 과도한 빈 영역이 없어야 한다
- 배경 UI가 보인다
- PNG export / print 영역 깨지지 않는다

---

# 2. ACCOUNT SELECTION SYSTEM

## [문제]
담당실장을 선택했지만 계좌 선택 UI가 없음

## [목표]

담당실장 선택과 계좌 출력은 반드시 분리

---

## [계좌 선택 모드]

반드시 아래 4가지 지원:

1. 담당실장 계좌
2. 같은 매장 다른 실장의 공유 계좌
3. 수기입력
4. 계좌 미출력

---

## [노출 규칙]

허용:
- 담당실장 계좌
- 같은 store_uuid + is_shared = true 계좌

금지:
- 다른 매장 계좌
- is_shared = false 계좌
- 비활성 계좌

---

## [UI 요구]

중간계산 또는 계산서 생성 흐름 안에서:

- 담당실장 선택
- 계좌 선택 (별도 UI)

모드별 UI:

### 담당실장 계좌
- 해당 실장 계좌 dropdown

### 공유계좌
- shared 계좌 dropdown

### 수기입력
- 은행명
- 계좌번호
- 예금주

### 미출력
- 아무것도 출력하지 않음

---

## [출력 규칙]

- hidden 선택 시 계산서 계좌 영역 제거
- manual 선택 시 입력값 출력
- 나머지는 선택된 계좌 출력

---

# 3. ORDER STATE FIX (핵심)

## [문제]

웨이터팁 입력 후 사입으로 이동 시 데이터 사라짐

## [원인]

카테고리별 state 분리

---

## [목표]

단일 orders 배열로 모든 주문 관리

---

## [데이터 구조]

```ts
OrderItem {
  id
  type: 'liquor' | 'tip' | 'purchase'
  amount
}