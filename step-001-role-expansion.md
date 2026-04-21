# NOX WORK ORDER — STEP 1: ROLE SYSTEM EXPANSION

## 1. TASK INFO

TASK NAME: ROLE SYSTEM EXPANSION (3 → 5 roles)
TASK TYPE: SAFE PATCH (NO BEHAVIOR CHANGE)
PRIORITY: P0
RISK LEVEL: HIGH (AUTH BREAK 가능)

---

## 2. OBJECTIVE

현재 3단계 role 시스템:

- owner
- manager
- hostess

를 아래 5단계로 확장한다:

- owner
- manager
- waiter
- staff
- hostess

단, 기존 로그인 / 인증 흐름을 절대 깨지 않게 유지해야 한다.

---

## 3. SCOPE

허용 작업:
- role 타입 확장
- VALID_ROLES 확장

금지 작업:
- DB 스키마 변경 금지
- signup 구조 변경 금지
- approval 로직 변경 금지
- API 로직 변경 금지
- 권한 체크 추가 금지
- UI 변경 금지
- settlement / counter 로직 변경 금지

이 단계는 “role 확장만” 수행한다.

---

## 4. TARGET FILE

lib/auth/resolveAuthContext.ts

이 파일만 수정 가능

---

## 5. CURRENT STATE (문제)

현재 코드:

role: "owner" | "manager" | "hostess"

const VALID_ROLES = ["owner", "manager", "hostess"]

문제:

- DB에 waiter / staff 값이 들어오면
- 로그인 시 MEMBERSHIP_INVALID 발생
- 인증 자체 실패

---

## 6. REQUIRED CHANGES

### 6.1 role 타입 확장

BEFORE:
role: "owner" | "manager" | "hostess"

AFTER:
role: "owner" | "manager" | "waiter" | "staff" | "hostess"

---

### 6.2 VALID_ROLES 확장

BEFORE:
const VALID_ROLES = ["owner", "manager", "hostess"]

AFTER:
const VALID_ROLES = ["owner", "manager", "waiter", "staff", "hostess"]

---

## 7. STRICT RULES

반드시 유지:
- VALID_ROLES 기반 검증 로직 유지
- INVALID role → MEMBERSHIP_INVALID throw 유지

절대 금지:
- fallback role 추가 금지
- 자동 변환 금지 (예: waiter → manager)
- default role 지정 금지
- 새로운 validation 로직 추가 금지
- 다른 파일 수정 금지

---

## 8. VALIDATION

### 기존 기능 유지
- owner 로그인 정상
- manager 로그인 정상
- hostess 로그인 정상

### 신규 역할 허용
- role = "waiter" → 로그인 성공
- role = "staff" → 로그인 성공

### 잘못된 role 차단 유지
- role = "admin" → 로그인 실패 유지

---

## 9. BUILD CHECK

반드시 실행:

tsc --noEmit
npm run build

---

## 10. OUTPUT FORMAT

아래 형식으로 결과 보고:

### FILES CHANGED
- ...

### EXACT DIFF SUMMARY
- before:
- after:

### VALIDATION RESULT
- tsc:
- build:

### RISK CHECK
- any side effect:

### CONFIRMATION
- NO EXISTING ROLE BEHAVIOR BROKEN

---

## 11. STOP CONDITIONS

아래 상황 발생 시 작업 중단:

- 다른 파일 수정 필요 발견
- 타입 충돌 발생
- role 관련 코드가 다른 파일에도 있음
- 인증 흐름 영향 발생

임의 수정 금지, 반드시 보고

---

## 12. SUCCESS CRITERIA

- 기존 사용자 로그인 정상 유지
- waiter / staff 로그인 가능
- 잘못된 role은 계속 차단
- build / tsc 오류 없음

---

## 13. ONE LINE DIRECTIVE

기존 인증을 깨지 않고 role을 5단계로 확장하라. 그 외 변경 금지.