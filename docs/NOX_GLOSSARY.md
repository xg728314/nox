# NOX GLOSSARY (LOCKED)

## 0. PURPOSE
이 문서는 NOX 프로젝트에서 사용하는 모든 핵심 용어를 정의한다.

목표:
- 용어 혼선 방지
- DB / API / UI 동일 개념 유지
- 에이전트 간 해석 차이 제거

---

## 1. CORE ENTITIES

### 1.1 STORE
가게 단위

- 시스템의 최상위 운영 단위
- 모든 데이터는 store_uuid 범위 내에서 동작

---

### 1.2 FLOOR
층 단위

- store 내부의 논리적 구분
- MVP에서는 최소 1개만 사용

---

### 1.3 ROOM
방 단위

- 실제 운영 공간
- 세션이 생성되는 위치

구성:
- room_uuid: 내부 식별자
- room_no: 표시용 번호
- room_name: 이름

---

### 1.4 SESSION
운영 단위

- 방에서 시작되는 하나의 영업 흐름
- 시작부터 종료까지의 단위

구성:
- session_id: 실행 기준 식별자
- room_uuid 연결
- 상태: active / ended

---

### 1.5 SESSION_PARTICIPANT
세션 참여자

- 특정 세션에 포함된 인원

종류:
- customer (손님)
- hostess (아가씨)
- manager (실장)

---

## 2. USER ROLES

### 2.1 OWNER
- 가게 관리자
- 모든 데이터 접근 가능

---

### 2.2 MANAGER
- 실장
- 담당 아가씨 관리
- 세션 참여 가능

---

### 2.3 HOSTESS
- 아가씨
- 세션 참여자

---

### 2.4 CUSTOMER
- 손님
- 로그인 계정 아님

형태:
- headcount (숫자)
- 또는 익명 참여자

---

## 3. BUSINESS CONCEPTS

### 3.1 BUSINESS_DATE
영업일 기준 날짜

- 자정 기준이 아님
- 영업 기준으로 날짜 구분

---

### 3.2 CHECK-IN / CHECK-OUT

CHECK-IN:
- 세션 시작 또는 참여 시작

CHECK-OUT:
- 세션 종료 또는 참여 종료

---

### 3.3 DURATION
- 세션 또는 참여 시간
- 시작 ~ 종료 시간 기준

---

## 4. ORDER / ITEM

### 4.1 MENU_ITEM
- 판매 항목
- 양주 / 맥주 / 음료

---

### 4.2 ORDER
- 세션에 추가된 항목 기록
- 재고 관리 아님

---

## 5. SETTLEMENT

### 5.1 SETTLEMENT
- 세션 종료 후 금액 계산 결과

---

### 5.2 CUSTOMER_PAYMENT
- 손님이 지불한 금액

---

### 5.3 HOSTESS_PAYOUT
- 아가씨 지급 예정 금액

---

### 5.4 MANAGER_SHARE
- 실장 몫

---

### 5.5 OWNER_PROFIT
- 사장 수익

공식:
customer_payment - hostess_payout - manager_share

---

## 6. SYSTEM RULES TERMS

### 6.1 STORE_UUID
- 보안 범위 기준
- 모든 접근 제한 기준

---

### 6.2 ROOM_UUID
- 방의 canonical identity

---

### 6.3 ROOM_NO
- 표시용 번호
- 절대 식별자로 사용 금지

---

### 6.4 SESSION_ID
- 실행 기준 identity

---

## 7. STATUS TERMS

### 7.1 ROOM STATUS
- empty
- occupied

---

### 7.2 SESSION STATUS
- active
- ended

---

### 7.3 PARTICIPANT STATUS
- active
- left

---

## 8. FINAL RULE

용어는 "편의"가 아니라 "계약"이다.

이 문서와 다른 의미로 사용하는 순간
시스템은 반드시 깨진다.
