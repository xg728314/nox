# NOX SECURITY BASELINE (LOCKED)

## 0. PURPOSE
이 문서는 NOX MVP 단계에서 반드시 적용해야 하는 보안 기준을 정의한다.

보안은 나중에 붙이는 것이 아니라
초기부터 단계적으로 적용한다.

---

## 1. CORE SECURITY PRINCIPLES

### 1.1 NO UNAUTHENTICATED WRITE
- 인증 없는 모든 쓰기 요청 금지
- 모든 POST / PATCH / DELETE는 인증 필요

---

### 1.2 STORE SCOPE ENFORCEMENT
- 모든 데이터 접근은 store_uuid 기준
- cross-store 접근 금지

---

### 1.3 SERVER AUTHORITY
- 금액 계산은 서버에서 수행
- 클라이언트 입력 신뢰 금지

---

### 1.4 MINIMUM DATA EXPOSURE
- 필요한 데이터만 반환
- 민감정보 과다 반환 금지

---

## 2. AUTHENTICATION RULES

### 2.1 USER AUTH
- 로그인 기반 인증 필수
- 토큰 기반 인증

---

### 2.2 APPROVAL REQUIRED
- 승인되지 않은 계정 접근 제한
- pending 상태는 read 제한 가능

---

### 2.3 SESSION VALIDATION
- 모든 요청은 유효한 인증 상태 확인

---

## 3. AUTHORIZATION RULES

### 3.1 ROLE BASE ACCESS
- owner / manager / hostess 구분

---

### 3.2 PERMISSION CHECK
- API 단에서 권한 체크 필수
- UI 숨김만으로 보안 처리 금지

---

### 3.3 OWNER RESTRICTION
- owner만 특정 데이터 접근 가능 (확장)

---

## 4. DATA ACCESS CONTROL

### 4.1 STORE UUID FILTER
- 모든 쿼리는 store_uuid 포함

---

### 4.2 NO GLOBAL QUERY
- 전체 데이터 조회 금지

---

### 4.3 ENTITY VALIDATION
- session / room / participant 접근 시 store_uuid 검증

---

## 5. WRITE SAFETY RULES

### 5.1 CLOSED SESSION PROTECTION
- 종료된 세션 수정 금지

---

### 5.2 DUPLICATE REQUEST PROTECTION
- 동일 요청 중복 처리 방지

---

### 5.3 STATE VALIDATION
- 상태 전이 검증 (예: active → ended)

---

## 6. LOGGING / AUDIT

### 6.1 ACTION LOG REQUIRED
- 주요 액션 기록:
  - session 생성
  - participant 추가
  - order 추가
  - session 종료
  - 정산 확정

---

### 6.2 ACTOR TRACKING
- 누가 수행했는지 기록

---

## 7. INPUT VALIDATION

### 7.1 REQUIRED CHECKS
- 필수값 누락 방지
- 타입 검증
- 범위 검증

---

### 7.2 INVALID DATA BLOCK
- 음수 금액 금지
- 비정상 시간 금지

---

## 8. ERROR HANDLING

### 8.1 ERROR CODES
- 401: 인증 없음
- 403: 권한 없음
- 404: 대상 없음
- 400: 잘못된 요청

---

## 9. MVP SECURITY SCOPE

포함:
- 인증 필수
- store_uuid 스코프
- 기본 권한 체크
- 최소 로그

제외 (추후):
- 고급 RLS
- 이상 탐지
- 공격 탐지
- 감사 시스템 확장

---

## 10. FINAL RULE

보안은 기능이 아니라 기본 구조다.

이 규칙을 어기면
기능이 아니라 시스템이 무너진다.
