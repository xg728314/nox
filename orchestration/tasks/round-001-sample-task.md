[ROUND]
STEP-019

[TASK TYPE]
real execution validation (NO CODE CHANGE unless FAIL)

[OBJECTIVE]
현재 NOX 시스템의 실제 실행 검증을 수행한다.

정적 검증(tsc/build)은 이미 완료된 상태로 간주한다.
이 단계는 반드시 실제 UI/API 호출, 실제 DB read/write, 실제 권한 흐름 기준으로 검증해야 한다.

이 라운드의 기본 목적은 기능 개발이 아니라 아래 항목들의 실전 검증이다:
- payout flow
- cancel flow
- cross-store flow
- MFA / reauth
- closing flow

실패가 발견되면 재현 단계와 실제 코드/실행 기준 원인을 기록한다.
실패가 없으면 READY_FOR_PRODUCTION 여부를 판단한다.

[CONSTRAINTS]
- 추측 금지
- 코드 리팩터링 금지
- UI 개선 금지
- 계산 로직 변경 금지
- computeSessionShares 수정 금지
- settlement 재계산 금지
- UI 계산 추가 금지
- store_uuid 보안 기준 변경 금지
- resolveAuthContext 패턴 변경 금지
- FAIL이 확인되기 전까지 코드 수정 금지
- 검증 결과는 실제 실행/실제 응답/실제 DB 상태 기준으로만 작성
- 테스트 불가 항목은 추측하지 말고 "미실행" 또는 "미확인"으로 표시

[FAIL IF]
- 금액 불일치 발생
- 권한 우회 가능
- audit 누락
- 중복 cancel 허용
- closing 이후 write 가능
- cross-store partial 지급 후 잔액 정합성 깨짐
- payout / cancel / cross-store / MFA / closing 중 하나라도 실제 실행 검증 없이 PASS 처리
- 실제 재현 없이 추측으로 원인 작성
- FAIL을 발견했는데 재현 단계 누락
- 허용되지 않은 파일 수정65ㅅ효ㅗㅓ7

[TARGET FILES]
C:\work\nox\app\api\**
C:\work\nox\app\payouts\**
C:\work\nox\app\audit-events\**
C:\work\nox\lib\**
C:\work\nox\orchestration\results\round-001-sample-result.md
C:\work\nox\orchestration\logs\round-001-sample-result.log

[ALLOWED_FILES]
- C:\work\nox\app\api\**
- C:\work\nox\app\payouts\**
- C:\work\nox\app\audit-events\**
- C:\work\nox\lib\**
- C:\work\nox\components\**
- C:\work\nox\orchestration\results\round-001-sample-result.md
- C:\work\nox\orchestration\logs\round-001-sample-result.log

[FORBIDDEN_FILES]
- C:\work\nox\package.json
- C:\work\nox\package-lock.json
- C:\work\nox\tsconfig.json
- C:\work\nox\next.config.js
- C:\work\nox\.env
- C:\work\nox\.env.local
- C:\work\nox\supabase\**
- C:\work\nox\database\**
- C:\work\nox\orchestration\scripts\run-round.ps1
- C:\work\nox\orchestration\rules\**
- C:\work\nox\orchestration\handoff\**
- C:\work\nox\orchestration\tasks\step-*
- C:\work\nox\orchestration\tasks\round-001-sample-task.md (task 내용 교체 후 재실행 시 추가 수정 금지)

[TEST SCOPE]
1. PAYOUT FLOW
- Hostess payout 정상 지급 실행
- Manager payout 정상 지급 실행
- Partial payout 검증
- Prepayment 검증
- payout 후 payout_records 생성 여부 확인
- remaining / paid / unpaid 정합성 확인
- audit 기록 확인
- 권한 없는 계정 접근 차단 확인

2. CANCEL FLOW
- payout cancel 실행
- cancel 후 금액 원복 확인
- payout_records 상태 변화 확인
- 중복 cancel 2회 시도 차단 확인
- audit 기록 확인

3. CROSS-STORE FLOW
- store-level owed 존재 여부 확인
- manager-level partial 지급 확인
- partial 이후 store-level remaining 감소 확인
- multiple payout 총합 정합성 확인
- cancel 이후 재지급 정합성 확인

4. MFA / REAUTH
- payout 접근 시 재인증 요구 확인
- cross-store 접근 시 재인증 요구 확인
- OTP 실패 횟수 제한 확인
- trusted device 동작 확인

5. CLOSING FLOW
- closing 실행
- business_day 종료 확인
- closing_reports snapshot 생성 확인
- closing 이후 write 차단 여부 확인
- snapshot 불변성 확인

[VALIDATION CRITERIA]
각 테스트 케이스는 아래 기준으로 확인한다:
1. API response 정상 여부
2. DB 상태 변화 정확성
3. 권한 정책 준수 여부
4. audit 기록 존재 여부

[OUTPUT FORMAT]
## STEP-019 RESULT

### TEST SUMMARY
- total_cases:
- passed:
- failed:
- not_executed:

### PASS CASES
- [case_name]
- [case_name]

### FAIL CASES

#### [CASE NAME]
**재현 단계**
1.
2.
3.

**기대 결과**
-

**실제 결과**
-

**원인 (추측 금지 / 실제 코드 또는 실제 실행 기준)**
-

**영향 범위**
-

### NOT EXECUTED / UNVERIFIED
- [case_name] - [reason]

### FINAL VERDICT
- READY_FOR_PRODUCTION: YES / NO

[STOP CONDITIONS]
- FAIL 1개라도 존재 시 즉시 READY_FOR_PRODUCTION = NO 로 판단
- ALL PASS 시 STEP-021 진행 가능
- 테스트 환경 부족으로 미실행 항목이 핵심 플로우에 남아 있으면 READY_FOR_PRODUCTION = NO
