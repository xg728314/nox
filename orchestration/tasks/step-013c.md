[ROUND]
STEP-013C

[TASK TYPE]
locked API security hardening task

[OBJECTIVE]
STEP-013A, STEP-013B 이후 단계로서,
이번 작업의 목표는 payout / cross-store / settlements read API에 대해
입력 검증, tampering 방지, abuse 방지, 반복 호출 방지를 강화하는 것이다.

핵심 목표:
1. stricter input validation
2. id tampering 방지
3. 중복/과다 요청 방지
4. financial write route 보호
5. 기존 기능 유지

이 단계는 기능 추가가 아니라 API 보호 강화다.

[LOCKED RULES]
- 계산 로직 수정 금지
- computeSessionShares 수정 금지
- settlement core behavior 변경 금지
- payout / cross-store 핵심 계산 로직 변경 금지
- canonical routes 유지
- store_uuid scope 규칙 유지
- resolveAuthContext 기반 구조 유지
- 기존 성공 응답 의미를 불필요하게 바꾸지 말 것

[PROTECTION TARGETS]

반드시 보호 대상:

WRITE
1. POST /api/settlement/payout
2. POST /api/cross-store
3. POST /api/cross-store/payout

READ
4. GET /api/settlements/overview
5. GET /api/settlements/managers
6. GET /api/settlements/hostesses
7. GET /api/cross-store
8. GET /api/cross-store/[id]

[REQUIRED CHANGES]

A. STRICT INPUT VALIDATION

가능하면 공통 schema validation 사용:
- zod 또는 기존 프로젝트 validation 패턴 확인 후 재사용

필수 검증:
- uuid 형식 검증
- amount numeric / > 0
- payout_type 허용값만
- query param 허용값만
- string length sanity check
- memo 길이 제한
- items 배열 크기 제한
- items 내부 manager_membership_id / amount 검증

예:
POST /api/settlement/payout
- settlement_item_id valid uuid
- amount finite numeric > 0
- payout_type ∈ {full, partial, prepayment}
- memo nullable, max length 제한

POST /api/cross-store
- to_store_uuid valid uuid
- total_amount finite numeric > 0
- items non-empty
- items count upper bound 설정
- every item amount > 0
- every manager_membership_id valid uuid

POST /api/cross-store/payout
- cross_store_settlement_id valid uuid
- item_id valid uuid
- amount finite numeric > 0

---

B. ID TAMPERING DEFENSE

필수:
- body/query의 id는 형식 검증만이 아니라 ownership / store scope / role scope까지 확인
- 다른 store의 id를 넣어도 절대 동작하면 안 됨
- manager는 자기 scope 밖 대상 접근 불가
- hostess는 자기 것 외 접근 불가

중요:
- "uuid 형식 맞음" = 허용 아님
- 항상 authContext + DB scope 동시 검증

---

C. RATE LIMIT / ABUSE GUARD

가능하면 기존 프로젝트 패턴 재사용.
없으면 최소한 write route에 보수적 제한 추가.

최소 목표:
- payout write 연속 호출 방지
- cross-store create 남용 방지
- cross-store payout 연속 호출 방지

방법 예시:
- user_id + route 기준 단기 rate limit
- store_uuid + route 기준 보조 제한
- 너무 무거운 외부 인프라 요구 금지
- 프로젝트 현재 구조에 맞는 lightweight 방식 우선

주의:
- 정상 운영을 막을 정도로 과도하면 안 됨
- 실패 시 429 또는 명확한 에러

---

D. IDEMPOTENCY / DOUBLE-SUBMIT GUARD

가능하면 write route에 아래 중 하나 보강:
- idempotency key
- short duplicate window guard
- same actor + same payload + short interval 차단

최소 목표:
- 더블 클릭 / 재전송으로 동일 payout 두 번 들어가는 상황 추가 방지
- DB FOR UPDATE는 이미 있으므로, API 레벨 보조 보호를 더하는 목적

---

E. ERROR NORMALIZATION

보안상 의미 있는 에러는 일관되게 반환:
- invalid input → 400
- unauthorized → 401
- forbidden → 403
- rate limited → 429
- known validation conflict → 409 or 400 (프로젝트 기존 패턴 우선)
- internal error → 500

에러 메시지는:
- 운영에 필요한 수준으로 충분히 명확
- 내부 구조를 과도하게 노출하지 말 것

---

F. READ API HARDENING

GET 계열도 보호:
- page size / limit 상한
- 무제한 조회 금지
- filter 허용값 제한
- sorting 입력 받는다면 whitelist만 허용
- soft delete 제외 유지

---

G. REUSABLE HELPER

가능하면 helper 추가:
- validateUuidParam
- parsePositiveAmount
- rateLimitOrThrow
- enforceRoleScope
- normalizeApiError

중복 검증 코드 난립 금지

[VALIDATION REQUIREMENTS]

반드시 확인:
1. invalid uuid → 400
2. invalid amount → 400
3. invalid payout_type → 400
4. 다른 매장 id 주입 → 403 또는 차단
5. hostess가 write route 호출 → 403
6. write route 연속 호출 제한 동작 확인
7. duplicate submit 보호 존재
8. read API 무제한 조회 없음
9. tsc --noEmit 통과
10. 기존 정상 플로우 유지

[FAIL IF]
- 계산 로직 수정
- settlement core 변경
- uuid 형식만 보고 허용
- rate limit 없음
- write route 중복 제출 보호 없음
- 에러 코드 일관성 없음
- canonical route 외 경로 추가
- 기존 payout/cross-store 정상 동작 깨짐

[OUTPUT FORMAT]
1. FILES CHANGED
2. VALIDATION HARDENING
3. RATE LIMIT / DUPLICATE GUARD
4. ERROR HANDLING
5. COVERAGE
6. VALIDATION
7. RISKS / FOLLOW-UPS