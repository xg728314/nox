# NOX_ROLE_ACCESS_AND_SHELL_VISIBILITY_RULES

## 1. 목적

역할별 shell 접근, 메뉴 노출, API 접근 범위를 단일 문서로 잠근다.
이 문서는 NOX_3_ROLE_PRODUCT_SEPARATION_RULES의 하위 계약이다.
상위 문서와 충돌 시 상위 문서가 우선한다.

핵심 원칙: 시스템은 1개. backend/domain/auth/membership/settlement는 공통.
역할에 따라 **보이는 범위만 다르다.**

---

## 2. 역할 정의

| 역할 | membership role | 설명 |
|------|----------------|------|
| counter | owner | 매장 전체 운영. room/session/order/settlement 전권 |
| manager | manager | 담당 hostess 관리. 본인 라인 정산/매출 확인 |
| hostess | hostess | 본인 세션/정산/상태 확인만 가능 |

- customer는 로그인 계정이 아니다. 이 문서의 대상이 아니다.
- owner role이 counter shell에 매핑된다.
- role은 store_memberships.role 기준이며 authContext에서 해석된다.

---

## 3. membership role → shell 매핑

| membership role | shell | 진입 경로 |
|----------------|-------|----------|
| owner | counter | /counter/* |
| manager | manager | /manager/* |
| hostess | hostess | /me/* |

- 1 role = 1 shell. 복수 shell 동시 접근 불가.
- shell 결정은 authContext.role 기준이다. 클라이언트 선택 불가.

---

## 4. 로그인 후 진입 규칙

1. 로그인 성공 → authContext 구성 (user_id, store_uuid, role, membership_status)
2. membership_status 확인:
   - approved → shell 진입 허용
   - pending → 대기 화면만 표시. shell 진입 불가.
   - rejected / suspended → 접근 차단.
3. role 기준으로 해당 shell로 라우팅:
   - owner → /counter/*
   - manager → /manager/*
   - hostess → /me/*
4. 다른 shell 경로 직접 접근 시 차단.

---

## 5. 메뉴 visibility matrix

| 메뉴 항목 | counter (owner) | manager | hostess |
|----------|:-:|:-:|:-:|
| room 목록 / 상태 | O | X | X |
| session 생성 / 종료 | O | X | X |
| session 참여자 추가/제거 | O | X | X |
| order 추가 | O | X | X |
| 전체 settlement 조회 | O | X | X |
| manager별 정산 분배 | O | X | X |
| store profile 조회 | O | X | X |
| 담당 hostess 목록 | X | O | X |
| 본인 라인 매출 조회 | X | O | X |
| 본인 정산 조회 (manager) | X | O | X |
| 본인 세션 이력 (hostess) | X | X | O |
| 본인 정산 조회 (hostess) | X | X | O |
| 본인 상태 확인 | X | X | O |

- O = 노출. X = 숨김.
- 숨김은 UI에서 메뉴를 제거하는 것이다.
- 숨김 항목의 API도 반드시 차단되어야 한다 (섹션 6 참조).

---

## 6. API access matrix

| API 범위 | counter (owner) | manager | hostess |
|---------|:-:|:-:|:-:|
| GET /api/rooms | O | X | X |
| GET /api/rooms/[room_uuid] | O | X | X |
| GET /api/rooms/[room_uuid]/participants | O | X | X |
| POST session 생성/종료 | O | X | X |
| POST participant 추가/제거 | O | X | X |
| POST order 추가 | O | X | X |
| GET store settlement 전체 | O | X | X |
| GET /api/store/profile | O | X | X |
| GET manager 본인 라인 정산 | X | O | X |
| GET manager 담당 hostess 목록 | X | O | X |
| GET manager 본인 정산 | X | O | X |
| GET hostess 본인 세션 | X | X | O |
| GET hostess 본인 정산 | X | X | O |
| GET hostess 본인 상태 | X | X | O |
| GET /api/auth/me | O | O | O |

- O = 허용. X = 차단 (403).
- **UI 숨김과 API 차단은 반드시 동시에 적용된다.**
- UI에서 숨기고 API를 열어두는 방식은 금지된다 (섹션 9 참조).

---

## 7. manager-first commercialization policy

1. 출시 순서: manager shell → hostess shell → counter shell.
2. manager shell 단독 출시 시:
   - manager shell UI + manager shell API만 활성화.
   - counter shell UI는 숨긴다.
   - counter shell API도 차단한다 (내부 테스트 제외).
   - hostess shell UI는 숨긴다.
   - hostess shell API도 차단한다.
3. backend/domain/auth/membership/settlement 구조는 처음부터 통합 상태로 존재한다.
4. manager shell 출시가 counter domain 구현을 면제하지 않는다.
   counter domain은 backend에 구현되어 있어야 하며 UI만 숨긴다.
5. settlement 계산 로직은 역할과 무관하게 단일 구조다.
   manager shell에서 보는 정산도 통합 settlement에서 파생된다.

---

## 8. hidden but existing features policy

1. counter shell UI가 숨겨져 있어도 counter domain은 backend에 존재한다.
2. counter domain API는 숨긴 기간 동안 외부 접근이 차단된다.
3. 내부 테스트/관리 목적 접근은 별도 정책으로 관리한다.
4. 숨긴 기능을 활성화할 때 backend 변경 없이 UI 노출 + API 차단 해제만으로 가능해야 한다.
5. 이를 위해 backend는 처음부터 모든 역할의 domain을 통합 구현한다.
6. "나중에 붙이기(bolt-on later)" 방식은 금지된다.

---

## 9. forbidden patterns

| # | 금지 패턴 | 이유 |
|---|---------|------|
| 1 | UI에서 숨기고 API는 열어둠 | 보안 우회. UI 숨김은 보안 제어가 아니다. |
| 2 | role별 별도 settlement 계산 로직 | 정산은 단일 구조. 역할은 뷰만 다르다. |
| 3 | role별 별도 DB 테이블 | DB는 하나. 역할별 테이블 분리 금지. |
| 4 | role별 별도 session 구조 | session 구조는 공통. 역할별 분기 금지. |
| 5 | 클라이언트가 shell을 선택 | shell은 authContext.role이 결정한다. |
| 6 | 복수 shell 동시 접근 | 1 role = 1 shell. |
| 7 | API에서 role 체크 없이 데이터 반환 | 모든 API는 authContext.role을 확인한다. |
| 8 | counter domain 구현 후순위 미루기 | backend domain은 출시 순서와 무관하게 통합 구현. |

---

## 10. locked summary

| 항목 | 기준 |
|------|------|
| 시스템 수 | 1 |
| shell 수 | 3 (counter, manager, hostess) |
| role → shell 매핑 | owner→counter, manager→manager, hostess→hostess |
| shell 결정 기준 | authContext.role |
| backend 구조 | 통합 (역할 무관) |
| settlement 구조 | 통합 (역할 무관) |
| 출시 순서 | manager → hostess → counter |
| UI 숨김 정책 | UI 숨김 시 API도 동시 차단 |
| domain 구현 정책 | 출시 순서와 무관하게 처음부터 통합 |
| hidden feature 활성화 | backend 변경 없이 UI + API 차단 해제만으로 가능 |
