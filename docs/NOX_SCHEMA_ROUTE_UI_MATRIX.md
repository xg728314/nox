# NOX DB-API-UI 매트릭스

> 생성일: 2026-04-11
> 근거: 실제 코드 파일 분석 (추측 없음)
> 소스: database/002_actual_schema.sql, app/api/**/route.ts, app/**/page.tsx

---

## 매트릭스 1: 테이블 사용 현황 (21개)

| # | 테이블 | API 참조 | 프론트 참조 | 상태 |
|---|--------|---------|-----------|------|
| 1 | profiles | ○ (FK join) | ✕ | active |
| 2 | stores | ○ | ✕ | active |
| 3 | store_memberships | ○ (전 API) | ✕ | active |
| 4 | store_settings | ○ | ✕ | active |
| 5 | store_operating_days | ○ | ✕ | active |
| 6 | rooms | ○ | ✕ | active |
| 7 | room_sessions | ○ | ✕ | active |
| 8 | managers | ○ | ✕ | active |
| 9 | hostesses | ○ | ✕ | active |
| 10 | transfer_requests | ○ | ✕ | active |
| 11 | session_participants | ○ | ✕ | active |
| 12 | participant_time_segments | ✕ | ✕ | **unused** |
| 13 | orders | ○ | ✕ | active |
| 14 | receipts | ○ | ✕ | active |
| 15 | receipt_snapshots | ○ | ✕ | active |
| 16 | closing_reports | ○ | ✕ | active |
| 17 | audit_events | ○ (write only) | ✕ | active |
| 18 | ble_gateways | ○ | ✕ | active |
| 19 | ble_tags | ○ | ✕ | active |
| 20 | ble_ingest_events | ○ (write only) | ✕ | active |
| 21 | ble_tag_presence | ○ (write only) | ✕ | active |

**요약:**
- active: 20개
- unused (코드 미참조): 1개 (`participant_time_segments`)
- 프론트에서 직접 DB 참조: 0개 (전부 API 경유)

---

## 매트릭스 2: API 라우트 → 테이블 매핑 (33개 라우트)

### 범례
- **R** = READ (.select / .single)
- **W** = WRITE (.insert / .update / .upsert)
- `sm` = store_memberships (resolveAuthContext에서 항상 READ)

### 2-1. 인증 (2개)

| API | 테이블 READ | 테이블 WRITE |
|-----|-----------|-------------|
| `POST /api/auth/login` | — (supabase.auth) | — |
| `GET /api/auth/me` | sm | — |

### 2-2. 룸 관리 (3개)

| API | 테이블 READ | 테이블 WRITE |
|-----|-----------|-------------|
| `GET /api/rooms` | sm, rooms, room_sessions, store_operating_days | — |
| `GET /api/rooms/[uuid]` | sm, rooms | — |
| `GET /api/rooms/[uuid]/participants` | sm, rooms, room_sessions, session_participants, managers, hostesses | — |

### 2-3. 세션 운영 (8개)

| API | 테이블 READ | 테이블 WRITE |
|-----|-----------|-------------|
| `POST /api/sessions/checkin` | sm, rooms, room_sessions, store_operating_days | store_operating_days, room_sessions, audit_events |
| `POST /api/sessions/checkout` | sm, room_sessions | room_sessions, session_participants, audit_events |
| `POST /api/sessions/extend` | sm, room_sessions, session_participants | session_participants, audit_events |
| `POST /api/sessions/mid-out` | sm, room_sessions, session_participants | session_participants, audit_events |
| `POST /api/sessions/participants` | sm, room_sessions, store_memberships | session_participants, audit_events |
| `GET/POST /api/sessions/orders` | sm, room_sessions, orders | orders, audit_events |
| `POST /api/sessions/settlement` | sm, room_sessions, receipts, store_settings, session_participants, orders | receipts, audit_events |
| `POST /api/sessions/receipt` | sm, room_sessions, receipts, session_participants, orders | receipt_snapshots, audit_events |

### 2-4. 정산/리포트 (3개)

| API | 테이블 READ | 테이블 WRITE |
|-----|-----------|-------------|
| `GET /api/reports/daily` | sm, store_operating_days, receipts, session_participants | — |
| `GET /api/reports/manager` | sm, store_operating_days, room_sessions, session_participants, managers, hostesses | — |
| `GET /api/reports/hostess` | sm, store_operating_days, room_sessions, session_participants, hostesses | — |

### 2-5. 매장 관리 (3개)

| API | 테이블 READ | 테이블 WRITE |
|-----|-----------|-------------|
| `GET /api/store/profile` | sm, stores | — |
| `GET /api/store/staff` | sm | — |
| `GET /api/store/settlement/overview` | sm, hostesses, session_participants, receipts | — |

### 2-6. 매니저 전용 (3개)

| API | 테이블 READ | 테이블 WRITE |
|-----|-----------|-------------|
| `GET /api/manager/dashboard` | sm, hostesses | — |
| `GET /api/manager/hostesses` | sm, hostesses | — |
| `GET /api/manager/hostesses/[id]` | sm, hostesses | — |
| `GET /api/manager/settlement/summary` | sm, hostesses, session_participants, receipts | — |

### 2-7. 아가씨 전용 (3개)

