# NOX BUSINESS DATE RULE (LOCKED)

## 0. PURPOSE
이 문서는 NOX 시스템에서 사용하는 business_date 규칙을 정의한다.

이 규칙은 정산, 로그, 매출 집계, 세션 기록의 기준이 된다.

calendar date가 아닌
운영 기준 날짜를 사용하는 것이 핵심이다.

---

## 1. WHY BUSINESS_DATE

유흥업소 운영 특성:

- 자정을 넘겨 영업
- 밤 → 새벽까지 이어짐
- 단순 날짜 기준으로는 매출이 분리됨

따라서:
calendar date 대신 business_date를 사용한다.

---

## 2. BUSINESS DATE DEFINITION

business_date는 다음 기준으로 정의한다:

👉 "영업 기준 날짜"

---

## 3. DAY BOUNDARY RULE

기본 기준:

- 영업 시작 기준: 오전 12:00 (기본값)
- 영업 종료 기준: 다음날 오전 11:59:59

※ 필요 시 설정 가능 (확장)

---

## 4. ASSIGNMENT RULE

### 4.1 세션 생성 시
세션 생성 시점의 business_date를 부여한다.

---

### 4.2 세션 종료 시
종료 시점이 아니라
"시작 시점 business_date"를 유지한다.

---

### 4.3 자정 넘김 처리

예:

- 2026-04-10 23:00 시작
- 2026-04-11 01:00 종료

→ business_date = 2026-04-10

---

## 5. DATA APPLICATION

다음 테이블은 반드시 business_date를 가진다:

- sessions
- settlements
- orders
- action_logs

---

## 6. AGGREGATION RULE

모든 집계 기준:

- 오늘 매출
- 오늘 정산
- 오늘 세션

👉 business_date 기준

---

## 7. DO NOT USE CALENDAR DATE

금지:

- timestamp 기반 날짜 집계
- created_at 기준 집계
- 종료 시각 기준 집계

---

## 8. FUTURE EXTENSION

추후 확장 가능:

- 영업 시작 시간 설정
- 가게별 business_date 설정
- timezone 설정

하지만 MVP에서는 고정 규칙 사용

---

## 9. VALIDATION RULE

반드시 검증:

- 세션 시작 시 business_date 저장
- 모든 집계에서 business_date 사용
- calendar date 혼용 금지

---

## 10. FINAL RULE

business_date는 단순 날짜가 아니라
"정산 기준"이다.

이 규칙이 깨지면
매출과 정산은 반드시 틀어진다.
