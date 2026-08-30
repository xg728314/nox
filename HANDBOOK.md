# NOX 개발자 핸드북

> **NOX** — 한국 유흥업소 (호스티스 클럽) 운영 관리 시스템.
> 종이 장부와 수기 정산을 대체하는 웹 앱. 14개 매장 · 5~8층 단일 건물.

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [기술 스택 & 배포](#2-기술-스택--배포)
3. [저장소 구조](#3-저장소-구조)
4. [도메인 모델 & 식별자](#4-도메인-모델--식별자)
5. [인증 & 권한](#5-인증--권한)
6. [비즈니스 룰](#6-비즈니스-룰)
7. [API 카탈로그](#7-api-카탈로그)
8. [프론트엔드 (모바일 웹앱)](#8-프론트엔드-모바일-웹앱)
9. [데이터베이스 스키마 하이라이트](#9-데이터베이스-스키마-하이라이트)
10. [최근 기능 (R30)](#10-최근-기능-r30)
11. [테스트 & 검증](#11-테스트--검증)
12. [개발 환경 설정](#12-개발-환경-설정)
13. [운영 & 배포](#13-운영--배포)
14. [주의사항 & 함정](#14-주의사항--함정)

---

## 1. 프로젝트 개요

- **원본 사이트**: <https://nox.ai.kr>
- **사용자**: 사장(owner) · 실장(manager) · 아가씨(hostess) · 카운터(delegated actor)
- **핵심 기능**: 방 관리 · 세션(체크인~체크아웃) · 참여자 · 주문 · 정산 · 외상 · 타매장 조판 · 채팅 · 재고
- **모바일 우선**: `/m/*` 라우트가 실사용 · 데스크탑 `/counter`, `/owner`, `/manager`, `/me` 도 존재

---

## 2. 기술 스택 & 배포

### 스택
- **Next.js 15** (App Router) + **React 19** + **TypeScript 5**
- **Supabase** (Postgres + Auth) — 직접 client 쿼리, ORM 없음
  - Region: `ap-northeast-2` (Seoul)
  - Project id: `piboecawkeqahyqbcize`
- **Tailwind CSS 4**
- Single app, no monorepo

### 배포 — Google Cloud Run (NOT Vercel)
- **Region**: `asia-northeast3` (Seoul, Supabase 와 동일)
- **Trigger**: GitHub push → Cloud Build (`cloudbuild.yaml`) → Docker → Artifact Registry → Cloud Run
- **Container**: `2Gi memory, 1 cpu, min=1 max=10, concurrency=50, timeout=300s, cpu-boost`
- **Next.js**: `output: "standalone"` (Docker 압축)
- ❌ **Vercel Edge 없음** — `runtime = "edge"` export 쓰지 말 것 (전부 Node.js 컨테이너)
- ❌ **Vercel CDN edge cache 없음** — Cache-Control 은 브라우저 cache 만
- ✅ **min-instances=1** — cold start 거의 없음 (월 ~$15)
- ✅ **In-memory TTL 캐시** (`lib/cache/inMemoryTtl.ts`) — 컨테이너별 격리

### Cron — GitHub Actions
Cloud Run 자체 cron 없음 → **GitHub Actions schedule** 로 외부 트리거.
`.github/workflows/external-cron.yml`

| 빈도 | UTC | KST | endpoints |
|---|---|---|---|
| 5분 | `*/5 * * * *` | — | ops-alerts-scan, ble-attendance-sync, watchdog |
| 일 1회 | `0 8 * * *` | 17:00 | settlement-tree-advance |
| 일 1회 | `0 18 * * *` | 03:00 | audit-archive |
| 일 1회 | `0 19 * * *` | 04:00 | system-errors-cleanup |

Secrets: `PROD_BASE_URL`, `CRON_SECRET`. 모니터링: `/ops/watchdog` (cron_heartbeats stamp).

---

## 3. 저장소 구조

```
C:\work\nox\
├── app/                          # Next.js App Router
│   ├── api/                      # API Route Handlers
│   │   ├── auth/                 # 로그인, 세션, 멤버십
│   │   ├── sessions/             # 방 세션 lifecycle (checkin, participants, checkout, settlement)
│   │   ├── rooms/                # 방 CRUD + active session
│   │   ├── manager/              # 실장별 dashboard, incoming-staff, pending-arrivals
│   │   ├── owner/                # 사장 정산 (visibility 마스킹)
│   │   ├── me/                   # 아가씨 본인 정산
│   │   ├── cross-store/          # 타매장 dispatch, settlement
│   │   ├── credits/              # 외상
│   │   ├── chat/                 # 채팅 방/메시지/unread
│   │   ├── inventory/            # 재고
│   │   ├── operating-days/       # 영업일 마감
│   │   ├── building/             # 5~8F 건물 전체 aggregate (rooms, stores, hostesses)
│   │   ├── reconcile/            # 종이장부 대조 (Claude Vision)
│   │   └── ...
│   ├── m/                        # 모바일 웹앱 (실사용)
│   │   ├── (app)/                # 인증 필요 페이지
│   │   │   ├── page.tsx          # /m — 조판 홈 (내 아가씨 실시간 상태)
│   │   │   ├── staff/            # /m/staff — 외부조판 (건물 전체 방 aggregate)
│   │   │   ├── settle/           # /m/settle — 실장 정산 · pending 이월
│   │   │   ├── chat/             # /m/chat — 채팅
│   │   │   ├── attendance/       # /m/attendance — 출근체크
│   │   │   ├── me/               # /m/me — 개인 메뉴
│   │   │   └── ...
│   │   ├── _components/          # 재사용 컴포넌트 (Sheet, TabBar, Toast, ...)
│   │   ├── _hooks/               # useMe, useRooms, useApi, ...
│   │   └── _lib/                 # 포맷, cn, ...
│   ├── counter/                  # 카운터 대시보드 (데스크탑)
│   ├── owner/, manager/, me/     # role별 페이지
│   └── ...
├── lib/                          # 도메인 유틸
│   ├── auth/                     # resolveAuthContext (Bearer + membership)
│   ├── session/                  # 헬퍼 (createServiceClient, lockGuard, pricingLookup, ...)
│   ├── settlement/               # 서버 계산 (calculateSettlement)
│   ├── time/                     # KST businessDate 헬퍼
│   ├── cache/                    # in-memory TTL
│   ├── supabase/                 # chunkedInFetch (URL 길이 이슈 대응)
│   ├── chat/                     # publishManagerCheckinMessage, syncRoomSessionChat
│   ├── building/                 # floors.ts (5~8F SSOT)
│   ├── reconcile/                # 종이장부 파싱
│   └── ...
├── database/                     # SQL migrations (001~094)
├── scripts/                      # E2E, seed, test, cleanup 스크립트
│   ├── seed-test-data.ts
│   ├── test-*.mjs                # 각 기능 별 검증
│   └── ...
├── docs/                         # LOCKED (orchestration 승인 필요)
├── CLAUDE.md                     # 프로젝트 상세 규칙 (필독)
└── HANDBOOK.md                   # 이 문서
```

---

## 4. 도메인 모델 & 식별자

### 핵심 엔티티

- **stores** (매장) — Marvel, Live, 상한가, 발리 등 14곳. `floor` 5~8.
- **rooms** (방) — 매장 당 3~8개. `room_no` (표시용), `room_uuid` (식별자).
- **profiles** (계정) — Supabase Auth 사용자.
- **store_memberships** (멤버십) — profile × store × role. **권한의 기본 단위**.
- **hostesses** (아가씨) — membership_id + name + 담당 실장 (manager_membership_id) + origin_store.
- **room_sessions** — 방 세션 (체크인 ~ 체크아웃). 상태: active/closed.
- **session_participants** — 세션 참여자 (아가씨). 종목·시간·금액 기록.
- **transfer_requests** — 타매장 파견 요청 (approved 시 참여자 등록 가능).
- **store_operating_days** — 영업일 (business_date). status: open/closed.
- **store_service_types** — 매장별 종목 단가.

### 필수 식별자 (절대 준수)

| ✅ 사용 | ❌ 사용 금지 | 용도 |
|---|---|---|
| `store_uuid` | `store_code`, `store_id` (numeric) | 매장 scope |
| `room_uuid` | `room_no` | 방 identity |
| `membership_id` | `user_id` (직접) | 권한 · 인원 식별 |
| `business_day_id` | `created_at`, calendar date | 영업일 aggregation |

### 영업일 (business_date)
- 자정을 넘겨 운영. KST 06:00 cutoff.
- 예: 23:00 (4/10) → 01:00 (4/11) 세션은 `business_date = 2026-04-10`.
- 모든 매출·정산·세션 카운트는 `business_date` 기준.
- 헬퍼: `lib/time/businessDate.ts` (`getBusinessDateForOps()`)

---

## 5. 인증 & 권한

### resolveAuthContext (`lib/auth/resolveAuthContext.ts`)

모든 mutating endpoint 는 반드시:
```ts
const auth = await resolveAuthContext(request)
```

반환 필드:
```ts
{
  user_id: string,          // profile.id
  membership_id: string,    // store_membership.id
  store_uuid: string,       // 현재 활성 매장
  role: "owner"|"manager"|"hostess",
  membership_status: "approved"|...,
  is_super_admin: boolean,  // 별도 super_admin 테이블 기반
}
```

### 인가 원칙
- **membership-based** — user 가 아닌 membership 이 권한 단위
- 한 사용자가 여러 매장 membership 가능 (cross-store)
- `is_primary=true` + `status='approved'` 만 유효
- `nox_active_store` 쿠키로 super_admin 매장 switching
- Counter (카운터) 는 role enum 이 아닌 delegated actor — 실제 owner/manager 로 로그인, actor_type: counter 로 audit

### 역할별 접근
| Role | 페이지 |
|---|---|
| owner | `/owner`, `/m` (사장 view) |
| manager | `/manager`, `/m` |
| hostess | `/me`, `/m/me` (제한된 view) |
| counter | `/counter` |

---

## 6. 비즈니스 룰

### 종목별 단가 (Service Types)
**DB `store_service_types` 조회 필수 · 하드코딩 금지.**

| 종목 | 기본 시간 | 단가 | 반티 | 단가 | 차3 | 단가 |
|---|---|---|---|---|---|---|
| 퍼블릭 | 90분 | 13만 | 45분 | 7만 | 9~15분 | 3만 |
| 셔츠 | 60분 | 14만 | 30분 | 7만 | 9~15분 | 3만 |
| 하퍼 | 60분 | 12만 | 30분 | 6만 | 9~15분 | 3만 |

셔츠: 인사확인 옵션. 영업일 진행 중 설정 변경 불가 (잠금).

### 시간 로직
- **0~8분**: 기본 0원 (실장 재량 지급 가능)
- **경계구간 (반티+10분)**: 반티 or 반티+차3 선택
- 시간/단가 계산은 DB 값 기준 · 하드코딩 금지

### 정산 (Settlement)
- **서버 계산 only** — 클라이언트 계산·제출 금지
- 공식: `gross_total = base_price + extra_price + orders_total`
- 실장/아가씨 분배: `hostess_payout = 종목단가 - manager_deduction`
  - `manager_deduction`: 0 / 5천 / 1만 중 실장이 선택 (재량)
- **% 기반 계산 금지** — 고정 금액만
- 상태: `draft` → `finalized` (immutable, 재계산 시 새 버전)

### 타매장 정산 (Cross-Store)
- 아가씨는 **origin_store_uuid** 에 영원히 귀속
- 워킹매장 = 장소만 제공, 수수료 없음
- 정산은 무조건 origin 기준

### 사장 열람 권한 (Owner Visibility)
- ✅ 볼 수 있음: 양주판매, 웨이터봉사비, 사입, TC, 총매출, 사장마진
- ❌ 볼 수 없음: 실장 개별 수익, 아가씨 개별 수익
- Owner API 응답은 `resolveOwnerVisibility` 로 마스킹

### 손님 청구
- 구성: 양주(실장판매가) + 아가씨타임 + 웨이터팁
- 카드수수료: 매장별 % + 실장 추가마진
- 결제: 현금/카드/외상/혼합

### 외상 (Credit)
- 3종 구조: 방 + 담당실장 + 손님정보
- closing 이후에도 외상 전환 가능

### Audit
- 모든 mutating 작업에 audit 로그 필수
- 선정산: 요청자 + 실행자 모두 기록

---

## 7. API 카탈로그

### Auth
- `POST /api/auth/login` — 이메일/비밀번호 (개발 모드 `NOX_SKIP_EMAIL_OTP=true`)
- `GET /api/auth/me` — 현재 사용자
- `GET /api/auth/memberships` — 멀티 멤버십

### Sessions (방 세션 lifecycle)
- `POST /api/sessions/checkin` — 세션 개설 (담당 실장 지정)
- `POST /api/sessions/[id]` PATCH — 실장/손님 변경
- `POST /api/sessions/[id]/force-close` — 빈 세션 강제 종료 (정산 없음)
- `POST /api/sessions/checkout` — 정식 종료 (RPC 정산 계산)
- `POST /api/sessions/[id]/lock` — **NEW** 방 잠금 toggle
- `POST /api/sessions/[id]/reopen` — 종료된 세션 재개
- `POST /api/sessions/participants` — 아가씨 추가
- `POST /api/sessions/participants/[id]/leave` — 아가씨 종료
- `POST /api/sessions/participants/[id]/move-room` — **NEW** 방 이동
- `POST /api/sessions/participants/leave-by-name` — 이름 기반 종료
- `POST /api/sessions/orders` — 주문
- `POST /api/sessions/bill` — 손님 청구서
- `POST /api/sessions/settlement` / `finalize` / `payment`
- `POST /api/sessions/pre-settlement` — 선정산
- `POST /api/sessions/auto-close-expired` — cron/사용자 · 초과 자동 종료

### Cross-store
- `POST /api/cross-store/dispatch` — 파견 (mode: `immediate` | `pending`) **NEW**
- `POST /api/cross-store/settle-group` — 원소속별 정산 그룹
- `POST /api/cross-store/records` / `payout` — 정산 처리
- `POST /api/cross-store/[id]/approve` — 요청 승인

### Manager
- `GET /api/manager/hostesses` — 담당 아가씨 목록
- `GET /api/manager/hostesses/[id]/sessions` — 세부 세션
- `GET /api/manager/settlement/summary` — 정산 요약 (본 매장)
- `GET /api/manager/incoming-staff` — 우리 매장 들어온 타매장 식구
- `GET /api/manager/pending-arrivals` — **NEW** 도착 대기 pool
- `POST /api/manager/pending-arrivals/[id]/assign-room` — **NEW** 방 배정
- `PATCH /api/manager/staff-payout/[id]` — 아가씨 payout 상태 (paid/held)

### Owner
- `GET /api/owner/settlement` — 열람 권한 마스킹 적용

### Me (아가씨 본인)
- `GET /api/me/settlements`

### Rooms / Store
- `GET /api/rooms` — 본 매장 방 목록 + active session
- `GET /api/store/staff` — 매장 스태프
- `GET /api/store/settings` — card_fee_rate, waiter_tip 등
- `GET /api/store/service-types` — 종목 단가
- `GET /api/store/settlement/overview`

### Building (건물 전체 aggregate · super_admin + owner/manager)
- `GET /api/building/rooms` — 5~8F 전체 방 상태
- `GET /api/building/stores` — 매장 목록
- `GET /api/building/hostesses` — 5~8F 전체 아가씨 (disambig 용)

### Credits (외상)
- `GET|POST /api/credits`
- `GET|PATCH /api/credits/[id]`

### Chat
- `GET|POST /api/chat/rooms`
- `GET|POST /api/chat/messages`
- `GET /api/chat/unread`
- `POST /api/chat/from-parsed` — 파서 자동 조판

### Inventory
- `GET|POST /api/inventory/items`
- `PATCH|DELETE /api/inventory/items/[id]`
- `GET|POST /api/inventory/transactions`

### Operating Days
- `POST /api/operating-days/close`

### Reports
- `GET /api/reports/daily`

### Reconcile (종이장부)
- `POST /api/reconcile/upload`
- `GET /api/reconcile/list`
- `GET|POST /api/reconcile/[id]` / `/extract` / `/diff` / `/review`

### System
- `GET /api/system/time` — 서버 시각 (카운터 PC 시계 보정)
- `GET /api/ops/watchdog` — cron heartbeat 검출

---

## 8. 프론트엔드 (모바일 웹앱)

**주 진입점**: `/m` (조판 홈)

### 페이지
| 경로 | 설명 |
|---|---|
| `/m` | **조판 홈** — 내 아가씨 실시간 (live/wait/done) · 방 배정 (AssignFlowSheet) |
| `/m/staff` | **외부조판** — 건물 전체 방 상태 (LiveRoomCard, EmptyRoomCard) |
| `/m/settle` | **정산** — 실장별 그룹 · 외부 식구 (IncomingStaffSection · 🚪 방이동) |
| `/m/settle/pending` | **미정산 이월** |
| `/m/chat`, `/m/chat/[id]` | 채팅 · Realtime |
| `/m/attendance` | 출근체크 (검색) |
| `/m/hostess-manage` | 아가씨 관리 |
| `/m/credits`, `/m/inventory` | 외상 · 재고 |
| `/m/me` | 개인 메뉴 |
| `/m/assign` | (legacy) 상세 배정 wizard |

### 주요 컴포넌트 (`app/m/_components/`)
- **AssignFlowSheet** — 층/매장/종목/시간/시각 pick (최소 클릭)
- **AddHostessToSessionSheet** — **NEW** 기존 세션에 아가씨 추가 · default 본 매장만
- **MoveRoomSheet** — **NEW** 참여자 방 이동
- **PendingArrivalSheet** — **NEW** 도착 대기 pool → 방 배정
- **ExtendEndSheet** — 참여자 연장/종료
- **EditParticipantSheet** — 시간/금액 수정
- **StaffPayoutSheet** — 아가씨별 payout 상세
- **Sheet** — 공통 bottom sheet primitive
- **PageHeader**, **TabBar** (채팅/조판/외부조판/정산/전체메뉴)
- **Toast**, **haptic**

### 주요 훅 (`app/m/_hooks/`)
- **useApi** (TTL 캐시 + invalidateApi + subscribers)
- **useMe** — 로그인 사용자
- **useRooms** — 본 매장 방 목록
- **useHostesses** — 내 담당 아가씨
- **useAttendance** — 오늘 출근
- **useBuildingRooms** / **useBuildingStores** / **useBuildingHostesses**
- **useSettlement** / **useIncomingStaff** / **usePendingArrivals** ← **NEW**
- **useServiceTypes** — 매장 종목 단가
- **useAutoCloseExpired**

---

## 9. 데이터베이스 스키마 하이라이트

Source of truth: `database/002_actual_schema.sql`.

### 핵심 테이블 관계
```
profiles ─┬─ store_memberships ─┬─ hostesses (membership_id 로 연결)
          │                     └─ (role: owner/manager/hostess)
          │
stores ───┼─ rooms ─── room_sessions ─── session_participants
          │              (business_day_id)
          ├─ store_operating_days
          ├─ store_service_types
          ├─ store_settings
          └─ transfer_requests (from/to)
```

### RLS 상태
- **24개 테이블 RLS 활성** (migration 064~070)
- 하지만 app route 는 service-role key 로 우회 → 실제 앱 동작에 영향 없음
- 일반 user JWT 클라이언트로 직접 쿼리 시엔 정책 제약 적용

### 파일명 alias 주의
| Supabase history | 로컬 파일 |
|---|---|
| `step_011d_payout_and_cross_store_normalization` | `036_payout_and_cross_store_normalization.sql` |
| `044_auth_rate_limits_and_security_logs` | `052_auth_rate_limits.sql` |
| `080_manager_prepayments` | `043_manager_prepayments.sql` |

`database/001_initial_schema.sql` **DEPRECATED**.
`database/20260411_foxpro_checkout.sql` **미적용**.

### 주요 컬럼 함정
- `receipts` 테이블에 `deleted_at` 컬럼 **없음** — `.is("deleted_at", null)` 쓰지 말 것
- `session_participants.transfer_request_id` — cross-store 시 DB 트리거 강제
- `session_participants.origin_store_uuid` — 매장 = origin 이면 null 로 정규화 (check constraint)

---

## 10. 최근 기능 (R30 이번 세션)

### 방(세션) 잠금 — R-room-lock
- **문제**: 같은 매장 실장이 실수로 다른 실장 방을 수정
- **해결**:
  - Migration `094_room_session_lock.sql` — `room_sessions.locked_by_membership_id` + `locked_at`
  - `POST /api/sessions/[id]/lock` — toggle
  - `lib/session/lockGuard.ts` — `assertSessionUnlocked(supabase, sessionId, auth)` 헬퍼
  - 6개 endpoint 에 통합: participants POST/leave, session PATCH, force-close, checkout, move-room+assign-room
  - UI: 진행 pill 옆 🔓/🔒 토글 (LiveRoomCard)
  - **Owner (사장) + super_admin 은 override 가능**

### 도착 대기 pool — R-pending-pool
- **문제**: cross-store dispatch 자동 방 배정 → 실제 안내한 방과 다름
- **해결**:
  - `cross-store/dispatch` body 에 `mode: "pending"` 추가 → transfer_request 만 생성 (session/participant 없음)
  - reason 필드에 `{category, time_type, dispatched_by, dispatched_at}` JSON 저장 (schema 변경 없음)
  - `GET /api/manager/pending-arrivals` — 대기 목록
  - `POST /api/manager/pending-arrivals/[id]/assign-room` — 방 배정 (자동 실장 = 배정자)
  - UI: 조판/외부조판 상단 「🚪 도착 대기 · 방 배정 필요 N」 amber pulse 배지 · PendingArrivalSheet
  - **Immediate mode (ExternalStaffAddSheet)** 는 기존 유지

### 즉시 체크인 — R-instant-checkin
- **이전**: EmptyRoomCard 「+ 체크인」 → `/m/assign` wizard 페이지 이동
- **NEW**: 버튼 → `/api/sessions/checkin` 직접 호출 · 담당 자동 = 현재 사용자
- 타 매장 방 (super_admin cross-store) 은 링크 flow 유지

### 참여자 방 이동 — R-cross-store-room-move
- `POST /api/sessions/participants/[id]/move-room`
- 참여자 id 유지 · session_id 만 교체 → entered_at/금액 그대로
- 대상 방 active session 없으면 신규 생성 · 원 세션 참여자 0명 → 자동 close
- UI: MoveRoomSheet (settle 외부식구 섹션 · 🚪 버튼)
- 도착 매장 실장이 자동 배정된 방을 원터치 이동

### 아가씨 추가 시트 — R-add-hostess
- LiveRoomCard 확장 · 「+ 아가씨 추가」 버튼 → AddHostessToSessionSheet
- 종목/시간 pill · localStorage 마지막 값 기억
- **Default 본 매장만** · 「🌍 외부 매장 ON」 명시적 opt-in
- 외부 아가씨는 origin_store_uuid 자동 세팅

### 세션 강제 종료 — R-force-close
- LiveRoomCard 확장 · 참여자 0명 시 「🔚 세션 종료」 버튼 노출
- `POST /api/sessions/[id]/force-close` — 정산 없이 stale 세션 정리
- 참여자 있으면 409 · checkout 사용 권장

### 캐시 무효화 강화 — R-checkin-building-cache
- checkin / force-close / assign-room 모두 `invalidateCache("building_rooms")` 호출
- "1번방 이미 사용중" 오탐 원인 해결 (외부조판 stale cache)

### 시작 시각 조정 — R-time-offset
- AssignFlowSheet 「시작 시각」 pill (-10/-5/지금/+5/+10)
- `participants.entered_at` optional override (±30분 안전 범위)

### 층/매장 pick — R-cross-store-picker
- AssignFlowSheet 확장 · 5F/6F/7F/8F pill + 매장 pill
- 다른 층 매장으로 파견 지원

### 출근자 검색 — R-attendance-search
- attendance 페이지 sticky 검색창 (이름 or 실장명)

### Auto-manager on assign-room
- pending assign-room 시 신규 세션의 실장 자동 = 배정자
- `profiles.full_name` 자동 lookup

---

## 11. 테스트 & 검증

### TypeScript 검증
```bash
npx tsc --noEmit
```

### 유닛 테스트
```bash
npm test    # 정산 계산 14 시나리오 (lib/settlement/services/__tests__)
```

### E2E Python 스크립트
```bash
python scripts/test-step1.py   # 인증, 기본 setup
python scripts/test-step2.py   # cross-store
python scripts/test-step3.py   # advanced workflows
python scripts/test-e2e.py     # 오케스트레이션
```

### R30 검증 스크립트 (Node.js)
```bash
# 전체 기능 정적 + 동적 검증 · 문제점 목록화
node scripts/test-all-features.mjs

# 시나리오별
node scripts/test-pending-dispatch.mjs      # 도착 대기 pool 생성
node scripts/test-pending-e2e.mjs           # pool → assign-room → 재조회
node scripts/test-pending-e2e2.mjs          # auto-manager 검증
node scripts/test-cross-store-dispatch.mjs  # immediate mode (legacy)

# 상태 진단 / 정리
node scripts/test-pending-state.mjs          # DB 스냅샷
node scripts/test-pending-cleanup.mjs        # 테스트 데이터 정리
node scripts/test-cleanup-stale-sessions.mjs # 24h+ 빈 세션 close
node scripts/test-fix-any-nomgr-session.mjs  # 실장 미지정 backfill
```

### 부하 테스트
```bash
# k6 read-path baseline
scripts/load-test/
```

---

## 12. 개발 환경 설정

### 1. 저장소 클론
```bash
git clone <repo-url> C:\work\nox
cd C:\work\nox
npm install
```

### 2. .env.local
```
NEXT_PUBLIC_SUPABASE_URL=https://piboecawkeqahyqbcize.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
CRON_SECRET=<random-secret>
NOX_SKIP_EMAIL_OTP=true        # 개발용 · OTP 스킵
ANTHROPIC_API_KEY=<...>        # 종이장부 Vision (optional)
SENTRY_DSN=<...>               # 오류 리포트 (optional)
```

### 3. Dev 서버
```bash
npm run dev
# http://localhost:3001
```

### 4. Seed 데이터
```bash
npx tsx scripts/seed-test-data.ts
# Marvel/Live 매장 + owner/manager/hostess 계정
```

### 5. 프로덕션 빌드 검증
```bash
npm run build
```

---

## 13. 운영 & 배포

### Migration 적용
1. `database/NNN_*.sql` 파일 생성
2. Supabase Dashboard SQL 편집기에서 실행
3. `database/README.md` 에 파일명 alias 기록 (Supabase history 이름 다르면)

**최근 미적용 migration**:
- `094_room_session_lock.sql` — 방 잠금 컬럼

### 배포
1. GitHub `main` push
2. Cloud Build trigger 자동 (Docker build → Artifact Registry)
3. Cloud Run 자동 revision (asia-northeast3)
4. 검증: <https://nox.ai.kr>

### 모니터링
- **Sentry** — 오류 리포트 (`SENTRY_DSN` env 미설정 시 silent)
- **/ops/watchdog** — cron heartbeat stale 검출
- **audit_events** — 모든 mutating 작업 (자동 archive)
- **system_errors** — 캐치되지 않은 서버 예외

### Backup
- Supabase 자동 daily backup (7일 보관)
- 세법상 receipts/settlements 5년 보관 (archive-on-print, migration 085)

---

## 14. 주의사항 & 함정

### Protected Calculation Invariants (**절대 훼손 금지**)
- `lib/session/services/pricingLookup.ts` — DB 미조회 시 **PricingLookupError** throw. fallback 금액 복구 금지.
- `lib/settlement/services/calculateSettlement.ts` — `toNum()` 가드로 NUMERIC string/null/NaN 처리. 제거 금지.
- `app/api/sessions/checkin/route.ts` + `[session_id]/route.ts` — `manager_membership_id` 를 store_memberships (same store + approved + not-deleted + role in [manager, owner]) 로 검증. 제거 금지.

### Protected Areas (수정 시 orchestration 승인 필요)
- Auth / Authorization logic
- Settlement core calculation
- Session core lifecycle
- Database schema
- Business date logic
- `docs/**` 파일
- `orchestration/config/**`

### 자주 만나는 함정
1. **`.in()` URL 길이 초과** — 100개 이상 IN 절 시 URL >2KB → `fetch failed`. `lib/supabase/chunkedInFetch` 사용.
2. **`receipts.deleted_at` 없음** — `.is("deleted_at", null)` 하면 42703 에러.
3. **`business_date` UTC 버그** — `new Date().toISOString().slice(0,10)` 는 UTC 기준 → KST 이슈. `getBusinessDateForOps()` 사용.
4. **Vercel edge runtime** — `runtime="edge"` 쓰지 말 것 (Cloud Run 은 Node.js 컨테이너).
5. **PostgREST `.maybeSingle()` 다중 행** — 2 rows 매치 시 error·null 반환. `.limit(1)` 로 제한.
6. **캐시 무효화 누락** — DB 변경 route 는 관련 in-memory cache 모두 invalidate (`rooms`, `building_rooms`, `monitor`, `room_participants`, `session_orders`).
7. **cross-store trigger** — `session_participants` 에 origin ≠ store 일 때 `transfer_request_id` 필수.
8. **`.env.local` 미커밋** — git ignore 됨. 새 개발자에게 별도 전달 필요.

### 개발 규칙 (CLAUDE.md 요약)
- **PLANNER → EXECUTOR → VALIDATOR** 3단계 워크플로우
- 단일 파일 수정 원칙 (분리 신중)
- store_uuid scope · session SSOT · role 가드 필수
- 추측 필드명 사용 금지 (확인 후 사용)
- 숫자 store_id 사용 금지
- `room_no` 를 식별자로 사용 금지

---

## Layer & 흐름 요약

```
[사용자] → /m/staff (외부조판)
    │
    ├─ 빈방 「+ 체크인」 → sessions/checkin (담당=나)
    ├─ 확장 카드 「+ 아가씨 추가」 → AddHostessToSessionSheet → participants POST
    ├─ 확장 카드 「🔚 세션 종료」 → sessions/[id]/force-close (빈 세션만)
    ├─ 진행 pill 옆 🔓/🔒 → sessions/[id]/lock (수정 잠금)
    ├─ 상단 「🚪 도착 대기 N」 → PendingArrivalSheet → pending-arrivals/[id]/assign-room
    │
    └─ /m/settle (정산)
        ├─ 실장별 아가씨 · payout 상태
        ├─ 외부식구 섹션 🚪 방이동 → participants/[id]/move-room
        └─ 미정산 이월 → /m/settle/pending
```

---

## 향후 로드맵 (미구현)

- **외부 노출 승인 permission** — 실장 부재중 시 아가씨 외부 검색 노출 on/off
- **조판 홈 empty state 원인 진단** — 활성 방 있는데 0방 표시 이슈
- **R30-C: 체크인 방식 모달** (검색·채팅파싱·예약)
- **테스트 데이터 cleanup 자동화**
- **DB 백업 복원 시연**
- **Phase B 큰 파일 분할** (CounterPageV2.tsx 1328줄 등)

---

**질문/이슈**: 저장소 issue tracker 또는 담당자에게 문의.
