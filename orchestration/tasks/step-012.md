[ROUND]
STEP-012

[TASK TYPE]
locked UI implementation task

[OBJECTIVE]
STEP-011D, STEP-011E, STEP-011F까지 완료되었고,
정산/지급/교차정산의 서버 구조와 무결성 및 legacy 제거까지 끝난 상태다.

이번 단계의 목표는 실제 운영자가 사용할 수 있는 정산 UI를 구현하는 것이다.

핵심 목표:
1. 실장 정산 화면 구현
2. 아가씨 지급 상태 확인 화면 구현
3. 교차정산 화면 구현
4. 지급 실행 UI 연결
5. 기존 서버 구조를 그대로 사용하는 thin UI 구성

[LOCKED RULES]
- 계산 로직 UI에 넣지 말 것
- computeSessionShares 수정 금지
- settlement core behavior 수정 금지
- payout / cross-store 서버 로직 수정 최소화
- UI는 서버가 내려주는 값만 표시/전송
- 금액 재계산 금지
- store_uuid scope 규칙 유지
- resolveAuthContext 기반 서버 구조 존중
- 기존 Counter / Chat / My Info 동작에 영향 주지 말 것

[UI TARGETS]

1. Settlement Overview Screen
목적:
- 정산 상태를 한눈에 보는 운영 화면

필수 표시:
- confirmed / paid 상태 구분
- 실장별 미지급 총액
- 아가씨별 미지급 총액
- 최근 지급 내역
- 교차정산 진행 상태

주의:
- summary 화면일 뿐 계산 금지
- 서버 데이터 aggregation 결과만 사용

2. Manager Settlement Screen
목적:
- 실장 기준 정산/지급 관리

필수 표시:
- 실장 목록
- 각 실장의 총 지급 대상 금액
- 담당 아가씨별 금액 breakdown
- 지급완료 / 미지급 / 부분지급 상태
- 지급 버튼
- 지급 내역 보기

필수 동작:
- settlement payout API 호출 가능
- partial / full / prepayment 선택 가능하면 연결
- amount 입력은 허용하되 server validation 전제
- 지급 성공 후 목록 새로고침

3. Hostess Settlement Screen
목적:
- 아가씨별 지급 상태 확인

필수 표시:
- 아가씨 이름
- 총 정산 금액
- 지급 완료 금액
- 남은 금액
- 최근 지급 내역
- 상태 badge (confirmed / paid / partial)

주의:
- UI 계산 최소화
- 화면 표시는 API 응답 기반
- 지급 버튼은 역할/권한 구조에 맞게 노출

4. Cross-Store Settlement Screen
목적:
- 가게 간 정산 현황 및 지급 처리

필수 표시:
- from_store / to_store
- total_amount
- remaining_amount
- status (open / partial / completed)
- manager breakdown
- partial 지급 실행 UI

필수 동작:
- cross-store 생성 폼
- manager item amount 입력
- 총액과 item 합 표시
- 지급 실행 버튼
- 지급 후 상태 갱신

주의:
- sum 검증은 서버가 최종 책임
- UI는 보조 표시만
- legacy 경로 사용 금지
- 신규 canonical routes만 사용

[DATA ACCESS RULES]
- 기존 canonical routes / RPC 경로만 사용
- legacy route 호출 금지
- 임시 mock 데이터 금지
- hardcoded settlement 금지
- 권한 없는 버튼/액션 숨김
- soft deleted 데이터 표시 금지

[EXPECTED ROUTE USAGE]
- POST /api/settlement/payout
- GET /api/settlement/payouts
- POST /api/cross-store
- POST /api/cross-store/payout

필요 시 이번 단계에서 아래 조회 route를 추가할 수 있다.
단, 반드시 신규 canonical schema 기준이어야 한다:
- GET /api/cross-store
- GET /api/cross-store/[id]
- GET /api/settlements/overview
- GET /api/settlements/managers
- GET /api/settlements/hostesses

[REQUIRED CHANGES]

A. UI Pages / Components
현재 프로젝트 구조를 먼저 확인하고, 기존 패턴을 따라 구현한다.
가능한 경우:
- owner/counter shell 안에 settlement 페이지 추가
- manager shell 안에 manager settlement page 추가
- hostess shell 안에 self settlement status page 추가

B. Query / Fetch layer
- 기존 fetch/util 패턴 재사용
- role 기반 분기
- 로딩/에러/빈 상태 처리

C. Forms
- 지급 amount 입력
- payout_type 선택
- cross-store item 입력
- 잘못된 입력은 프론트에서도 1차 차단 가능
- 하지만 최종 검증은 서버 책임

D. Status UI
- confirmed / partial / paid / open / completed 등 상태 badge 추가
- badge 일관성 유지
- 기존 디자인 시스템 있으면 재사용

E. Refresh behavior
- payout 성공 후 즉시 refetch
- 교차정산 생성 후 즉시 반영
- 중복 클릭 방지

[FILTER / SORT REQUIREMENTS]
가능하면 아래 포함:
- 상태별 필터
- 실장별 필터
- 아가씨 검색
- 최근순 정렬

단, 과도한 기능 확장 금지.
실사용에 필요한 최소 범위 우선.

[VALIDATION REQUIREMENTS]
반드시 확인:
1. UI에서 계산 로직 없음
2. legacy API 호출 없음
3. canonical route만 사용
4. payout 실행 가능
5. partial payout 실행 가능
6. cross-store 생성 가능
7. cross-store payout 가능
8. 로딩/에러 처리 존재
9. tsc --noEmit 통과
10. 가능하면 build 통과

[FAIL IF]
- UI에 계산식 들어감
- legacy route 호출
- mock 데이터 사용
- 권한 구조 무시
- 기존 Counter/Chat/My Info 깨짐
- settlement core 수정
- computeSessionShares 수정
- 의미 없는 디자인 과잉 작업
- 실사용 흐름보다 장식 우선

[OUTPUT FORMAT]
1. FILES CHANGED
2. UI ADDED
3. API USAGE
4. USER FLOW
5. VALIDATION
6. RISKS / FOLLOW-UPS