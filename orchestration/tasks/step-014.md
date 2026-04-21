[ROUND]
STEP-014

[TASK TYPE]
locked financial recovery task

[OBJECTIVE]
현재 NOX는 payout / cross-store payout / prepayment까지 완료되었지만,
지급 취소(cancel) 및 복구(rollback / reversal) 흐름이 없다.

이번 단계의 목표는:
1. 잘못 지급된 금액을 안전하게 취소/복구할 수 있게 만들기
2. 음수 지급 없이 reversal row 방식으로 처리
3. audit trail을 유지하면서 상태를 되돌릴 수 있게 만들기
4. 기존 payout / settlement core behavior는 유지

이 단계는 "금전 복구 안전장치"이며 계산 엔진 변경이 아니다.

[LOCKED RULES]
- 계산 로직 수정 금지
- computeSessionShares 수정 금지
- settlement core behavior 변경 금지
- 기존 payout record를 hard delete 금지
- 음수 amount 지급 row 생성 금지
- 복구는 reversal row 또는 명시적 cancel state 방식으로만 처리
- audit trail 유지 필수
- store_uuid scope 유지
- resolveAuthContext 기반 권한 판단 유지

[CORE POLICY]

1. 기존 payout_records는 삭제하지 않는다.
2. 이미 완료된 payout을 취소할 때는:
   - 원본 payout row 유지
   - 별도의 reversal/cancel 기록 생성
   - settlement_item / cross_store item 의 paid_amount / remaining_amount 를 되돌린다
3. partial 지급 취소 가능해야 한다.
4. 이미 취소된 payout의 중복 취소는 차단해야 한다.
5. 취소 권한은 기본적으로 owner만 허용한다.
6. manager / hostess는 payout cancel 불가.
7. 취소 사유(reason / memo) 기록 필수.

[REQUIRED DATA MODEL]

현재 payout_records 구조를 먼저 확인하고,
가능하면 additive 방식으로 아래 필드/구조를 추가:

Option A (preferred):
- payout_records에 아래 필드 추가
  - reversed_by_payout_id nullable
  - original_payout_id nullable
  - status expanded to include cancelled or reversed-linked semantics
  - cancel_reason nullable

and/or

Option B:
- payout_reversals dedicated table
  - id
  - store_uuid
  - original_payout_id
  - reversal_payout_id
  - reason
  - created_by
  - created_at

중요:
- 어떤 방식을 택하든 "원본 row 보존 + 역방향 관계 추적"이 가능해야 한다.

[REQUIRED CHANGES]

A. SETTLEMENT PAYOUT CANCEL

필수 API 예시:
- POST /api/settlement/payout/cancel

request example:
{
  "payout_id": "uuid",
  "reason": "잘못 지급"
}

필수 검증:
- auth 통과
- owner만 허용
- payout_id uuid 검증
- same-store payout인지 확인
- 대상 payout이 취소 가능한 상태인지 확인
- 이미 취소/역전 처리된 payout인지 확인
- reason non-empty, max length 제한

처리:
1. 원본 payout 조회 및 잠금
2. 대상 settlement_item 조회 및 잠금
3. paid_amount / remaining_amount 복구
4. reversal/cancel row 생성
5. 원본 payout 상태 갱신 또는 reversal link 설정
6. 필요 시 parent settlement 상태 재평가
7. audit 기록

주의:
- 음수 금액 row 금지
- 트랜잭션 필수
- partial/full/prepayment 모두 안전하게 처리

---

B. CROSS-STORE PAYOUT CANCEL

필수 API 예시:
- POST /api/cross-store/payout/cancel

request example:
{
  "payout_id": "uuid",
  "reason": "중복 지급"
}

필수 검증:
- owner만 허용
- same-store 확인
- 대상 payout이 cross-store payout인지 확인
- 이미 취소된 payout 중복 취소 차단

처리:
1. 원본 payout 잠금
2. 관련 cross_store_settlement / item 잠금
3. item paid_amount / remaining_amount 복구
4. header remaining/status 재계산
5. reversal/cancel row 생성
6. audit 기록

---

C. STATUS POLICY

정책을 명확히 할 것:

원본 payout:
- completed → cancelled or completed(with reversal link)

reversal row:
- status = completed
- payout_type = reversal or cancel_reversal (명시적 enum 필요 시 추가)

중요:
- 기존 completed payout의 금전 기록은 사라지지 않아야 한다.
- 복구 후에도 “무슨 일이 있었는지” 추적 가능해야 한다.

---

D. DUPLICATE / SAFETY GUARDS

반드시 차단:
- 이미 취소된 payout 재취소
- 다른 store payout 취소
- hostess / manager 취소 시도
- reversal row 자체 재취소
- amount mismatch 복구

---

E. AUDIT

반드시 기록:
- settlement_payout_cancelled
- settlement_payout_cancel_failed
- cross_store_payout_cancelled
- cross_store_payout_cancel_failed
- payout_cancel_forbidden

metadata 예시:
- original_payout_id
- reversal_payout_id
- amount
- reason
- entity scope
- previous_status
- new_status

민감정보 과다 저장 금지

---

F. UI (가능하면 최소 범위)

가능하면:
- owner-only cancel button on payout detail/list
- reason 입력 modal
- 취소 성공 후 refetch

하지만 핵심은 서버 안전성이다.
UI는 thin 하게.

[VALIDATION REQUIREMENTS]

반드시 확인:
1. owner만 cancel 가능
2. manager/hostess cancel → 403
3. same-store 아닌 payout cancel → 차단
4. 이미 취소된 payout 재취소 → 차단
5. settlement payout cancel 시 paid/remaining 정확히 복구
6. cross-store payout cancel 시 item/header 상태 정확히 복구
7. audit 생성
8. tsc --noEmit 통과
9. 기존 payout/create flow 정상 유지

[FAIL IF]
- 원본 payout hard delete
- 음수 amount row 생성
- audit trail 없음
- cancel 중복 허용
- manager/hostess cancel 가능
- settlement core 계산 변경
- cross-store 상태 복구 불완전
- 트랜잭션 없이 부분 반영 가능

[OUTPUT FORMAT]
1. FILES CHANGED
2. DATA MODEL / MIGRATION
3. API ADDED / UPDATED
4. CANCEL / REVERSAL LOGIC
5. AUDIT
6. VALIDATION
7. RISKS / FOLLOW-UPS