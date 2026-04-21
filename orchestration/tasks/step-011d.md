[ROUND]
STEP-011D

[TASK TYPE]
locked implementation task

[OBJECTIVE]
현재 시스템은 settlement 계산과 확정까지만 완료된 상태다.
이번 작업의 목표는 실제 돈 이동 기록 시스템을 추가하는 것이다.

이미 완료된 범위:
- computeSessionShares 기반 계산 완료
- session_participants / session_manager_shares / session_store_shares 저장 완료
- settlements 는 aggregation only 구조
- draft -> confirmed -> paid 상태 흐름 존재
- confirmed 이후 재계산 차단 완료

이번 STEP-011D 목표:
1. payout_records 구현
2. partial / prepayment 지급 처리 구현
3. cross_store_settlements + cross_store_settlement_items 구현

이 단계는 계산 단계가 아니라 돈 이동 기록 단계다.

[LOCKED RULES]
- settlement는 계산하지 않는다
- 계산은 computeSessionShares 에서만 한다
- UI에 계산 로직 넣지 않는다
- settlement에서 재계산하지 않는다
- anchor 구조 재도입 금지
- 모든 쿼리는 store_uuid 기준 스코프 강제
- resolveAuthContext 사용
- soft delete 유지
- confirmed 이전 정산은 지급 처리 불가
- partial 지급 가능
- 여러 번 나눠 지급 가능
- 선정산은 허용되지만 최종 잔액이 음수가 되면 안 된다
- 교차정산 기본 단위는 store-level
- 교차정산 내부 분배는 manager-level
- 선정산이 발생하면 남은 정산 금액이 줄어야 한다

[REQUIRED DATA MODEL]
1) payout_records
- id
- store_uuid
- settlement_id nullable
- settlement_item_id nullable
- recipient_type ('hostess' | 'manager')
- recipient_membership_id
- amount
- currency default KRW
- status ('pending' | 'completed' | 'cancelled')
- payout_type ('full' | 'partial' | 'prepayment')
- memo nullable
- created_at
- created_by
- completed_at nullable
- updated_at
- deleted_at nullable

2) cross_store_settlements
- id
- from_store_uuid
- to_store_uuid
- total_amount
- remaining_amount
- status ('open' | 'partial' | 'completed')
- memo nullable
- created_at
- created_by
- updated_at
- deleted_at nullable

3) cross_store_settlement_items
- id
- cross_store_settlement_id
- manager_membership_id
- amount
- paid_amount
- remaining_amount
- created_at
- updated_at
- deleted_at nullable

[REQUIRED CHANGES]
A. settlement_items 구조 확인 후 필요한 경우 아래 필드 추가
- paid_amount default 0
- remaining_amount default original amount

B. API 구현
1. POST /api/settlement/payout
request example:
{
  "settlement_item_id": "uuid",
  "amount": 50000,
  "payout_type": "partial",
  "memo": "선지급"
}

required validation:
- auth 통과
- role 적합성 확인
- same-store settlement_item 확인
- settlement confirmed 상태 확인
- amount > 0
- amount <= remaining_amount
- soft delete 제외

required writes:
- payout_records insert
- settlement_items.paid_amount 증가
- settlement_items.remaining_amount 감소
- 필요시 상위 settlement 상태 paid 갱신

2. GET /api/settlement/payouts
- same-store 지급 내역 목록 조회
- settlement_id / recipient_type / recipient_membership_id 필터 가능하면 추가

3. POST /api/cross-store
request example:
{
  "to_store_uuid": "uuid",
  "total_amount": 1200000,
  "memo": "발리 정산",
  "items": [
    { "manager_membership_id": "uuid1", "amount": 400000 },
    { "manager_membership_id": "uuid2", "amount": 800000 }
  ]
}

rules:
- from_store_uuid 는 authContext.store_uuid 로만 결정
- total_amount 와 items amount 합 검증
- negative/zero 차단

4. POST /api/cross-store/payout
- store/item remaining 감소
- remaining 음수 금지
- partial/completed 상태 갱신

[CRITICAL SAFETY FIXES]
- manager_membership_id NULL 문제를 조용히 통과시키지 말 것
- deduction orphan 방지
- store_revenue 저장 구조는 새 계산식 추가 없이 기존 구조 호환성만 점검

[IMPLEMENTATION ORDER]
1. settlement_items 구조 확인
2. migration 추가
3. backfill 처리
4. payout server logic 구현
5. payout API route 구현
6. cross-store server logic 구현
7. cross-store API route 구현
8. audit / validation / type cleanup
9. tsc --noEmit
10. 가능하면 build 검증

[FAIL IF]
- settlement에서 재계산함
- UI에 계산 로직 넣음
- anchor 구조 재도입
- remaining_amount 음수 가능
- confirmed 이전 지급 허용
- store_uuid 검증 누락
- manager NULL 문제 조용히 통과
- migration 없이 런타임 가정만 추가
- 트랜잭션 없이 부분 저장 가능
- 기존 settlement 확정/잠금 로직 파손

[OUTPUT FORMAT]
1. FILES CHANGED
2. DB CHANGES
3. API ADDED
4. EXACT LOGIC SUMMARY
5. VALIDATION
6. RISKS / FOLLOW-UPS