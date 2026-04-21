# NOX_SETTLEMENT_VISIBILITY_RULES (LOCKED)

## 1. Purpose

역할별 정산(settlement) 데이터 가시성 범위를 정의한다.
이 문서는 NOX_ROLE_ACCESS_AND_SHELL_VISIBILITY_RULES의 하위 계약이다.
상위 문서와 충돌 시 상위 문서가 우선한다.

이 문서는 정산 계산 로직, 정산 공식, 정산 엔진 동작을 정의하지 않는다.
오직 "누가 무엇을 볼 수 있는가"만 정의한다.

---

## 2. Scope

이 문서가 정의하는 범위:
- owner → settlement 가시성
- manager → settlement 가시성
- hostess → settlement 가시성
- 기본 숨김 정책
- 요약(summary) vs 상세(detail) 허용 범위

이 문서가 정의하지 않는 범위:
- 정산 계산 공식 (customer_payment - hostess_payout - manager_share = owner_profit)
- 정산 엔진 실행 순서
- 정산 확정/취소 로직
- BLE / session 연동

---

## 3. Role settlement visibility rules

### 3.1 owner → settlement

| 항목 | 가시성 | 형태 |
|------|--------|------|
| store 전체 정산 목록 | 보임 | detail |
| 개별 session 정산 상세 | 보임 | detail |
| customer_payment | 보임 | detail |
| hostess_payout (전체) | 보임 | detail |
| manager_share (전체) | 보임 | detail |
| owner_profit | 보임 | detail |
| manager별 정산 분배 내역 | 보임 | detail |
| hostess별 정산 내역 | 보임 | detail |

- owner는 같은 store_uuid 내 모든 정산 데이터를 상세 수준으로 볼 수 있다.

### 3.2 manager → settlement

| 항목 | 가시성 | 형태 |
|------|--------|------|
| 본인 manager_share | 보임 | detail |
| 본인 라인 매출 합계 | 보임 | summary |
| 배정된 hostess별 정산 | 보임 | summary |
| 비배정 hostess 정산 | 숨김 | - |
| store 전체 정산 | 숨김 | - |
| customer_payment 원본 | 숨김 | - |
| owner_profit | 숨김 | - |
| 다른 manager의 정산 | 숨김 | - |

- manager는 본인 분배분과 배정된 hostess 범위의 요약만 볼 수 있다.
- 비배정 hostess, 다른 manager, store 전체 정산은 노출되지 않는다.

### 3.3 hostess → settlement

| 항목 | 가시성 | 형태 |
|------|--------|------|
| 본인 hostess_payout | 보임 | detail |
| 본인 참여 session 정산 상태 | 보임 | summary |
| 다른 hostess 정산 | 숨김 | - |
| manager_share | 숨김 | - |
| owner_profit | 숨김 | - |
| customer_payment 원본 | 숨김 | - |
| store 전체 정산 | 숨김 | - |

- hostess는 본인 payout과 본인 참여 session의 정산 상태만 볼 수 있다.
- 금액 상세는 본인 payout만 허용된다.

---

## 4. Default hidden policy

- 정산 데이터는 기본적으로 숨김이다.
- 명시적으로 "보임"으로 정의된 항목만 노출된다.
- 숨김 항목은 UI와 API 모두에서 차단된다.
- 존재 자체가 노출되지 않아야 한다 (빈 값이 아니라 필드 자체를 반환하지 않음).

---

## 5. Summary vs detail policy

| 형태 | 정의 |
|------|------|
| detail | 개별 건별 금액, 항목, 날짜 등 원본 수준 데이터 |
| summary | 합계, 건수, 상태 등 집계 수준 데이터만 |

- owner: detail 허용.
- manager: 본인 분배분은 detail. 배정 hostess 정산은 summary만.
- hostess: 본인 payout은 detail. 참여 session 정산은 summary만.
- summary가 허용된 항목에서 detail 노출은 금지된다.

---

## 6. Owner override policy

- owner는 store_uuid 범위 내 모든 정산 데이터를 볼 수 있다.
- 이것은 override가 아니라 owner role의 기본 권한이다.
- owner의 정산 가시성에 배정 조건은 적용되지 않는다.
- owner는 manager별, hostess별 정산을 개별적으로 조회할 수 있다.

---

## 7. Forbidden patterns

| # | 금지 패턴 | 이유 |
|---|---------|------|
| 1 | manager가 store 전체 정산을 조회 | manager는 본인 범위만 허용 |
| 2 | manager가 비배정 hostess 정산을 조회 | 배정 범위만 허용 |
| 3 | manager가 다른 manager 정산을 조회 | 본인 분배분만 허용 |
| 4 | manager가 owner_profit을 조회 | owner 전용 데이터 |
| 5 | manager가 customer_payment 원본을 조회 | owner 전용 데이터 |
| 6 | hostess가 다른 hostess 정산을 조회 | 본인만 허용 |
| 7 | hostess가 manager_share를 조회 | manager/owner 전용 데이터 |
| 8 | hostess가 owner_profit을 조회 | owner 전용 데이터 |
| 9 | UI에서 숨기고 API는 열어둠 | 숨김 = UI + API 동시 차단 |
| 10 | summary 허용 항목에서 detail 반환 | summary/detail 구분은 계약 |

---

## 8. Implementation status (3-layer)

구현 확장 순서: self → assigned → store

| Layer | Role | Route | Scope | Status |
|-------|------|-------|-------|--------|
| 1. Self | hostess | GET /api/me/settlement-status | 본인만 | 구현 완료 |
| 2. Assigned | manager | GET /api/manager/settlement/summary | 배정 hostess만 | 구현 완료 |
| 3. Store | owner | GET /api/store/settlement/overview | same-store 전체 hostess | 구현 완료 |

모든 layer의 출력은 summary only: `{ has_settlement, status }`.
payout amount, price, calculation, settlement detail은 어떤 layer에서도 노출되지 않는다.

---

## 9. Locked summary

| 항목 | owner | manager | hostess |
|------|-------|---------|---------|
| store 전체 정산 | detail | 숨김 | 숨김 |
| session별 정산 상세 | detail | 숨김 | 숨김 |
| customer_payment | detail | 숨김 | 숨김 |
| owner_profit | detail | 숨김 | 숨김 |
| manager_share (전체) | detail | 숨김 | 숨김 |
| 본인 manager_share | - | detail | 숨김 |
| 본인 라인 매출 | - | summary | 숨김 |
| 배정 hostess 정산 | detail | summary | 숨김 |
| 비배정 hostess 정산 | detail | 숨김 | 숨김 |
| hostess_payout (전체) | detail | 숨김 | 숨김 |
| 본인 hostess_payout | - | - | detail |
| 본인 session 정산 상태 | - | - | summary |
| 기본 가시성 | 전체 | 본인+배정 | 본인만 |
| UI hidden = API blocked | 필수 | 필수 | 필수 |
