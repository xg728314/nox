[ROUND]
STEP-005

[TASK TYPE]
account selection flow design and controlled implementation

[OBJECTIVE]
Counter 구조 분리 상태를 유지한 채, 실장 계좌 선택 흐름을 설계/구현한다.

목표:
- 계좌 선택 진입점이 있어야 한다
- 선택 가능한 계좌 목록을 표시할 수 있어야 한다
- 선택 결과를 상위 흐름(외상/receipt/정산)으로 전달 가능한 구조여야 한다
- CounterPageV2는 조립 컨테이너로 유지해야 한다

중요:
이번 라운드는 "계좌 선택 구조"를 만드는 단계다.
실제 송금 완료 처리, 정산 완료 처리, 지급 확정까지 한 번에 넣지 않는다.

[CONSTRAINTS]
1. CounterPageV2에 account-selection 비즈니스 로직 직접 추가 금지
2. UI는 components로 분리한다
3. 로직은 hooks로 분리한다
4. 기존 checkout/interim/credit 흐름을 깨면 안 된다
5. 기존 tsc 통과 상태를 유지해야 한다
6. 추측 금지. 현재 코드 구조와 타입 기준으로만 작업한다

[DESIGN RULES]
1. 계좌 선택은 독립 흐름으로 본다
2. useCreditFlow에 무리하게 합치지 않는다
3. 책임이 분명한 새 hook을 우선 검토한다
4. component는 계좌 목록 표시 / 선택 / 닫기 / 확인 이벤트 전달만 담당한다
5. API fetch/mutation은 component 내부에 넣지 않는다
6. page는 wiring만 수행한다

[SCOPE]
이번 라운드 허용 범위:
- account selection hook 생성
- account selection modal/component 생성
- CounterPageV2 wiring 최소 수정
- 타입/props 정리
- tsc 검증

범위 밖:
- 실제 송금 처리
- 지급 완료 처리
- 외상 상환 완료 처리
- 내정보 전체 구현
- unrelated UI redesign

[RECOMMENDED TARGET SHAPE]
가능한 목표 구조 예시:

- `useAccountSelectionFlow.ts`
  - open/close
  - selected account state
  - account list fetch
  - confirm selection
  - 상위 콜백 전달

- `AccountSelectModal.tsx`
  - 계좌 목록 표시
  - 선택 UI
  - 닫기 / 확인 버튼
  - 순수 UI

- 필요 시:
  - `AccountSelectTrigger.tsx`
  - `SelectedAccountCard.tsx`

- `CounterPageV2`
  - hook 조립
  - prop wiring만 수행

[FAIL IF]
다음 중 하나라도 발생하면 실패다.

1. CounterPageV2에 account selection mutation/fetch body 직접 추가
2. component 내부에 직접 API fetch/mutation 추가
3. useCreditFlow 내부에 계좌 선택 책임을 무리하게 합침
4. 기존 checkout/interim/credit 흐름 손상
5. tsc --noEmit 실패
6. 책임 경계 불명확

[COMPLETE IF]
다음을 모두 만족하면 완료다.

1. 계좌 선택 진입점 존재
2. 계좌 목록/선택 상태가 hook으로 분리됨
3. 계좌 선택 UI가 component로 분리됨
4. CounterPageV2는 wiring만 수행
5. 기존 checkout/interim/credit 동작 유지
6. 타입 정합성 유지
7. `npx tsc --noEmit` 통과

[ALLOWED_FILES]
- `app/counter/CounterPageV2.tsx`
- `app/counter/hooks/useAccountSelectionFlow.ts`
- `app/counter/components/AccountSelectModal.tsx`
- `app/counter/components/AccountSelectTrigger.tsx`
- `app/counter/components/SelectedAccountCard.tsx`
- `app/counter/types.ts`
- `app/counter/helpers.ts`

주의:
실제 구조상 필요한 최소 범위 안에서만 수정한다.

[FORBIDDEN_FILES]
- settlement unrelated routes
- auth core files
- unrelated app pages
- package.json
- tsconfig.json
- next.config.*
- unrelated orchestration rules

[IMPLEMENTATION ORDER]
1. 현재 credit / receipt / payout 연결 지점 확인
2. 새 hook 필요 여부 판단
3. account selection hook 생성
4. modal/component 생성
5. CounterPageV2 wiring 최소 수정
6. dead code / unused import 정리
7. `npx tsc --noEmit`

[OUTPUT FORMAT]
최종 보고는 아래 형식만 사용한다.

1. FILES CHANGED
2. ACCOUNT SELECTION DESIGN DECISION
3. EXACT DIFF SUMMARY
4. WHAT WAS ADDED
5. WHAT REMAINS IN CounterPageV2
6. VALIDATION RESULT (`npx tsc --noEmit`)
7. STEP-005 COMPLETE 여부

[STOP CONDITIONS]
다음 상황이면 구현 중단 후 그대로 보고:
- 현재 코드상 계좌 데이터 소스가 없어 추측 구현이 필요한 경우
- 기존 흐름을 깨지 않고 연결할 수 없는 경우
- 타입 또는 데이터 소스가 불명확한 경우
- 범위를 넘는 DB/API 변경이 필요한 것이 확인된 경우

이 경우 억지 구현하지 말고
"구현 중단 + 필요한 선행 조건"만 보고한다.