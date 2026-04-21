# 🔒 NOX STRUCTURE SPLIT WORK ORDER (LOCKED)

---

# 0. PURPOSE

이 문서는 **현재 실운영 가능한 NOX 시스템을 기능 변경 없이 구조 분리**하기 위한 실행 지시서다.

목표는 하나다:

👉 **실행 중인 기능은 그대로 유지하면서, 고트래픽 병목 영역을 분리 가능한 구조로 재편한다.**

이번 작업은 **리팩터링 + 경계 분리**다.  
새 기능 추가 작업이 아니다.  
공식/정산/auth/business day 규칙 수정 작업이 아니다.

---

# 1. ABSOLUTE RULES

## 1.1 절대 원칙

- **기능 변경 금지**
- **정산 공식 변경 금지**
- **auth 구조 변경 금지**
- **System B 활성화 금지**
- **운영 API 계약 변경 금지** (응답 shape 임의 변경 금지)
- **추측 금지**
- **확인되지 않은 비즈니스 로직 추가 금지**

---

## 1.2 작업 방식

이번 단계는 아래 순서만 허용한다.

1. **구조 inventory 작성**
2. **경계(boundary) 정의**
3. **공통 로직 추출**
4. **route thin-controller화**
5. **검증**
6. **다음 분리 단계 진입**

병렬 대수술 금지.  
한 번에 전 영역 재작성 금지.  
**작게 분리 → 검증 → 다음 단계**만 허용.

---

## 1.3 변경 허용 범위

허용:

- route 내부 로직을 service / domain / helper 로 추출
- 중복 validation 제거
- audit write helper 추출
- store scope guard 공통화
- transaction block 정리
- 타입 분리
- naming 정리
- 파일 분리

금지:

- DB schema 임의 변경
- settlement 공식 수정
- legacy data 강제 overwrite
- UI 동작 변경
- API URL 변경
- 권한 정책 의미 변경
- dormant 경로 연결

---

# 2. CURRENT GROUND TRUTH

## 2.1 LIVE SYSTEM

실운영 기준 시스템:

- `app/api/sessions/settlement/route.ts`
- `app/api/sessions/settlement/finalize/route.ts`

이 경로가 실제 settlement truth다.

---

## 2.2 DORMANT SYSTEM

절대 연결 금지:

- `lib/settlement/computeSessionShares.ts`
- `/api/sessions/[session_id]/settlement/*`

상태:

- 보존만
- 참조 금지
- 활성화 금지
- import 연결 금지

---

## 2.3 핵심 구조 병목

우선순위 기준 병목:

1. `app/api/sessions/`
2. `app/api/chat/`
3. `app/api/cross-store/`
4. `app/api/sessions/orders/route.ts`

---

# 3. TARGET ARCHITECTURE

목표는 “기능 중심 route”가 아니라  
**경계가 분리된 구조**다.

---

## 3.1 목표 경계

### A. Session Domain
책임:
- room/session 상태
- participant 연결
- session lifecycle
- checkout 전 상태 관리

포함:
- session lookup
- participant attach/detach
- room-session relation
- runtime state transitions

제외:
- settlement 계산
- chat fan-out
- BLE ingest
- inventory 계산

---

### B. Settlement Domain
책임:
- settlement calculation
- finalize read/lock
- snapshot write
- pre_settlement handling
- negative remainder guard
- formula enforcement

포함:
- receipts write/update
- receipt snapshot versioning
- settlement validation
- finalized write guard

제외:
- room state 직접 변경
- chat 메시지 처리
- BLE 이벤트 처리

---

### C. Order / Inventory Domain
책임:
- 주문 생성/삭제/수정
- 가격 검증
- 수량/품목 처리
- 재고 연동 준비 구조
- order audit

포함:
- price guard
- item normalization
- order total composition

제외:
- session settlement 공식 처리
- chat
- BLE

---

### D. Chat Domain
책임:
- message path
- participant visibility
- room/store scope
- unread/counter/fan-out
- room list persistence

포함:
- group / 1:1 분리
- membership validation
- room membership state

제외:
- session settlement
- inventory
- BLE

---

### E. BLE Domain
책임:
- ingest
- dedupe
- windowing
- tag/gateway normalization
- room assignment signal processing

제외:
- settlement
- chat
- order

---

### F. Cross-store Domain
책임:
- store-level obligation
- pre-settlement partial deduction
- manager/store payout state machine
- ledger status transitions

제외:
- local room operation
- chat
- BLE

---

# 4. REQUIRED DIRECTORY DIRECTION

아직 실제 경로는 코드베이스 상태를 보고 안전하게 맞춰라.  
단, 최종 방향은 아래 구조를 따른다.

```txt
lib/
  session/
    services/
    validators/
    queries/
    types.ts
  settlement/
    services/
    validators/
    queries/
    audit/
    types.ts
  orders/
    services/
    validators/
    pricing/
    audit/
    types.ts
  chat/
    services/
    validators/
    queries/
    types.ts
  ble/
    services/
    dedupe/
    validators/
    types.ts
  cross-store/
    services/
    state-machine/
    validators/
    queries/
    types.ts