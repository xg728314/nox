[ROUND]
STEP-013B

[TASK TYPE]
locked audit hardening task

[OBJECTIVE]
STEP-013A까지 완료되면 역할 기반 권한 통제가 강화된다.
이번 단계의 목표는 돈/권한/보안 관련 핵심 동작에 대해 감사 추적(audit trail)을 강화하는 것이다.

목표:
1. 누가 어떤 정산/지급/교차정산 작업을 했는지 기록
2. 권한 거부/보안 이벤트 기록
3. 변경 전후 추적 가능한 최소 감사 구조 확보
4. 운영 분쟁 대응 가능 상태 만들기

이 단계는 기능 확장이 아니라 감사/추적 강화다.

[LOCKED RULES]
- 계산 로직 수정 금지
- computeSessionShares 수정 금지
- settlement core behavior 변경 금지
- payout / cross-store 금액 계산 변경 금지
- 기존 API contract 가능하면 유지
- audit 실패가 핵심 금전 트랜잭션을 깨뜨릴지 여부는 현재 프로젝트 규칙을 먼저 확인 후 보수적으로 유지
- store_uuid scope 유지
- resolveAuthContext 기반 actor 식별 유지

[AUDIT TARGETS]

반드시 기록 대상:

1. settlement payout 실행
2. settlement payout 거부 (권한/검증 실패 주요 케이스)
3. cross-store 생성
4. cross-store payout 실행
5. cross-store 접근 거부
6. 계좌 변경 (이미 구현돼 있으면 포함)
7. MFA / reauth 는 아직 미구현이면 이번 단계 범위 밖, 단 훅 포인트는 준비 가능

[REQUIRED CHANGES]

A. AUDIT EVENT STANDARDIZATION

audit_events 사용 구조를 먼저 확인하고,
가능하면 아래 공통 shape로 통일:

- store_uuid
- actor_user_id
- actor_membership_id nullable
- action
- entity_type
- entity_id
- status ('success' | 'denied' | 'failed')
- metadata jsonb
- created_at

metadata 예시:
- request summary
- payout_type
- amount
- previous_status
- new_status
- reason
- target role / recipient type

중요:
- 민감정보 과다 저장 금지
- OTP secret, raw credential, full account sensitive 값 저장 금지

---

B. SUCCESS AUDIT

반드시 성공 시 기록:

1. POST /api/settlement/payout
action example:
- settlement_payout_created

2. POST /api/cross-store
action example:
- cross_store_settlement_created

3. POST /api/cross-store/payout
action example:
- cross_store_payout_created

가능하면 entity_type / entity_id 명확히 구분:
- settlement
- settlement_item
- cross_store_settlement
- payout_record

---

C. DENIED AUDIT

권한 거부 / 차단도 기록 강화:

예:
- payout_forbidden
- cross_store_forbidden
- settlement_access_denied
- hostess_payout_attempt_blocked

최소한 아래는 기록:
- actor
- route/action
- target id if present
- deny reason

---

D. ERROR AUDIT

가능하면 서버 예외 중 중요한 것 기록:
- overpay attempt
- invalid recipient
- manager null rejection
- store mismatch
- settlement not confirmed

주의:
- 에러를 중복으로 과도하게 기록하지 말 것
- noise 폭증 금지
- load-bearing 실패만 기록

---

E. REUSABLE HELPER

가능하면 공통 helper 추가:
예:
- logAuditEvent(...)
- logDeniedAudit(...)
- logFinancialAudit(...)

중복 insert 코드 난립 금지

---

F. PAGE / UI OPTIONAL

이번 단계는 UI 중심 아님.
다만 필요하면 최소 owner-only audit view의 기반 route 정도는 추가 가능.
하지만 핵심은 write-path audit 강화다.

[VALIDATION REQUIREMENTS]

반드시 확인:

1. settlement payout 성공 시 audit 생성
2. cross-store 생성 성공 시 audit 생성
3. cross-store payout 성공 시 audit 생성
4. 권한 거부 시 denied audit 생성
5. 민감정보 직접 저장 안 함
6. store_uuid / actor 정보 누락 없음
7. tsc --noEmit 통과
8. 기존 payout/cross-store 정상 동작 유지

[FAIL IF]

- audit 없음
- 성공만 기록하고 거부 기록 없음
- actor/store 정보 누락
- 민감정보 저장
- 기존 금전 트랜잭션 깨짐
- 계산 로직 변경
- audit 코드가 route마다 제각각이고 재사용성 없음

[OUTPUT FORMAT]

1. FILES CHANGED
2. AUDIT EVENTS ADDED
3. HELPER / STRUCTURE
4. COVERAGE
5. VALIDATION
6. RISKS / FOLLOW-UPS