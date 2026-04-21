# NOX_CURRENT_HANDOFF

Last updated: round-027

---

## SYSTEM STATE

- 시스템 수: 1
- Backend 구조: 통합 (역할 무관)
- Auth: resolveAuthContext.ts 구현 완료
- Role gate: owner / manager / hostess 3개 role 구현 완료
- Settlement visibility: 3-layer summary 구현 완료
- DB schema: 문서 정의 완료, migration 미실행
- UI shell: 미구현
- Mutation route: 미구현

---

## SETTLEMENT VISIBILITY MATRIX

구현 확장 순서: self → assigned → store

| Layer | Role | Route | Scope | Output |
|-------|------|-------|-------|--------|
| 1. Self | hostess | GET /api/me/settlement-status | 본인만 | { has_settlement, status } |
| 2. Assigned | manager | GET /api/manager/settlement/summary | 배정 hostess만 | summary[{ hostess_id, has_settlement, status }] |
| 3. Store | owner | GET /api/store/settlement/overview | same-store 전체 hostess | overview[{ hostess_id, has_settlement, status }] |

금지 항목 (모든 layer):
- payout amount
- price
- calculation
- settlement detail

---

## IMPLEMENTED ROUTES

### Auth
| Route | Role | Description |
|-------|------|-------------|
| GET /api/auth/me | all | Auth context 반환 |

### Owner (counter shell)
| Route | Role Gate | Description |
|-------|-----------|-------------|
| GET /api/store/profile | owner | Store profile 조회 |
| GET /api/rooms | owner | Room 목록 조회 |
| GET /api/rooms/[room_uuid] | owner | Room 상세 조회 |
| GET /api/rooms/[room_uuid]/participants | owner | Room participants 조회 |
| GET /api/store/settlement/overview | owner | 전체 hostess 정산 상태 요약 |

### Manager (manager shell)
| Route | Role Gate | Description |
|-------|-----------|-------------|
| GET /api/manager/dashboard | manager | Manager shell seed + assigned hostess preview |
| GET /api/manager/hostesses | manager | 배정 hostess 목록 |
| GET /api/manager/hostesses/[hostess_id] | manager | 배정 hostess 상세 |
| GET /api/manager/settlement/summary | manager | 배정 hostess 정산 상태 요약 |

### Hostess (me shell)
| Route | Role Gate | Description |
|-------|-----------|-------------|
| GET /api/me/dashboard | hostess | Hostess shell seed + active session 확인 |
| GET /api/me/sessions | hostess | 본인 세션 목록 |
| GET /api/me/sessions/[session_id] | hostess | 본인 세션 상세 |
| GET /api/me/settlement-status | hostess | 본인 정산 상태 |

---

## NOT IMPLEMENTED

| 항목 | 상태 |
|------|------|
| Payout math (customer_payment - hostess_payout - manager_share = owner_profit) | 미구현 |
| Settlement calculation engine | 미구현 |
| Settlement detail API (금액 포함) | 미구현 |
| Mutation routes (POST/PATCH/DELETE) | 미구현 |
| Session 생성/종료 API | 미구현 |
| Participant 추가/제거 API | 미구현 |
| Order 추가 API | 미구현 |
| Signup / Login API | 미구현 |
| Approval flow API | 미구현 |
| UI shell (counter / manager / hostess) | 미구현 |
| DB migration 실행 | 미실행 |
| BLE 연동 | 미구현 |
| Telegram 실제 연동 테스트 | 미실행 |

---

## NEXT STEP

다음 라운드에서 선택 가능한 방향:

1. **Mutation route 진입** — session 생성/종료, participant 추가/제거
2. **Settlement detail API** — payout math 포함 owner detail route
3. **Auth flow 완성** — signup, login, approval API
4. **DB migration** — Supabase schema 실행
5. **UI shell seed** — manager shell 첫 화면

권장 순서: auth flow 완성 → DB migration → mutation route → settlement detail → UI shell
