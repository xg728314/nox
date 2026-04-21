[ROUND]
STEP-019

[TASK TYPE]
locked operational validation task

[OBJECTIVE]
STEP-018까지 완료되면 NOX는 기능적으로 완성된 상태다.

이번 단계의 목표는:
1. 실제 운영 시나리오 기준 전체 시스템 검증
2. 금전 흐름 이상 여부 확인
3. 권한 / 보안 / audit 정상 동작 확인
4. edge case 및 실패 시나리오 검증
5. “실제로 써도 되는 상태”인지 최종 판단

이 단계는 개발이 아니라 “운영 검증”이다.

---

[LOCKED RULES]

- 코드 수정 최소화 (버그 발견 시 별도 patch)
- computeSessionShares 수정 금지
- settlement core 변경 금지
- 테스트는 실제 API / UI 흐름 기준
- store_uuid scope 유지
- role / auth 구조 그대로 사용

---

# 1. CORE TEST SCENARIOS

## 1. 기본 정산 흐름

1. 방 생성
2. participant 추가
3. 타임 입력
4. liquor 주문
5. settlement 생성
6. confirmed 상태 확인
7. payout 실행

검증:
- 금액 정확
- paid / remaining 정확

---

## 2. 부분 지급

1. settlement_item 존재
2. partial payout 실행

검증:
- paid_amount 증가
- remaining 감소
- 상태 partial

---

## 3. 선정산 (prepayment)

1. prepayment 실행

검증:
- remaining 감소
- audit 기록

---

## 4. 교차정산

1. cross-store 생성
2. manager item 구성
3. partial 지급

검증:
- header remaining 감소
- item remaining 감소
- 상태 변경

---

## 5. payout cancel (STEP-014)

1. payout 실행
2. cancel 실행

검증:
- paid 복구
- remaining 복구
- audit 기록

---

# 2. SECURITY TEST

## 1. 권한 테스트

- hostess → payout 호출 → 403
- manager → cross-store 생성 → 403
- 다른 store 데이터 접근 → 403

---

## 2. MFA / 로그인

1. MFA 계정 로그인
2. OTP 요구 확인
3. OTP 없이 접근 시 차단

---

## 3. 새 기기 로그인

1. 다른 device_id 사용
2. MFA 요구 확인

---

## 4. 재인증

1. payout 호출
2. reauth 없이 → 401
3. reauth 후 → 성공

---

## 5. brute-force

- OTP 반복 요청 → 429

---

# 3. AUDIT TEST

확인:

- payout 생성 로그
- payout 실패 로그
- payout cancel 로그
- cross-store 로그
- denied 로그

검증:

- actor 정보 존재
- store_uuid 존재
- metadata 정상

---

# 4. API PROTECTION TEST

- invalid uuid → 400
- invalid amount → 400
- duplicate submit → 차단
- rate limit 초과 → 429

---

# 5. CLOSING TEST

1. business_day open 상태
2. closing 실행

검증:
- closing_reports 생성
- business_day closed

---

3. closing 이후:

- payout 시도 → 차단
- cross-store 생성 → 차단

---

# 6. REPORT TEST

- /reports 데이터 확인
- totals 일관성 확인
- UI 계산 없음 확인

---

# 7. AUDIT VIEWER TEST

- /audit 접근 (owner만)
- 필터 동작
- pagination
- metadata 확인

---

# 8. EDGE CASE

- manager 없는 데이터
- 이미 cancel된 payout 재취소
- 0 또는 음수 입력
- 동일 요청 반복
- 네트워크 실패 후 재요청

---

# 9. PERFORMANCE CHECK

- 대량 데이터 조회
- pagination 동작
- response 시간 확인

---

# 10. FINAL CHECKLIST

모든 항목 YES여야 완료:

- [ ] payout 정상
- [ ] partial 정상
- [ ] cancel 정상
- [ ] cross-store 정상
- [ ] 권한 차단 정상
- [ ] MFA 정상
- [ ] reauth 정상
- [ ] audit 정상
- [ ] closing 정상
- [ ] report 정상

---

# OUTPUT FORMAT

1. TEST RESULTS
2. PASSED / FAILED
3. CRITICAL ISSUES
4. MINOR ISSUES
5. READY FOR PRODUCTION (YES / NO)