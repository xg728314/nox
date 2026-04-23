[ROUND-B]
TASK TYPE: 정산 안정성 테스트 구축
OBJECTIVE:
NOX 코드베이스의 정산/분배/라이프사이클 핵심 로직에 대해 unit test 를 구축한다.
이번 라운드는 기능 추가 금지, 로직 변경 최소화, 테스트 우선이다.
목표는 “돈 계산이 틀리지 않는지” 와 “상태 전이가 잘못 통과하지 않는지” 를 자동 검증 가능하게 만드는 것이다.

배경:
- 보안(scope) 라운드는 완료됨
- 현재 가장 큰 리스크는 테스트 0개 상태에서 돈 계산/정산/상태 전이가 수동 검산에 의존한다는 점
- 이번 라운드는 production 코드 구조를 크게 흔들지 말고, 테스트 가능한 최소 단위부터 고정한다

절대 규칙:
- 추측 금지
- 실제 코드 기준
- 기능 추가 금지
- UI 수정 금지
- schema 변경 금지
- migration 추가 금지
- 비즈니스 규칙 임의 변경 금지
- 테스트를 맞추기 위해 production 로직을 왜곡하지 말 것
- 꼭 필요한 경우에만 작은 pure helper 추출 허용
- 기존 route 응답 shape 변경 금지

우선순위 대상:
1) lib/settlement/** 또는 실제 정산 계산 함수 위치
2) staff_work_logs lifecycle gate 관련 pure logic
3) cross-store settlement 계산/분기 로직
4) session settlement / receipt 계산 관련 pure 계산부
5) 금액 합계, 차감, 분배, 상태 전이 조건

반드시 할 일:

A. 테스트 대상 식별
- 실제 production 코드에서 돈 계산 / 정산 분배 / lifecycle gate / cross-store 계산의 핵심 진입점 식별
- route 자체를 직접 때리기보다 pure function 또는 pure helper 기준으로 묶기
- 현재 pure 하지 않다면, 필요한 최소 범위만 분리
- 분리 시 로직 변경 없이 추출만 수행

B. 최소 테스트 세트 작성
총 목표: 최소 50개 테스트
테스트 묶음 예시:
1. 정산 계산 정상 케이스
2. 0원 / null / undefined / 빈 배열 경계값
3. 음수/잘못된 입력 방어
4. 반올림 / 절삭 / 합계 일관성
5. category/service type 별 금액 분기
6. 중복 적용 방지
7. lifecycle gate
   - confirm 가능/불가
   - void 가능/불가
   - dispute 가능/불가
   - resolve 가능/불가
8. cross-store 정산
   - from/to 규약 현재 코드 기준 검증
   - origin / working store 분기
   - assigned manager / hostess / store 귀속 일관성
9. receipt / session totals
   - 합계 = 세부항목 합
   - 할인/추가금/차감 반영
10. 회귀 테스트
   - 기존에 문서/이슈/감사에서 문제 되었던 drift 류 버그 재현 후 고정

C. 테스트 품질 규칙
- snapshot 테스트 위주 금지
- 계산식은 명시적 expected 값 비교
- 테스트 이름은 비즈니스 의미가 드러나게 작성
- fixture 는 과도하게 거대하게 만들지 말고 최소 입력 사용
- mock 남발 금지
- 가능한 pure function 직접 테스트
- flaky 테스트 금지

D. 검증
- 테스트 전부 실행
- tsc --noEmit
- npm run build
- 테스트 개수 보고
- 어떤 production 파일이 테스트로 커버되는지 명시

산출 형식:
1. FILES CHANGED
2. TEST TARGETS
   - 어떤 함수/모듈을 왜 테스트 대상으로 잡았는지
3. TEST MATRIX
   - 테스트 카테고리별 개수
4. REGRESSION CASES
   - 어떤 실제 버그/드리프트를 재현 가능한 테스트로 고정했는지
5. VALIDATION
   - test 결과
   - tsc 결과
   - build 결과
6. REMAINING RISKS
   - 아직 pure 하지 않아 다음 라운드 필요한 영역 최대 3개

FAIL IF:
- 테스트 수 50개 미만
- 테스트 없이 production 코드만 건드림
- route E2E 흉내만 내고 핵심 계산부 테스트 안 함
- expected 값이 불명확한 테스트
- 테스트 맞추려고 비즈니스 로직 바꿈
- 결과 보고서에 실제 커버 대상이 불명확

출력은 수정 완료 보고서만 제출.