# STEP-026 — REALISTIC SIMULATION EXECUTION / VALIDATION

## OBJECTIVE

현재 NOX는 다음이 준비된 상태다:

- signup → pending → approval → login 흐름 동작
- MFA 로그인 분기 연결
- reauth 최소 연결
- realistic simulation script 초안 또는 실행 후보 존재
- 5층 매장 운영 시뮬레이션 방향 확정

이번 라운드의 목적은
**실제 시뮬레이션을 실행하고, 결과를 운영/정산 기준으로 검증하는 것**이다.

이 라운드는 설계가 아니라 실행/검증이다.

즉:

- simulation runner 실제 실행
- 생성 데이터 수량 검증
- same-store / cross-store 참여 검증
- 채팅 생성 검증
- 정산 / payable / receivable 대칭성 검증
- cleanup 경로 확인

---

## LOCKED SIMULATION TARGET

반드시 이 기준을 충족해야 한다.

### 매장

- Marvel
- Burning
- Hwangjini
- Live

### 룸 수

- Marvel: 4
- Burning: 6
- Hwangjini: 6
- Live: 6

### 인력

매장별:

- managers: 4
- hostesses: 30
  - Public: 10
  - Hyper: 10
  - Shirt: 10

### 세션/손님/주문

- 룸당 활성 세션 생성
- 세션당 손님 5명
- 양주 4병
- 3~5 타임 랜덤
- 카테고리 랜덤

### 교차

- same-store 참여 존재
- cross-store 참여 존재
- cross-store payable / receivable 검증 가능해야 함

### 채팅

실제 또는 실제 구조 기반 chat event 생성:

- "퍼블릭 2인 초이스 있습니다"
- "네 갑니다"
- "2인 맞췄습니다"

### 랜덤

- deterministic seed 사용
- 재실행 시 재현 가능

---

## REQUIRED AUDIT BEFORE EXECUTION

실행 전 반드시 확인할 것:

1. simulation runner 파일 위치
2. 실행 명령
3. `--cleanup` 지원 여부
4. `--report` 지원 여부
5. live Supabase project를 쓰는지 여부
6. namespace / prefix 분리 여부
   - 예: `sim-floor5-`
   - 예: `[SIM5]`

---

## PRIMARY EXECUTION TASKS

### TASK 1 — simulation 실행

실제 runner를 실행할 것.

예상 예:
- `npx tsx scripts/sim-floor5.ts`
또는 실제 코드 기준 명령

실행 후 보고할 것:
- 실행 성공/실패
- 에러 여부
- 생성된 데이터 수량

---

### TASK 2 — generated data summary 검증

최소 검증 대상:

- stores created/found
- rooms
- managers
- hostesses
- sessions
- orders
- participants
- chat events

실제 결과를 수치로 보고할 것.

---

### TASK 3 — cross-store participation 검증

반드시 확인:

- same-store participants 수
- cross-store participants 수
- cross-store 비율이 실제로 0이 아닌지
- origin_store_uuid 등 실제 필드 기준으로 검증

---

### TASK 4 — settlement / payable / receivable 검증

반드시 실제 결과를 보고할 것:

- 매장별 payable
- 매장별 receivable
- cross-store pair별 합계
- 대칭성(reconciliation) 통과 여부

예:
- A store payable to B == B receivable from A

주의:
- 기존 settlement logic / helper / script report를 재사용할 것
- 임의 계산 금지

---

### TASK 5 — chat 검증

반드시 확인:

- chat row/event 실제 생성
- store/global/room 어떤 구조를 썼는지
- 최소 메시지 수
- 예시 문구가 실제 저장되었는지

---

### TASK 6 — cleanup 경로 확인

반드시 확인:

- cleanup command 존재 여부
- cleanup가 어떤 범위를 되돌리는지
- simulation namespace만 건드리는지

실행 자체는 선택 가능하지만,
최소한 cleanup 명령과 범위를 보고할 것.

---

## ALLOWED CHANGES

이번 라운드는 기본적으로 실행/검증 라운드다.

허용:
- 실행 중 드러난 **명백한 simulation script 버그의 최소 수정**
- 실행 불가를 막는 작은 수정

비허용:
- simulation 전체 재설계
- settlement 비즈니스 로직 변경
- signup/auth unrelated 변경
- schema 변경
- migration 추가
- printer-server 변경

원칙:
- 우선 실행
- 문제 있으면 최소 수정
- 수정했으면 반드시 명시

---

## VALIDATION REQUIREMENTS

반드시 수행:

1. `npx tsc --noEmit`
2. `npm run build`
3. simulation runner 실행
4. summary/report 확인

가능하면 추가:
5. `--report` 실행
6. `--cleanup` dry understanding 또는 실제 cleanup 확인

---

## FAIL CONDITIONS

아래 중 하나라도 해당하면 FAIL:

1. simulation 실행 자체 실패
2. 매장/룸/인력 수량이 locked target과 다름
3. cross-store 참여가 0
4. chat 생성이 없음
5. payable / receivable 대칭 검증 누락
6. namespace 분리 없음
7. cleanup 경로 불명확
8. build 실패
9. type error 발생

---

## OUTPUT FORMAT

### 1. FILES CHANGED
- 정확한 경로
- 없으면 "none"

### 2. EXECUTION COMMAND
- 실제 실행한 명령

### 3. EXECUTION RESULT
- success / fail
- 에러 요약

### 4. GENERATED DATA SUMMARY
- stores
- rooms
- managers
- hostesses by category
- sessions
- orders
- participants
- chat events

### 5. CROSS-STORE VALIDATION
- same-store count
- cross-store count
- ratio / presence
- 어떤 필드 기준으로 검증했는지

### 6. SETTLEMENT / RECONCILIATION
- payable / receivable summary
- pairwise symmetry result
- mismatch 여부

### 7. CLEANUP PATH
- cleanup command
- scope 설명

### 8. VALIDATION
- tsc
- build
- simulation execution
- report/cleanup 확인

### 9. FINAL STATUS
- PASS / FAIL
- 한 줄 결론

---

## ONE-LINE SUMMARY

NOX 5층 realistic simulation을 실제로 실행하고,
생성 데이터 / cross-store 참여 / 채팅 / 정산 대칭성을 검증하여
운영 가능한 수준인지 판단하라.