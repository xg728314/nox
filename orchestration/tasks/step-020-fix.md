[ROUND]
STEP-020-FIX

[TASK TYPE]
controlled bug fix task

[OBJECTIVE]
STEP-019-VALIDATION 결과에서 발견된 문제를 수정한다.

이 작업의 목표는:
1. 금전 관련 오류 수정
2. 보안 취약점 수정
3. 로직 불일치 수정
4. UX 문제 보완
5. 기존 시스템 안정성 유지

이 작업은 “수정”이며,
무분별한 리팩토링 금지, 구조 변경 금지.

---

[LOCKED RULES]

- computeSessionShares 수정 금지
- settlement core behavior 변경 금지
- payout / cross-store 계산 로직 변경 금지
- store_uuid scope 유지
- resolveAuthContext 구조 유지
- audit 구조 유지
- 기존 API contract 깨지지 않도록 할 것
- 한 번에 하나의 문제만 수정 (atomic fix)

---

[INPUT SOURCE]

STEP-019-VALIDATION 결과를 기반으로만 작업한다.

필수:
- TEST RESULTS
- CRITICAL BUGS
- LOGIC ISSUES
- MINOR ISSUES

추측 기반 수정 금지

---

[FIX PRIORITY]

우선순위 순서:

1. CRITICAL BUGS
   - 금액 오류
   - payout 잘못 처리
   - cancel 오류
   - cross-store 오류

2. SECURITY BUGS
   - 권한 우회
   - MFA 우회
   - reauth 우회

3. DATA INTEGRITY
   - paid / remaining mismatch
   - orphan 데이터

4. LOGIC ISSUES
   - 상태 이상
   - edge case

5. UX ISSUES
   - 입력 오류
   - 잘못된 메시지

---

[FIX PROCESS]

각 bug에 대해:

1. ROOT CAUSE 분석
2. 영향 범위 확인
3. 최소 수정 적용
4. 기존 기능 영향 확인
5. 재검증

---

[OUTPUT FORMAT - PER BUG]

각 문제별로 반드시 아래 형식:

### BUG N

**ISSUE**
- 문제 설명

**ROOT CAUSE**
- 정확한 원인 (추측 금지)

**FIX**
- 변경 내용

**FILES CHANGED**
- 수정된 파일

**RISK**
- 부작용 가능성

**VALIDATION**
- 수정 후 검증 결과

---

[GLOBAL VALIDATION]

모든 수정 후:

- npx tsc --noEmit
- payout 정상
- cancel 정상
- cross-store 정상
- MFA 정상
- reauth 정상
- audit 정상

---

[FAIL IF]

- 원인 분석 없이 수정
- 여러 문제 한 번에 수정
- 계산 로직 변경
- 구조 변경
- 기존 기능 깨짐
- 테스트 없이 수정

---

[FINAL OUTPUT]

1. FIXED BUG LIST
2. REMAINING ISSUES
3. SYSTEM STABILITY (GOOD / NEEDS WORK)