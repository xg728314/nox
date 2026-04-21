[ROUND]
STEP-004

[TASK TYPE]
credit flow design and controlled implementation

[OBJECTIVE]
Counter 구조 분리 완료 상태를 유지한 채, room 기준 외상(credit) 흐름을 설계/구현한다.

외상 기능의 목적:
- checkout 또는 receipt 흐름에서 외상 금액을 기록할 수 있어야 한다
- 외상은 room/session/receipt 흐름과 연결되어야 한다
- 향후 미수 관리와 계좌 정산 기능으로 확장 가능해야 한다

중요:
이 라운드의 목표는 “외상 기능 추가”이지 “CounterPageV2에 임시 로직 추가”가 아니다.

[CONSTRAINTS]
1. CounterPageV2는 조립 컨테이너로 유지한다.
2. CounterPageV2에 credit 비즈니스 로직 직접 추가 금지
3. UI는 components로 분리한다.
4. 로직은 hooks로 분리한다.
5. 기존 checkout/interim 흐름을 깨면 안 된다.
6. 기존 tsc 통과 상태를 유지해야 한다.
7. 기존 receipt/interim 기능의 동작 변화는 허용되지 않는다.
8. 추측 금지. 현재 코드 구조와 타입 기준으로만 작업한다.

[DESIGN RULES]
1. 외상은 room 기준으로 기록되어야 한다.
2. 외상은 session/receipt와 연결 가능해야 한다.
3. 외상 입력은 checkout 흐름과 충돌하지 않아야 한다.
4. page에 raw mutation body를 추가하지 않는다.
5. 가능하면 기존 `useCheckoutFlow` 확장 여부를 먼저 검토한다.
6. `useCheckoutFlow` 책임이 과도해지면 `useCreditFlow`를 새로 만든다.
7. component는 입력 UI와 이벤트 전달만 담당한다.

[SCOPE]
이번 라운드에서 허용되는 작업 범위:
- credit 흐름 설계
- 필요한 hook/component 생성 또는 확장
- CounterPageV2 wiring 최소 수정
- 타입/props 정리
- tsc 검증

이번 라운드에서 범위 밖:
- 계좌 선택 기능
- 내정보 기능
- 전역 정산 리포트
- unrelated UI redesign
- 다른 도메인 기능 추가

[RECOMMENDED TARGET SHAPE]
가능한 목표 구조 예시:

- `useCheckoutFlow`
  - checkout/interim/receipt 관련 핵심 흐름 유지
- `useCreditFlow` (필요 시 신규)
  - credit amount
  - credit memo / method / payer metadata
  - create/update credit record
  - receipt 연결 후처리

- `CreditModal` 또는 `CreditSection`
  - 외상 입력 UI
  - 금액/메모/확정 액션
  - 상위 이벤트 전달

- `CounterPageV2`
  - hook 조립
  - modal open state 정도만 유지
  - render wiring만 수행

[FAIL IF]
다음 중 하나라도 발생하면 실패다.

1. CounterPageV2에 credit mutation body 직접 추가
2. CounterPageV2에 신규 business logic block 대량 추가
3. component 내부에서 직접 API fetch/mutation 작성
4. 기존 checkout/interim 흐름 손상
5. tsc --noEmit 실패
6. 책임 경계가 불명확한 상태로 로직이 page/component에 남음
7. 기존 hooks 책임이 설명 없이 붕괴함

[COMPLETE IF]
다음을 모두 만족하면 완료다.

1. 외상 입력 진입점이 존재
2. 외상 관련 상태/로직이 hook으로 분리됨
3. 외상 입력 UI가 component로 분리됨
4. CounterPageV2는 wiring만 수행
5. 기존 checkout/interim 동작 유지
6. 타입 정합성 유지
7. `npx tsc --noEmit` 통과

[ALLOWED_FILES]
- `app/counter/CounterPageV2.tsx`
- `app/counter/hooks/useCheckoutFlow.ts`
- `app/counter/hooks/useCreditFlow.ts`
- `app/counter/components/CreditModal.tsx`
- `app/counter/components/CreditSection.tsx`
- `app/counter/types.ts`
- `app/counter/helpers.ts`

주의:
실제 코드 구조상 필요한 최소 범위 안에서만 수정한다.
새 파일 생성 시 책임이 분명해야 한다.

[FORBIDDEN_FILES]
- settlement unrelated routes
- auth core files
- unrelated app pages
- package.json
- tsconfig.json
- next.config.*
- unrelated orchestration rules
- 기존 구조 분리 문서 자체의 의미를 깨는 광범위 파일

[IMPLEMENTATION ORDER]
1. 현재 checkout/receipt 흐름에서 외상 진입 위치 확인
2. 외상 책임을 `useCheckoutFlow` 확장으로 처리 가능한지 판단
3. 과도하면 `useCreditFlow` 신규 생성
4. 외상 UI component 생성
5. CounterPageV2 wiring 최소 수정
6. dead code / unused import 정리
7. `npx tsc --noEmit`

[OUTPUT FORMAT]
최종 보고는 아래 형식만 사용한다.

1. FILES CHANGED
2. CREDIT FLOW DESIGN DECISION
   - why `useCheckoutFlow` extension or why `useCreditFlow`
3. EXACT DIFF SUMMARY
4. WHAT WAS ADDED
5. WHAT REMAINS IN CounterPageV2
6. VALIDATION RESULT (`npx tsc --noEmit`)
7. STEP-004 COMPLETE 여부

[STOP CONDITIONS]
다음 상황이면 구현 중단 후 그대로 보고:
- 현재 코드상 credit 저장 구조가 없어 추측 구현이 필요한 경우
- 기존 receipt/checkout 흐름을 깨지 않고 연결할 수 없는 경우
- 타입 또는 데이터 소스가 불명확한 경우
- 범위를 넘는 DB/API 변경이 필요한 것이 확인된 경우

이 경우 억지 구현하지 말고
“구현 중단 + 필요한 선행 조건”만 보고한다.