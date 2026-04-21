[ROUND]
STEP-011E

[TASK TYPE]
locked hardening task

[OBJECTIVE]
STEP-011D까지 완료된 상태에서 정산/지급 시스템은 기능적으로 완성되었다.
이번 단계는 데이터 무결성 강제 및 안정성 봉인을 수행한다.

목표:
1. 데이터 무결성 강제
2. NULL/유실/오염 데이터 차단
3. 잘못된 상태 진입 원천 봉쇄
4. legacy 구조 제거 준비
5. 지급 취소(rollback) 설계 기반 확보

[LOCKED RULES]
- 계산 로직 수정 금지
- computeSessionShares 수정 금지
- settlement 구조 변경 금지
- payout_records 구조 유지
- 기존 API 동작 변경 금지

[CORE SAFETY TARGETS]

1. manager_membership_id NULL 차단
- NULL 허용 금지
- INSERT/UPDATE 시 NULL → 에러
- fallback 금지

2. deduction orphan 방지
- manager 없는 deduction 생성 금지

3. settlement_items 무결성
- paid_amount >= 0
- remaining_amount >= 0
- paid_amount + remaining_amount = amount

4. cross_store_settlement 무결성
- remaining_amount >= 0
- paid_amount >= 0

5. payout_records 무결성
- amount > 0
- recipient_membership_id NOT NULL
- recipient_type IN ('hostess','manager')

6. store_uuid 강제
- 모든 write에서 필수

[REQUIRED DB HARDENING]

- NOT NULL:
  payout_records.recipient_membership_id
  cross_store_settlement_items.manager_membership_id
  settlement_items.remaining_amount

- CHECK:
  paid_amount >= 0
  remaining_amount >= 0
  amount > 0

- ENUM:
  recipient_type
  payout_type
  status

- FK:
  membership_id → store_memberships

[LEGACY CLEANUP PREP]
- legacy 컬럼 read 금지
- 신규 컬럼만 사용
- 추후 drop 준비

[PAYOUT CANCEL]
- 이번 단계에서는 구현하지 않음
- rollback 가능 구조 검증만 수행

[API HARDENING]
- store_uuid mismatch 차단
- soft delete 제외
- role mismatch 차단
- NULL critical field 차단

[IMPLEMENTATION ORDER]
1. 테이블 구조 분석
2. constraint migration 작성
3. 기존 데이터 검증
4. 위반 시 실패 처리
5. API validation 강화
6. 타입 정리
7. legacy read 제거
8. tsc 통과
9. build 검증

[VALIDATION REQUIREMENTS]
- manager NULL insert 실패
- 음수 금액 실패
- remaining 음수 실패
- store_uuid 없는 write 실패
- FK 위반 실패
- 기존 기능 정상 유지

[FAIL IF]
- 계산 로직 변경됨
- settlement 로직 변경됨
- NULL 허용 유지
- constraint 없이 코드로만 막음
- legacy 계속 사용

[OUTPUT FORMAT]
1. FILES CHANGED
2. DB HARDENING
3. CONSTRAINTS ADDED
4. VALIDATION LOGIC
5. BREAKING CHANGE 여부
6. RISKS