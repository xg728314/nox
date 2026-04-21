[ROUND]
STEP-007

[TASK TYPE]
credit-account link design and controlled implementation

[OBJECTIVE]
외상(credit) 흐름과 계좌 선택(account selection) 흐름을 연결하는 구조를 설계/구현한다.

이번 단계의 목표:
- 외상 건에 선택 계좌를 연결할 수 있어야 한다
- 지급 상태를 최소한으로 표현할 수 있어야 한다
- 기존 Counter 구조를 오염시키지 않아야 한다
- 기존 useCreditFlow / useAccountSelectionFlow 책임을 유지해야 한다

중요:
이번 라운드는 "외상-계좌 연결 구조"를 만드는 단계다.
실제 송금 처리, PG 처리, 은행 이체, 최종 정산 완료 처리까지 한 번에 넣지 않는다.

[CONSTRAINTS]
1. CounterPageV2에 credit-account 비즈니스 로직 직접 추가 금지
2. useCreditFlow와 useAccountSelectionFlow를 하나로 합치지 않는다
3. UI는 components로 분리한다
4. 연결 로직은 새 hook 또는 명확한 독립 책임으로 분리한다
5. 기존 checkout/interim/credit/account-selection/my-info 흐름을 깨면 안 된다
6. 추측 금지. 현재 코드 구조와 기존 API/타입 기준으로만 작업한다

[DESIGN RULES]
1. 외상 생성과 계좌 선택은 별도 책임이다
2. 연결/지급 상태 관리는 별도 책임으로 둔다
3. component 내부에 직접 fetch/mutation 넣지 않는다
4. page는 wiring만 수행한다
5. 기존 self-scope account data와 room/session-scope credit data를 섞을 때 책임 경계를 명확히 유지한다

[SCOPE]
이번 라운드 허용 범위:
- credit-account 연결 hook 생성
- 연결용 modal/component 생성
- CounterPageV2 wiring 최소 수정
- 필요한 타입/props 정리
- tsc 검증

범위 밖:
- 실제 송금 처리
- 외부 결제 연동
- 정산 최종 확정 처리
- unrelated UI redesign
- store-wide reporting

[RECOMMENDED TARGET SHAPE]
가능한 목표 구조 예시:

- `app/counter/hooks/useCreditSettlementFlow.ts`
  - selected credit target
  - linked account id
  - settlement status
  - confirm link
  - optional refresh

- `app/counter/components/CreditSettlementModal.tsx`
  - 외상 건 요약
  - 선택 계좌 표시
  - 상태 선택/확정
  - 순수 UI

- `CounterPageV2`
  - hook 조립
  - prop wiring만 수행

[FAIL IF]
다음 중 하나라도 발생하면 실패다.

1. CounterPageV2에 새 mutation/fetch body 직접 추가
2. useCreditFlow 내부에 account-selection 책임을 강제로 흡수
3. useAccountSelectionFlow 내부에 credit settlement 책임을 강제로 흡수
4. component 내부에 직접 API fetch/mutation 추가
5. 기존 credit/account-selection 흐름 손상
6. tsc --noEmit 실패
7. 책임 경계 불명확

[COMPLETE IF]
다음을 모두 만족하면 완료다.

1. credit-account 연결 진입점 존재
2. 연결 상태/로직이 독립 hook으로 분리됨
3. 연결 UI가 component로 분리됨
4. CounterPageV2는 wiring만 수행
5. 기존 credit/account-selection 동작 유지
6. 타입 정합성 유지
7. `npx tsc --noEmit` 통과

[ALLOWED_FILES]
- `app/counter/CounterPageV2.tsx`
- `app/counter/hooks/useCreditSettlementFlow.ts`
- `app/counter/components/CreditSettlementModal.tsx`
- `app/counter/types.ts`
- `app/counter/helpers.ts`

주의:
실제 구조상 필요한 최소 범위 안에서만 수정한다.

[FORBIDDEN_FILES]
- auth core files
- unrelated app pages
- package.json
- tsconfig.json
- next.config.*
- unrelated orchestration rules
- settlement unrelated routes

[IMPLEMENTATION ORDER]
1. 현재 credit/account-selection 연결 지점 확인
2. 연결용 새 hook 설계
3. 연결용 component 생성
4. CounterPageV2 wiring 최소 수정
5. dead code / unused import 정리
6. `npx tsc --noEmit`

[OUTPUT FORMAT]
최종 보고는 아래 형식만 사용한다.

1. FILES CHANGED
2. CREDIT-ACCOUNT LINK DESIGN DECISION
3. EXACT DIFF SUMMARY
4. WHAT WAS ADDED
5. WHAT REMAINS IN CounterPageV2
6. VALIDATION RESULT (`npx tsc --noEmit`)
7. STEP-007 COMPLETE 여부

[STOP CONDITIONS]
다음 상황이면 구현 중단 후 그대로 보고:
- 기존 코드상 credit와 account를 연결할 데이터 소스가 없어 추측 구현이 필요한 경우
- 범위를 넘는 DB/API 변경이 필요한 경우
- 타입 또는 연결 지점이 불명확한 경우

이 경우 억지 구현하지 말고
"구현 중단 + 필요한 선행 조건"만 보고한다.