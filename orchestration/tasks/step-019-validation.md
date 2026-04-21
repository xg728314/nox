[ROUND]
STEP-019-VALIDATION

[TASK TYPE]
full system validation task

[OBJECTIVE]
NOX 시스템 전체를 실제 운영 시나리오 기준으로 검증한다.

이 작업의 목표는:
1. 금전 흐름 정확성 검증
2. 권한/보안 정상 동작 확인
3. MFA / reauth / device 보안 확인
4. 지급/취소/교차정산 정상 여부 확인
5. 버그 및 설계 문제 탐지

이 작업은 테스트이며, 코드 수정은 포함하지 않는다.

---

[TEST STRATEGY]

- 실제 API 호출 기준 검증
- 가능한 경우 실제 데이터 생성 후 테스트
- 실패 시 원인 명확히 기록
- 추측 금지
- PASS / FAIL 명확히 판단

---

# 1. SETTLEMENT FLOW TEST

## 시나리오

1. session 생성
2. participant 추가
3. time 입력
4. liquor 입력
5. settlement 생성
6. confirmed

## 검증

- settlement_items amount 정확
- manager / hostess 분배 정확

---

# 2. PAYOUT TEST

## 시나리오

1. payout 실행
2. partial payout 실행

## 검증

- paid_amount 증가
- remaining 감소
- 상태 변경

---

# 3. PAYOUT CANCEL TEST

## 시나리오

1. payout 실행
2. cancel 실행

## 검증

- paid_amount 복구
- remaining 복구
- cancel 중복 차단

---

# 4. CROSS-STORE TEST

## 시나리오

1. cross-store 생성
2. item 설정
3. payout 실행

## 검증

- header remaining 감소
- item remaining 감소

---

# 5. SECURITY TEST

## 권한

- hostess payout 시도 → 403
- manager cross-store 생성 → 403
- 다른 store 접근 → 403

---

## MFA

- MFA 계정 로그인 → OTP 요구
- OTP 없이 로그인 → 실패

---

## DEVICE

- 다른 device 로그인 → MFA 요구

---

## REAUTH

- payout 호출 → reauth 없으면 401
- reauth 후 → 성공

---

## BRUTE FORCE

- OTP 반복 요청 → 429

---

# 6. API VALIDATION TEST

- invalid uuid → 400
- invalid amount → 400
- duplicate submit → 차단
- rate limit 초과 → 429

---

# 7. CLOSING TEST

1. business_day open
2. closing 실행

검증:
- closing_reports 생성

3. closing 이후:

- payout → 차단
- cross-store → 차단

---

# 8. AUDIT TEST

확인:

- payout 로그
- cancel 로그
- denied 로그

검증:

- actor 존재
- store_uuid 존재
- metadata 정상

---

# 9. REPORT TEST

- /reports 확인
- totals 일관성 확인
- UI 계산 없음

---

# 10. EDGE CASE

- manager NULL
- cancel 중복
- 0원 입력
- 네트워크 재요청

---

# OUTPUT FORMAT

1. TEST RESULTS (각 시나리오별 결과)
2. PASSED / FAILED
3. CRITICAL BUGS (금전/보안 관련)
4. LOGIC ISSUES (설계 문제)
5. MINOR ISSUES
6. RECOMMENDED FIXES
7. READY FOR PRODUCTION (YES / NO)