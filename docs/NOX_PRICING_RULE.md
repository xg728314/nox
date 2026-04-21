# NOX PRICING RULE (LOCKED)

## 0. PURPOSE
이 문서는 NOX 시스템에서 사용하는 정산 규칙을 정의한다.

정산은 시스템의 핵심 기능이며,
모든 금액 계산은 이 문서를 기준으로 한다.

---

## 1. CORE PRINCIPLE

### 1.1 SERVER CALCULATION ONLY
- 모든 금액 계산은 서버에서 수행한다
- UI는 계산 결과만 표시한다

---

### 1.2 SINGLE SOURCE OF TRUTH
- 정산 결과는 DB 기준으로 관리한다
- 클라이언트 계산 금지

---

## 2. BASIC STRUCTURE

정산 기본 구조:

customer_payment
- hostess_payout
- manager_share
= owner_profit

---

## 3. TIME PRICING RULE

### 3.1 기본 타임

기본 기준:

- 60분 = 기본 타임
- 기본 금액 = 설정값 (예: 100,000원)

---

### 3.2 추가 시간

기본 규칙:

- 1~9분 → 추가 요금 없음
- 10~15분 → 추가 요금 발생
- 이후 → 설정 기준에 따라 증가

---

### 3.3 계산 방식

- 총 시간 = 종료 시간 - 시작 시간
- 총 타임 수 계산
- 추가 시간 규칙 적용

---

## 4. ORDER PRICING

### 4.1 메뉴 항목

- 양주
- 맥주
- 음료

---

### 4.2 계산 방식

customer_payment += 모든 오더 금액 합

---

## 5. HOSTESS PAYOUT

### 5.1 기본 구조

- 타임 기준 지급
- 또는 고정 금액

---

### 5.2 MVP 기준

간단 구조:

- 타임당 지급 금액
- 또는 총 금액 기준 지급

---

## 6. MANAGER SHARE

### 6.1 구조

- 정산 금액 일부를 실장 몫으로 분리

---

### 6.2 MVP 기준

간단 구조:

- 고정 금액
또는
- 비율 (%)

---

## 7. OWNER PROFIT

계산:

owner_profit =
customer_payment
- hostess_payout
- manager_share

---

## 8. DATA STORAGE RULE

정산 시 반드시 저장:

- customer_payment
- hostess_payout
- manager_share
- owner_profit
- applied pricing rule snapshot

---

## 9. IDEMPOTENCY RULE

중복 방지:

- 동일 세션 정산 중복 저장 금지
- 동일 요청 재처리 시 중복 계산 금지

---

## 10. VALIDATION RULE

반드시 검증:

- 음수 금액 금지
- 비정상 시간 계산 금지
- 계산 누락 금지

---

## 11. FUTURE EXTENSION

확장 가능:

- 복수 요금표
- 시간대별 요금
- 아가씨별 지급 정책
- 실장별 수익 구조
- 이벤트 할인
- 동적 pricing

---

## 12. FINAL RULE

정산 규칙은 단순 계산이 아니라
사업 구조다.

이 문서와 실제 계산이 다르면
시스템은 신뢰를 잃는다.
