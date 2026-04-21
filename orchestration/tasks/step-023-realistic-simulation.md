# STEP-023 — REALISTIC OPERATION SIMULATION

## OBJECTIVE

현재 NOX 시스템은 다음 상태까지 완료되어 있다:

- 로그인 + 승인 구조 정상
- MFA 로그인 흐름 연결 완료 :contentReference[oaicite:0]{index=0}
- reauth 흐름 최소 연결 완료 :contentReference[oaicite:1]{index=1}

이제 목표는:

👉 실제 운영과 동일한 수준의 데이터/행동 시뮬레이션을 생성하고  
👉 현재 구현된 모든 기능이 정상 동작하는지 검증하는 것이다

이 작업은 단순 seed가 아니라:

- 실장 / 아가씨 / 손님 / 세션 / 주문 / 채팅 / 정산
- 동일가게 + 타가게 교차 참여
- 최종적으로 **정산값이 맞는지 검증**

까지 포함하는 **실전 시뮬레이션 라운드**다.

---

## LOCKED INPUT (절대 변경 금지)

### 매장 구성

- Marvel: 4 rooms
- Burning: 6 rooms
- Hwangjini: 6 rooms
- Live: 6 rooms

---

### 룸 운영 기준

- 각 룸 = 손님 수용 2세트
- 세션당 손님 수 = 5명

---

### 인력 구성 (매장별)

- 실장: 4명
- 아가씨: 30명

카테고리 분배:

- Public: 10명
- Hyper: 10명
- Shirt: 10명

---

### 운영 행동

- 손님:
  - 양주 4병
  - 3~5 타임 랜덤
  - 카테고리 랜덤 (public/hyper/shirt)

- 아가씨:
  - 평균 8타임

---

### 교차 규칙

- 동일 가게 참여 존재
- 타 가게 참여 반드시 존재
- cross-store 정산 발생해야 함

---

### 채팅 시뮬레이션

반드시 포함:

- "퍼블릭 2인 초이스 있습니다"
- "네 갑니다"
- "2인 맞췄습니다"

---

### 랜덤

- 반드시 seed 기반 deterministic random
- 재현 가능해야 함

---

## CRITICAL RULES

1. NO GUESSING
2. 기존 코드/스키마 기반으로만 구현
3. 기존 settlement 로직 재사용 (추측 계산 금지)
4. 기존 chat 구조 재사용
5. 기존 seed/script가 있으면 우선 활용
6. 실제 운영 흐름 기반으로 생성
7. 전체 삭제 금지 → 안전 범위만 삭제
8. 시뮬레이션 데이터는 식별 가능해야 함

---

## PHASE 1 — CODE AUDIT (필수)

다음 구조를 실제 코드 기준으로 파악:

### AUTH
- user 생성 방식
- membership 생성 구조

### STORE / ROOM
- stores
- rooms
- sessions

### STAFF
- managers
- hostesses
- category 구조 존재 여부

### SESSION
- participant 구조
- customer 구조

### ORDER
- 양주 주문 구조
- 시간 계산 구조

### SETTLEMENT
- computeSessionShares.ts 존재 여부
- payout / cross-store route

### CHAT
- 메시지 저장 방식
- room 기반인지 여부

---

## PHASE 2 — SIMULATION DESIGN

### 1. 네임스페이스

모든 데이터에 prefix 사용:

- SIM_
- 또는 metadata flag

예:
- SIM_MARVEL
- SIM_HOSTESS_001

---

### 2. 랜덤

- fixed seed 사용
- Math.random 직접 사용 금지 (seedable 사용)

---

### 3. 데이터 생성

#### 매장

- Marvel
- Burning
- Hwangjini
- Live

#### 룸

- 정확한 개수 생성

#### 실장

- 매장당 4명

#### 아가씨

- 매장당 30명
- 카테고리 정확히 분배

---

### 4. 세션 생성

- 룸별 활성 세션 생성
- 손님 5명
- 랜덤 카테고리

---

### 5. 주문 생성

- 양주 4병
- 타임 3~5 랜덤

---

### 6. 교차 참여

반드시 포함:

- same-store 참여
- cross-store 참여

---

### 7. 채팅 생성

실제 chat API 또는 구조 사용

메시지 흐름 생성:

- 초이스 요청
- 응답
- 확정

---

### 8. 정산 검증

다음 검증 필수:

- store payable vs receivable
- cross-store 금액 일치
- 음수/불가능 상태 없는지

---

## PHASE 3 — IMPLEMENTATION

### 요구 사항

- script 형태로 구현
- 실행 가능해야 함
- 반복 실행 가능해야 함

---

## VALIDATION

### 필수

- npx tsc --noEmit
- npm run build

### 시뮬레이션 실행

- 실행 성공
- 결과 출력

---

## OUTPUT FORMAT

### 1. FILES CHANGED

### 2. AUDIT FINDINGS

### 3. SIMULATION DESIGN

### 4. GENERATED DATA SUMMARY

- stores
- rooms
- managers
- hostesses
- sessions
- chat events
- cross-store participation

### 5. SETTLEMENT VALIDATION

- payable
- receivable
- consistency 결과

### 6. EXECUTION COMMANDS

### 7. VALIDATION

### 8. KNOWN LIMITS

---

## FAIL CONDITIONS

1. schema 추측
2. settlement 로직 임의 구현
3. 기존 데이터 무단 삭제
4. 랜덤 재현 불가
5. cross-store 미구현
6. 채팅 미구현
7. 정산 검증 없음

---

## ONE-LINE SUMMARY

실제 운영과 동일한 수준의 데이터를 생성하고  
현재 NOX 시스템이 실제로 정상 작동하는지 검증하는 시뮬레이션을 구현하라.