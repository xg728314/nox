[ROUND]
STEP-011F

[TASK TYPE]
locked cleanup task

[OBJECTIVE]
STEP-011D, STEP-011E까지 완료되었고 지급/교차정산/무결성 봉인까지 끝난 상태다.
이번 단계의 목표는 legacy 컬럼과 legacy read path를 제거하고,
정산/지급/교차정산 구조를 단일 신규 컬럼 기준으로 통일하는 것이다.

핵심 목표:
1. dual-write 종료
2. legacy read route 제거 또는 신규 구조로 전환
3. legacy 컬럼 drop 준비 및 실제 제거
4. single source 구조 확정
5. 기존 기능 유지

[LOCKED RULES]
- 계산 로직 수정 금지
- computeSessionShares 수정 금지
- settlement 계산 구조 변경 금지
- payout / cross-store 핵심 동작 변경 금지
- breaking change는 허용되지만 반드시 legacy 제거 목적 범위 안에서만 발생해야 함
- store_uuid scope 규칙 유지
- resolveAuthContext 유지
- soft delete 유지

[LEGACY TARGETS]
다음 legacy 요소를 정리 대상으로 본다.

1. cross_store_settlements legacy columns
- store_uuid
- target_store_uuid
- note

2. cross_store_settlement_items legacy columns
- target_manager_membership_id
- assigned_amount
- prepaid_amount

3. payout_records legacy/혼용 값 점검
- payout_type 에 남아있는 legacy 허용값 정리
- cross_store_prepay 제거 가능 여부 검토 후 코드 기준 통일

4. legacy API read paths
- app/api/cross-store-settlements/route.ts
- app/api/cross-store-settlements/[id]/route.ts
- app/api/cross-store-settlements/[id]/prepay/route.ts

[REQUIRED CHANGES]

A. READ PATH 통일
- 모든 cross-store 조회/지급 관련 read/write path를 신규 컬럼 기준으로 통일
- from_store_uuid / to_store_uuid / manager_membership_id / amount / paid_amount / remaining_amount 기준으로만 동작
- legacy 컬럼 read 금지

B. WRITE PATH 통일
- dual-write 제거
- 신규 컬럼만 write
- 기존 RPC / route / helper가 legacy 컬럼에 write 하고 있으면 제거

C. MIGRATION
- legacy 컬럼을 실제로 drop 할 수 있으면 drop
- drop 전 반드시 모든 참조 코드 제거
- drop이 위험하면 이번 단계에서는 “참조 0 + drop-ready”까지 만들고 명시
- 추측 금지: 실제 참조 남아 있으면 drop 강행 금지

D. payout_type 정리
- legacy 값 `cross_store_prepay` 사용처 전부 확인
- 신규 구조에서 불필요하면 제거
- 제거 시 기존 route도 함께 정리
- 남겨야 하면 왜 남겨야 하는지 명시

E. API 정리
- 신규 표준 route만 남긴다:
  - POST /api/cross-store
  - POST /api/cross-store/payout
  - 필요한 GET route가 있으면 신규 구조 기준으로 유지
- legacy route는 삭제 또는 신규 route thin wrapper로 전환
- 동일 기능 중복 entry point 금지

[VALIDATION REQUIREMENTS]
반드시 확인:
1. repo 내 legacy column 참조 0
2. repo 내 legacy cross-store route 중복 경로 정리 완료
3. tsc --noEmit 통과
4. 가능하면 build 통과
5. cross-store 생성 정상
6. cross-store partial payout 정상
7. settlement payout 기존 동작 정상
8. store_uuid scope 유지
9. dual-write 제거 확인

[FAIL IF]
- 계산 로직 수정
- settlement core 변경
- legacy 컬럼 참조 남음
- legacy API와 신규 API가 동시에 동일 기능 수행
- 신규 컬럼으로 통일되지 않음
- migration 없이 코드만 수정
- 기존 payout/cross-store 기능 깨짐

[OUTPUT FORMAT]
1. FILES CHANGED
2. LEGACY REMOVED
3. API CONSOLIDATION
4. DB MIGRATION
5. VALIDATION
6. BREAKING CHANGES
7. RISKS / FOLLOW-UPS