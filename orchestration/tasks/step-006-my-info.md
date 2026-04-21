[ROUND]
STEP-006

[TASK TYPE]
my-info design and controlled implementation

[OBJECTIVE]
개인 영역(내정보)을 설계/구현한다.

이번 단계의 목표:
- 내 계좌 관리 기능을 추가한다
- 내 매출 요약 조회 기능을 추가한다
- Counter 구조를 오염시키지 않는다
- 개인 기능은 독립 메뉴/페이지/모듈로 분리한다

중요:
이번 라운드는 "내정보 구조"를 만드는 단계다.
CounterPageV2에 기능을 밀어넣는 단계가 아니다.

[CONSTRAINTS]
1. CounterPageV2 수정 금지, 단 연결이 절대적으로 필요한 최소 wiring 외에는 건드리지 않는다
2. 개인 기능은 counter page 내부에 직접 구현하지 않는다
3. UI는 components로 분리한다
4. 로직은 hooks로 분리한다
5. 계좌관리와 매출조회는 membership/self scope 기준으로만 다룬다
6. 기존 checkout/interim/credit/account-selection 흐름을 깨면 안 된다
7. 추측 금지. 현재 코드 구조와 기존 API/타입 기준으로만 작업한다

[DESIGN RULES]
1. 내정보는 독립 개인 영역이다
2. CounterPageV2에 page-level state를 추가하지 않는다
3. 계좌 목록/등록/삭제/기본설정 로직은 별도 hook이 소유한다
4. 매출 요약 조회 로직은 별도 hook이 소유한다
5. component는 UI만 담당한다
6. component 내부에 직접 fetch/mutation 넣지 않는다
7. 기존 GET /api/me/bank-accounts 같은 self-scope API가 있으면 재사용을 우선 검토한다

[SCOPE]
이번 라운드 허용 범위:
- 내정보 진입 페이지/섹션 생성
- 계좌관리 hook/component 생성
- 매출 요약 hook/component 생성
- 필요한 타입/props 정리
- 최소 범위 wiring
- tsc 검증

범위 밖:
- 송금 완료 처리
- 정산 확정 처리
- 전 store 집계
- unrelated UI redesign
- counter core behavior 변경

[RECOMMENDED TARGET SHAPE]
가능한 목표 구조 예시:

- `app/me/page.tsx` 또는 기존 구조에 맞는 self area page
- `app/me/components/MyAccountList.tsx`
- `app/me/components/MyAccountModal.tsx`
- `app/me/components/MySalesSummaryCard.tsx`
- `app/me/hooks/useMyAccounts.ts`
- `app/me/hooks/useMySalesSummary.ts`

핵심:
- 계좌관리와 매출조회는 분리
- page는 조립만 담당
- hook은 self-scope 데이터 소유
- component는 렌더/입력만 담당

[FAIL IF]
다음 중 하나라도 발생하면 실패다.

1. CounterPageV2에 내정보 비즈니스 로직 추가
2. component 내부에 직접 API fetch/mutation 추가
3. 계좌관리와 매출조회 로직이 page에 직접 들어감
4. 기존 counter 흐름 손상
5. tsc --noEmit 실패
6. self-scope가 아닌 room/store/session 흐름과 무리하게 결합

[COMPLETE IF]
다음을 모두 만족하면 완료다.

1. 내정보 진입 페이지/영역 존재
2. 계좌관리 상태/로직이 hook으로 분리됨
3. 매출조회 상태/로직이 hook으로 분리됨
4. 계좌관리 UI가 component로 분리됨
5. 매출조회 UI가 component로 분리됨
6. 기존 counter 흐름 유지
7. `npx tsc --noEmit` 통과

[ALLOWED_FILES]
- `app/me/page.tsx`
- `app/me/hooks/useMyAccounts.ts`
- `app/me/hooks/useMySalesSummary.ts`
- `app/me/components/MyAccountList.tsx`
- `app/me/components/MyAccountModal.tsx`
- `app/me/components/MySalesSummaryCard.tsx`
- `app/counter/types.ts`
- `app/counter/helpers.ts`

주의:
실제 코드 구조상 필요한 최소 범위 안에서만 수정한다.
기존 self-scope 관련 코드가 있다면 재사용을 우선 검토한다.

[FORBIDDEN_FILES]
- `app/counter/CounterPageV2.tsx` (원칙상 수정 금지)
- settlement unrelated routes
- auth core files
- unrelated app pages
- package.json
- tsconfig.json
- next.config.*
- unrelated orchestration rules

[IMPLEMENTATION ORDER]
1. 현재 self-scope API / me 관련 구조 확인
2. 내정보 페이지 진입 구조 결정
3. useMyAccounts 생성
4. useMySalesSummary 생성
5. UI components 생성
6. page 조립
7. dead code / unused import 정리
8. `npx tsc --noEmit`

[OUTPUT FORMAT]
최종 보고는 아래 형식만 사용한다.

1. FILES CHANGED
2. MY-INFO DESIGN DECISION
3. EXACT DIFF SUMMARY
4. WHAT WAS ADDED
5. WHAT REMAINS OUTSIDE MY-INFO
6. VALIDATION RESULT (`npx tsc --noEmit`)
7. STEP-006 COMPLETE 여부

[STOP CONDITIONS]
다음 상황이면 구현 중단 후 그대로 보고:
- self-scope 계좌/매출 데이터 소스가 없어 추측 구현이 필요한 경우
- 기존 API 재사용 없이 범위를 넘는 DB/API 변경이 필요한 경우
- 개인 영역 진입 구조가 현재 코드베이스에 없어 안전한 생성 위치가 불명확한 경우
- 타입 또는 데이터 소스가 불명확한 경우

이 경우 억지 구현하지 말고
"구현 중단 + 필요한 선행 조건"만 보고한다.