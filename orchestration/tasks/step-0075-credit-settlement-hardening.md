[ROUND]
STEP-007.5

[TASK TYPE]
credit settlement hardening with schema/API integration

[OBJECTIVE]
현재 임시 구현된 credit-account 연결 방식을 정식 구조로 대체한다.

현재 문제:
- 수금 계좌 정보와 상태 전이가 credit.memo 같은 자유 텍스트 필드에 섞여 있다
- 이 방식은 구조 데이터 조회, 집계, 수정, 검증에 부적합하다

이번 단계의 목표:
- credit에 연결 계좌를 정식 필드로 저장한다
- 수금 상태를 정식 필드로 저장한다
- 수금 완료 시각을 정식 필드로 저장한다
- 기존 Counter 구조를 오염시키지 않는다
- memo 기반 임시 연결 로직을 제거한다

[CONSTRAINTS]
1. CounterPageV2에 business logic 직접 추가 금지
2. useCreditFlow / useAccountSelectionFlow / useCreditSettlementFlow의 책임 경계를 유지한다
3. DB → API → hook/component 순서로 수정한다
4. 기존 checkout/interim/credit/account-selection/my-info 흐름을 깨면 안 된다
5. 추측 금지. 현재 코드와 실제 스키마/라우트 기준으로만 작업한다
6. 관련 없는 broad refactor 금지

[DESIGN RULES]
1. linked account는 자유 텍스트가 아니라 정식 foreign-key/reference 성격 필드여야 한다
2. settlement status는 memo 파싱이 아니라 별도 상태 필드여야 한다
3. settled timestamp는 별도 필드여야 한다
4. memo는 다시 자유 메모 용도로만 남긴다
5. API route에서 membership/store scope 검증을 유지한다
6. component 내부에 직접 fetch/mutation 넣지 않는다
7. page는 wiring만 수행한다

[SCOPE]
이번 라운드 허용 범위:
- credits 관련 DB 필드 추가
- 관련 API route 수정
- hook 수정
- 필요한 타입 수정
- CounterPageV2 wiring 최소 수정
- tsc 검증

범위 밖:
- 외부 송금 연동
- PG/은행 API
- full settlement engine redesign
- unrelated UI redesign

[RECOMMENDED TARGET SHAPE]
가능한 목표 구조 예시:

credits table:
- linked_account_id uuid null
- settlement_status text not null default 'pending'
- settled_at timestamptz null

Allowed status example:
- pending
- collected
- cancelled

API:
- GET /api/credits returns structured fields
- PATCH /api/credits/[id] updates structured settlement fields instead of memo tags

Hook:
- useCreditSettlementFlow persists:
  - linked_account_id
  - settlement_status
  - settled_at
- memo tagging logic removed

UI:
- CreditSettlementModal still shows selected account
- collect action persists structured linkage/status
- cancel action persists structured status

[FAIL IF]
다음 중 하나라도 발생하면 실패다.

1. linked account가 여전히 memo parsing/string append에 의존
2. CounterPageV2에 mutation/fetch body 직접 추가
3. API scope/security 검증 약화
4. DB/API/hook 간 필드명이 불일치
5. 기존 흐름 손상
6. tsc --noEmit 실패

[COMPLETE IF]
다음을 모두 만족하면 완료다.

1. credits에 structured settlement/account fields 반영
2. 관련 API가 structured fields를 읽고 쓴다
3. useCreditSettlementFlow가 memo 대신 structured fields를 사용한다
4. CreditSettlementModal은 기존 UX를 유지한다
5. CounterPageV2는 wiring만 수행한다
6. 기존 흐름 유지
7. `npx tsc --noEmit` 통과

[ALLOWED_FILES]
- credits 관련 migration/schema files
- `app/api/credits/route.ts`
- `app/api/credits/[id]/route.ts`
- `app/counter/hooks/useCreditSettlementFlow.ts`
- `app/counter/components/CreditSettlementModal.tsx`
- `app/counter/CounterPageV2.tsx`
- `app/counter/types.ts`
- `app/counter/helpers.ts`

주의:
실제 코드베이스 구조상 credits 관련 schema/API 파일명이 다르면, 직접 관련된 실제 파일만 최소 범위로 수정한다.

[FORBIDDEN_FILES]
- unrelated auth files
- unrelated counter files
- unrelated settlement files
- package.json
- tsconfig.json
- next.config.*
- unrelated orchestration rules

[IMPLEMENTATION ORDER]
1. 현재 credits schema / API shape 확인
2. structured fields 추가 위치 결정
3. migration/schema update
4. GET/PATCH credits API update
5. useCreditSettlementFlow update
6. dead memo-tag logic 제거
7. CounterPageV2 wiring 영향 최소 확인
8. `npx tsc --noEmit`

[OUTPUT FORMAT]
최종 보고는 아래 형식만 사용한다.

1. FILES CHANGED
2. CREDIT SETTLEMENT HARDENING DECISION
3. SCHEMA/API CHANGES
4. EXACT DIFF SUMMARY
5. WHAT WAS REMOVED
6. WHAT REMAINS IN CounterPageV2
7. VALIDATION RESULT (`npx tsc --noEmit`)
8. STEP-007.5 COMPLETE 여부

[STOP CONDITIONS]
다음 상황이면 구현 중단 후 그대로 보고:
- credits schema 변경 권한/위치가 현재 코드베이스에서 불명확한 경우
- API가 예상과 다르게 분산되어 있어 안전한 최소 수정 범위가 불명확한 경우
- structured linkage를 넣으려면 광범위한 정산 모델 재설계가 필요한 것이 확인된 경우

이 경우 억지 구현하지 말고
"구현 중단 + 필요한 선행 조건"만 보고한다.