| API | 테이블 READ | 테이블 WRITE |
|-----|-----------|-------------|
| `GET /api/me/dashboard` | sm, session_participants, room_sessions | — |
| `GET /api/me/sessions` | sm, session_participants, room_sessions | — |
| `GET /api/me/sessions/[id]` | sm, session_participants, room_sessions | — |
| `GET /api/me/settlement-status` | sm, session_participants, room_sessions, receipts | — |

### 2-8. 영업일 (1개)

| API | 테이블 READ | 테이블 WRITE |
|-----|-----------|-------------|
| `POST /api/operating-days/close` | sm, store_operating_days, room_sessions, receipts, closing_reports | store_operating_days, closing_reports, audit_events |

### 2-9. 이적 (4개)

| API | 테이블 READ | 테이블 WRITE |
|-----|-----------|-------------|
| `POST /api/transfer/request` | sm, stores, transfer_requests, store_operating_days | transfer_requests, audit_events |
| `GET /api/transfer/list` | sm, transfer_requests | — |
| `POST /api/transfer/approve` | sm, transfer_requests | transfer_requests, store_memberships, audit_events |
| `POST /api/transfer/cancel` | sm, transfer_requests | transfer_requests, audit_events |

### 2-10. BLE (1개)

| API | 테이블 READ | 테이블 WRITE |
|-----|-----------|-------------|
| `POST /api/ble/ingest` | ble_gateways, ble_tags | ble_ingest_events, ble_tag_presence, audit_events |

---

## 매트릭스 3: 프론트 페이지 → API 매핑 (6개)

| # | 페이지 | 경로 | 호출하는 API |
|---|--------|------|-------------|
| 1 | 로그인 | `/login` | `POST /api/auth/login` |
| 2 | 카운터 메인 | `/counter` | `GET /api/rooms`, `GET /api/reports/daily` |
| 3 | 룸 상세 | `/counter/[room_id]` | `GET /api/rooms/[uuid]/participants`, `GET /api/sessions/orders`, `POST /api/sessions/checkin`, `POST /api/sessions/checkout`, `POST /api/sessions/extend`, `POST /api/sessions/mid-out`, `POST /api/sessions/orders`, `POST /api/sessions/settlement` |
| 4 | 입실(체크인) | `/counter/[room_id]/checkin` | `GET /api/store/staff`, `POST /api/sessions/checkin`, `POST /api/sessions/participants` |
| 5 | 정산 | `/settlement` | `GET /api/auth/me`, `GET /api/store/settlement/overview`, `GET /api/manager/settlement/summary`, `GET /api/me/settlement-status` |
| 6 | 스태프 | `/staff` | `GET /api/auth/me` |

---

## 누락된 핵심 페이지 (프론트 미구현)

| # | 필요 페이지 | 대응 API (이미 존재) | 우선순위 |
|---|-----------|-------------------|---------|
| 1 | 매니저 대시보드 | `GET /api/manager/dashboard`, `GET /api/manager/hostesses` | 높음 |
| 2 | 아가씨 대시보드 | `GET /api/me/dashboard`, `GET /api/me/sessions` | 높음 |
| 3 | 아가씨 세션 상세 | `GET /api/me/sessions/[id]` | 높음 |
| 4 | 매니저 정산 상세 | `GET /api/manager/settlement/summary` | 중간 |
| 5 | 예약 관리 | API 없음 | 중간 |
| 6 | OPS (운영 설정) | API 없음 | 낮음 |
| 7 | 영업일 마감 | `POST /api/operating-days/close` | 중간 |
| 8 | 이적 관리 | `GET /api/transfer/list`, `POST /api/transfer/*` | 낮음 |
| 9 | 리포트 (일일/매니저/아가씨) | `GET /api/reports/*` | 중간 |
| 10 | 영수증 조회 | `POST /api/sessions/receipt` | 낮음 |

**요약:**
- 백엔드 API 33개 중 프론트에서 호출하는 것: **15개** (45%)
- 프론트 미연결 API: **18개** (55%) — 대부분 매니저/아가씨 전용 + 리포트
- 핵심 누락: 매니저 대시보드, 아가씨 대시보드 (API는 있으나 페이지 없음)

---

## 테이블별 API 참조 빈도

| 테이블 | READ 횟수 | WRITE 횟수 | 합계 |
|--------|----------|-----------|------|
| store_memberships | 32 | 1 | 33 |
| room_sessions | 15 | 3 | 18 |
| session_participants | 11 | 5 | 16 |
| audit_events | 0 | 13 | 13 |
| receipts | 6 | 1 | 7 |
| hostesses | 7 | 0 | 7 |
| store_operating_days | 5 | 2 | 7 |
| rooms | 4 | 0 | 4 |
| orders | 2 | 1 | 3 |
| transfer_requests | 3 | 4 | 7 |
| managers | 2 | 0 | 2 |
| stores | 2 | 0 | 2 |
| store_settings | 1 | 0 | 1 |
| closing_reports | 1 | 1 | 2 |
| receipt_snapshots | 0 | 1 | 1 |
| profiles | 1 (FK join) | 0 | 1 |
| ble_gateways | 1 | 0 | 1 |
| ble_tags | 1 | 0 | 1 |
| ble_ingest_events | 0 | 1 | 1 |
| ble_tag_presence | 0 | 1 | 1 |
| **participant_time_segments** | **0** | **0** | **0** |
