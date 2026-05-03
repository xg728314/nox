# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NOX is a Korean entertainment venue (유흥업소) operation management system. It digitalizes hostess club business management — replacing paper ledgers and manual settlement with a web app. The system manages rooms, sessions, staff, orders, and settlement across 14 stores on floors 5-8 of a single building.

## Build & Development Commands

```bash
npm run dev      # Start Next.js dev server
npm run build    # Production build (use to verify no type/build errors)
npm run lint     # Run Next.js linting
npm run start    # Start production server
```

**E2E tests** are Python scripts in `/scripts/`:
```bash
python scripts/test-step1.py   # Auth, basic setup
python scripts/test-step2.py   # Cross-store scenarios
python scripts/test-step3.py   # Advanced workflows
python scripts/test-e2e.py     # Full E2E orchestrator
```

**Seed data:** `npx tsx scripts/seed-test-data.ts` — creates Marvel/Live stores with owner/manager/hostess test accounts.

## Tech Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript 5**
- **Supabase** (PostgreSQL + Auth) — no ORM, direct client queries.
  Region: `ap-northeast-2` (Seoul). Project id: `piboecawkeqahyqbcize`.
- **Tailwind CSS 4** — styling
- Single app, no monorepo/workspaces

## Deployment — Google Cloud Run (NOT Vercel)

**원본 사이트**: https://nox.ai.kr

- **Platform**: Google Cloud Run (`asia-northeast3` Seoul, Supabase 와 동일 region).
- **Build**: GitHub push → Cloud Build trigger (`cloudbuild.yaml`) → Docker image
  → Artifact Registry → Cloud Run revision 배포.
- **Container config** (cloudbuild.yaml):
  - `--memory=2Gi --cpu=1 --min-instances=1 --max-instances=10`
  - `--concurrency=50 --timeout=300s --cpu-boost` (CPU always-allocated)
  - `--region=asia-northeast3`
- **Next.js**: `output: "standalone"` (Docker 이미지 압축).

**중요한 차이 (vs Vercel)**:
- ❌ **Vercel Edge Functions 없음** — `runtime = "edge"` export 는 Cloud Run 에서 무의미
  (전부 Node.js 컨테이너에서 실행). 새 라우트에 `runtime = "edge"` 쓰지 말 것.
- ❌ **Vercel CDN edge cache 없음** — Cache-Control headers 는 브라우저 cache 만 활용.
  공유 edge cache 가 필요하면 Cloud CDN 별도 설정 필요.
- ✅ **min-instances=1** 로 cold start 거의 없음 (월 ~$15 추가 비용).
- ✅ **In-memory TTL 캐시** (`lib/cache/inMemoryTtl.ts`) 는 컨테이너별 격리 — 동작 동일.
- ✅ HTTP Cache-Control max-age 는 브라우저에서 정상 작동.

**미배포 Vercel 잔재**:
- `vercel.json` — 과거 잔재, Cloud Run 에서 미사용.
- `app/api/system/warmup`, `time`, `health` 의 `runtime = "edge"` — 제거 필요.
- 일부 cron 정의는 Vercel cron 형식 — Cloud Scheduler 로 마이그레이션 검토.

## Architecture

### API Routes (`app/api/`)

All API routes are Next.js Route Handlers. Every mutating endpoint must:
1. Call `resolveAuthContext(req)` from `lib/auth/resolveAuthContext.ts` to validate the Bearer token
2. Check `role` and `store_uuid` from the returned `AuthContext`
3. Scope all queries by `store_uuid`

Key API domains:
- `auth/` — login, current user
- `sessions/` — full lifecycle: checkin, checkout, extend, mid-out, participants, orders, receipt, settlement
- `rooms/` — CRUD and active session info
- `transfer/` — cross-store hostess transfer (request/approve/cancel/list)
- `reports/` — daily, hostess, manager reports
- `operating-days/` — business day close
- `store/` — store profile, staff, settlement overview
- `manager/` — manager-specific dashboard and settlement
- `me/` — personal settlement status

### Auth Model (`lib/auth/resolveAuthContext.ts`)

Authorization is **membership-based, not user-based**. The `AuthContext` contains:
- `user_id`, `membership_id`, `store_uuid`, `role` (owner|manager|hostess), `membership_status`

A user can have multiple memberships (cross-store). Only `is_primary=true` and `status='approved'` memberships grant access.

### Database (`database/002_actual_schema.sql`)

Source of truth for DB schema (extracted from live Supabase). Key tables: `profiles`, `stores`, `store_memberships`, `store_operating_days`, `rooms`, `room_sessions`, `session_participants`, `hostesses`, `managers`, `menu_items`, `orders`, `receipts`, `receipt_snapshots`, `store_settings`, `transfer_requests`, `audit_events`, `closing_reports`.

**RLS 상태 (2026-04-24 실사)**:
- RLS **활성 테이블 24개** (migration 064~070 이 실 DB 에 적용됨).
- 활성 테이블: `audit_events, ble_*, closing_reports, cross_store_work_records, hostesses, location_correction_logs, managers, orders, participant_time_segments, profiles, receipt_snapshots, receipts, room_sessions, rooms, session_participants, store_memberships, store_operating_days, store_settings, stores, transfer_requests` 등.
- 실 운영 영향: 앱 route 는 **service-role key** 로 Supabase 클라이언트를 생성 → RLS 우회. 따라서 app 레벨 동작 차이 없음.
- 주의: 일반 user JWT 클라이언트로 직접 쿼리하면 정책 제약 적용됨 (개발 중 Supabase Dashboard 쿼리 등).

**`cross_store_work_records` vs `staff_work_logs`**:
- `staff_work_logs` 테이블은 **live DB 에 존재하지 않음**.
- `/api/staff-work-logs` route 는 `cross_store_work_records` 테이블 기준으로 재작성됨 (2026-04-24).
- migration `059_staff_work_logs.sql` 은 **내용상 `cross_store_work_records` 테이블 생성에 대응** (파일명 오해 주의).
- migration `060_cross_store_items_work_log_link.sql` 은 **미적용** (staff_work_log_id / hostess_membership_id / category / work_type 컬럼 부재).

**파일명 alias (실 apply 이름 ↔ 로컬 파일명)**:
| Supabase history | 로컬 파일 |
|---|---|
| `step_011d_payout_and_cross_store_normalization` | `036_payout_and_cross_store_normalization.sql` |
| `step_011e_settlement_payout_hardening` | `037_settlement_payout_hardening.sql` |
| `step_011f_cross_store_legacy_drop` | `038_cross_store_legacy_drop.sql` |
| `chat_rooms_close_fields` | `028_chat_rooms_close_fields.sql` |
| `chat_participants_pinned_at` | `029_chat_participants_pinned_at.sql` |
| `044_auth_rate_limits_and_security_logs` | `052_auth_rate_limits.sql` |
| **`080_manager_prepayments`** | **`043_manager_prepayments.sql`** ← 043 slot 충돌로 80 으로 apply |
| `043_super_admin_global_roles` | (로컬 파일 없음 — SQL 에디터 직접 생성) |

상세 관리 가이드: `database/README.md` 참조.

Note: `database/001_initial_schema.sql` is DEPRECATED. `database/20260411_foxpro_checkout.sql` was NEVER applied to DB.

Note: `receipts` table does NOT have a `deleted_at` column. Do not use `.is("deleted_at", null)` on receipts queries.

### Offline Support (`lib/offline/`)

IndexedDB-based offline storage with sync. Draft sessions and orders can be stored offline. Final settlement confirmation is forbidden offline. Conflict resolution: server truth wins.

### Frontend (`app/counter/`, `app/settlement/`, `app/staff/`)

Counter dashboard is the main operator UI for managing rooms and sessions. Settlement and staff pages provide role-appropriate views.

## Critical Domain Rules

These rules are defined in locked docs (`docs/`) and must never be violated:

### Identifiers
- **Always use `store_uuid`** to scope data — never `store_code` or `store_id`
- **Always use `room_uuid`** for room identity — never `room_no` (display only)
- **Always use `membership_id`** for authorization — never `user_id` directly
- **Always use `business_day_id`** for date-based aggregation — never calendar date or `created_at`

### Business Date
Operations span midnight. `business_date` is the operating date, not the calendar date. A session starting at 23:00 on 4/10 and ending at 01:00 on 4/11 has `business_date = 2026-04-10`. All aggregation (revenue, settlement, session counts) must use `business_date`.

### Settlement
- Settlement is **server-side only** — client calculation and client-submitted amounts are forbidden
- Formula: `gross_total = base_price + extra_price + orders_total`, then TC/manager/hostess shares calculated with configured rates and rounding
- Settlement states: `draft` (editable) → `finalized` (immutable, new version on recalculation, no overwrite)

### Cross-Store Transfers
- Hostesses can work at other stores. `participant.store_uuid` = the store where work happens (not the home store)
- Transfer requires approval from both departure and arrival stores

### Counter Role
- `counter` is NOT a role enum value — it's a delegated UI actor for owner/manager
- All writes record the actual logged-in `user_id`, with `actor_type: counter` in audit

## Business Rules (비즈니스 규칙)

### 종목별 단가 (Service Types & Pricing)

단가는 종목(퍼블릭/셔츠/하퍼)별로 다르며, 모든 값은 DB `store_service_types` 테이블에서 조회. **하드코딩 절대 금지.**

| 종목 | 기본 (시간) | 단가 | 반티 (시간) | 단가 | 차3 (시간) | 단가 |
|------|------------|------|------------|------|-----------|------|
| 퍼블릭 | 90분 | 13만원 | 45분 | 7만원 | 9~15분 | 3만원 |
| 셔츠 | 60분 | 14만원 | 30분 | 7만원 | 9~15분 | 3만원 |
| 하퍼 | 60분 | 12만원 | 30분 | 6만원 | 9~15분 | 3만원 |

- 셔츠: 인사확인 옵션 있음
- 영업일 진행 중 설정 변경 불가 (잠금)

### 시간 로직 (Time Rules)

- **0~8분**: 기본 0원, 실장 재량으로 지급 가능
- **경계구간 (반티+10분)**: UI에서 반티 or 반티+차3 중 실장이 선택
- 모든 시간/단가 계산은 DB 설정값 기준, 절대 하드코딩 금지

### 정산 규칙 (Settlement Rules)

- **아가씨 지급액** = 종목단가 - 실장수익 (실장이 직접 입력)
- **실장수익**: 0원 / 5천원 / 1만원 중 재량 선택
- **% 기반 계산 전면 금지** — 고정 금액만 사용

### 타매장 정산 (Cross-Store Settlement)

- 아가씨는 원소속 매장(`origin_store_uuid`)에 영원히 귀속
- 워킹매장은 장소만 제공, 수수료 없음
- 정산은 **무조건 `origin_store_uuid` 기준**으로 처리

### 사장 열람 권한 (Owner Visibility)

- **사장이 볼 수 있음**: 양주판매내역, 웨이터봉사비, 사입, TC(타임수), 총매출, 사장마진
- **사장이 볼 수 없음**: 실장 개별 수익(타임당 공제액), 아가씨 개별 수익
- owner 정산 UI에서 `manager_payout_amount`, `hostess_payout_amount` 개별 노출 금지
- TC 건수와 총액만 표시, 개별 타임 단가 분해 금지

### 손님 청구 (Customer Billing)

- 청구 구성: 양주(실장판매가) + 아가씨타임 + 웨이터팁
- **웨이터팁**: 매장 기본값 설정, 세션마다 조정 가능
- **카드수수료**: 매장별 % 설정, 실장 추가마진 가능
- 결제 방식: 현금 / 카드 / 외상 / 혼합 모두 지원 (카드 실결제는 웹 외부에서 처리)

### 외상 (Credit/Unpaid)

- **3종 구조**: 방 + 담당실장 + 손님정보(이름, 연락처)
- 고객 DB로 활용 가능
- closing 이후에도 외상으로 전환 가능

### 감사 로그 (Audit)

- 모든 작업에 audit 로그 필수
- 선정산(pre-settlement): 요청자 + 실행자 모두 기록

## Protected Areas

These areas must not be modified without explicit task authorization:
- Authentication / Authorization logic
- Settlement core calculation
- Session core lifecycle
- Database schema
- Business date logic

## File Scope Rules

- `docs/**` are **LOCKED** — do not modify without explicit orchestration approval
- `orchestration/config/**` — do not modify
- `C:\work\wind` — read-only 참조 허용 (게이트웨이/태그 이식 검토 목적). import / 코드 복사·실행 금지.

## Orchestration

Development is managed through an orchestration system (`orchestration/`). Tasks are defined as rounds in `orchestration/tasks/`. The orchestrator (ChatGPT) defines tasks; Claude Code executes single-file changes. Default mode: `controlled_auto_stop_on_fail`.

## Floor Expansion Status (2026-04-24)

- **5F 전체 완료 · 검증됨** (2026-04-12 기준, 아래 LOCKED 항목 참조).
- **6·7·8F 확장 준비 완료** (2026-04-24):
  - 층 범위 단일 원본: `lib/building/floors.ts` (`BUILDING_FLOORS = [5,6,7,8]`). 향후 층 변경 시 이 한 파일만 수정.
  - `rooms.floor_no` CHECK 제약 (migration 083) — 5~8 범위 강제.
  - scopeResolver / zones 전부 `BUILDING_FLOORS` 파생.
  - 신규 매장 추가 절차: stores row INSERT → rooms row INSERT (floor_no 5~8) → `store_service_types` 전체 종목 단가 등록 (필수 — 없으면 체크인 실패).

## Known Gaps (R28, 향후 라운드 후보)

코드 실사로 확인된 "조용한 실패" 가능 지점. 우선순위 순.

1. ~~**MFA backup_codes 미사용**~~ — **R25 완료**.
2. ~~**audit_events 무한 성장**~~ — **R26 완료**.
3. ~~**MFA setup UI 부재**~~ — **R26 완료**.
4. ~~**외상 PII 열람 감사 부재**~~ — **R28 완료**. credits/customers GET 응답 시 audit log.
5. ~~**Sentry 통합**~~ — **R28 완료**. `@sentry/nextjs` + instrumentation. `SENTRY_DSN` env 미설정 시 silent.
6. ~~**checkin race condition**~~ — **R28 완료**. migration 093 partial UNIQUE index.
7. ~~**business_date UTC 버그**~~ — **R28 완료**. `lib/time/businessDate.ts` (KST 헬퍼). 18 파일 sweep.
8. ~~**owner 응답에 manager/hostess payout 개별 노출**~~ — **R28 완료**. per-manager visibility 토글 + per-row 마스킹.
9. ~~**pre-settlement idempotency**~~ — **R28 완료**. 60초 윈도우 중복 차단.
10. ~~**CSP 헤더 부재**~~ — **R28 완료**. next.config.ts.
11. **DB backup 복원 시연 미실시** — 절차성. 운영 작업.
12. **카운터 PC 시계 어긋남** — **부분 완료 (2026-04-30)**. `/api/system/time` + `lib/time/serverClock.ts` (`useServerClock` / `getServerNow`) 추가. 카운터 메인 hook (useRooms) 의 1s tick now + 체크아웃 초과 경고 (useCheckoutFlow) 가 server-adjusted. 정산 금액은 server-side 직접 계산이라 영향 없었음 — UI 표시만 보정. 잔여 156곳 client `Date.now()` 는 표시 영향 미미하므로 다음 라운드.
13. **Phase B 큰 파일 분할** — `CounterPageV2.tsx` (1328줄), `monitor/route.ts` (1076줄) 등. 각 1라운드씩.

## Paper Ledger Reconciliation (R27~R30, 2026-04-25)

종이장부 사진 ↔ NOX 온라인 장부 자동 대조 시스템.

**폴더 분배**:
- `database/092_paper_ledger.sql` — 4 테이블 + RLS
- `lib/reconcile/types.ts | symbols.ts | prompts.ts | extract.ts | paperTotals.ts | dbAggregate.ts | match.ts` — 도메인 로직
- `lib/storage/paperLedgerBucket.ts` — Supabase Storage 헬퍼 (재사용 위치)
- `app/api/reconcile/upload | list | [id] | [id]/extract | [id]/diff | [id]/review | format` — REST
- `app/reconcile/page.tsx | [id]/page.tsx | setup/page.tsx` — UI

**핵심 전략 (사용자 인사이트)**: SUM-anchored Reconciliation. 셀 단위 OCR 정확도에 의존하지 않고 **줄돈/받돈 합계** 가 일치하는지 본다. 합계 일치 = 그날 OK.

**도메인 어휘 (모든 매장 공통 default — `lib/reconcile/symbols.ts`)**:
- ★ = 셔츠, 빨간 동그라미 = 차3, 동그라미 2겹 = 반차3
- (완) = 완티, (반) = 반티, (반차3)/(빵3) = 반차3
- 한자 一/ㅡ = 1, 二/ㅜ = 2 (룸티 또는 타임 카운트)
- 시간 뒤 S = 셔츠
- "이름·매장" → hostess_name + origin_store
- 모르는 심볼 = `unknown_tokens` 배열에 적재 → owner 가 `/reconcile/setup` 에서 등록

**환경 변수**: `ANTHROPIC_API_KEY` 필요 (Claude Vision). 미설정 시 자동 추출만 비활성, 사진 보관/수동 리뷰는 동작.

**비용**: 페이지당 ~$0.003. 14매장 × 2장 × 30일 ≈ $2.5/월.

## Operational Hardening (2026-04-24 추가)

- **archive-on-print** (migration 085): 정산 finalize + 인쇄 완료 시 `archived_at` 스탬프. 모든 active UI 쿼리는 `archived_at IS NULL` 필터. hard delete 아님 (세법 5년 보관 + 분쟁 증빙 유지).
- **cron heartbeat** (migration 090, R24): 4개 Vercel cron 이 시작 시 `cron_heartbeats` 테이블에 stamp. `/ops/watchdog` 이 stale 자동 검출. 사일런트 cron 실패 가시화.
- **에러 경계** (`app/error.tsx`, `app/global-error.tsx`): 한 페이지 크래시가 전체 죽이지 않음.
- **세션 타임아웃** (`lib/security/useIdleLogout.ts`): 30분 무조작 시 자동 로그아웃. 카운터 PC 방치 대응.
- **정산 계산 단위 테스트** (`lib/settlement/services/__tests__/`): 14 시나리오 고정. `npm test`.
- **부하 테스트 스크립트** (`scripts/load-test/`): k6 기반 read-path baseline.

## Protected Calculation Invariants (절대 훼손 금지)

- `lib/session/services/pricingLookup.ts` — DB 미조회 시 **PricingLookupError** 를 던진다. fallback 금액(3만/0 등) 복구 금지.
- `lib/settlement/services/calculateSettlement.ts` — `toNum()` 가드로 NUMERIC string/null/NaN 안전 처리. 이 가드 제거 금지.
- `app/api/sessions/checkin/route.ts` + `app/api/sessions/[session_id]/route.ts` — `manager_membership_id` 를 `store_memberships` 에서 (same store + approved + not-deleted + role=manager) 검증. 이 체크 제거 금지.

## LOCKED - 5층 전체 완료 (2026-04-12)

아래 파일들은 검증 완료. 수정 시 반드시 orchestration 승인 필요.

### Core API Routes (round-072 기준 검증)
- `app/api/auth/login/route.ts` — 로그인 + membership 조회
- `app/api/auth/me/route.ts` — 현재 사용자 정보
- `app/api/auth/memberships/route.ts` — 멀티 멤버십 조회
- `app/api/rooms/route.ts` — 방 목록 + active session
- `app/api/rooms/[room_uuid]/participants/route.ts` — 방별 참여자
- `app/api/sessions/checkin/route.ts` — 체크인 (business_day 자동 생성)
- `app/api/sessions/checkout/route.ts` — 체크아웃
- `app/api/sessions/participants/route.ts` — 참여자 추가 (종목단가 DB조회, 인사확인, origin_store)
- `app/api/sessions/orders/route.ts` — 주문 추가/조회
- `app/api/sessions/settlement/route.ts` — 정산 생성 (서버 계산, 선정산 차감, 타매장 분기)
- `app/api/sessions/settlement/finalize/route.ts` — 정산 확정 (draft→finalized)
- `app/api/sessions/settlement/payment/route.ts` — 결제 방식 (현금/카드/외상/혼합, 카드수수료, 외상 자동등록)
- `app/api/sessions/pre-settlement/route.ts` — 선정산 (요청자+실행자 기록)
- `app/api/sessions/bill/route.ts` — 손님 청구서 (양주/타임/웨이터팁, 내부정산 비노출)
- `app/api/sessions/receipt/route.ts` — 영수증 스냅샷
- `app/api/sessions/participants/[participant_id]/route.ts` — 실장수익 수정
- `app/api/store/staff/route.ts` — 스태프 목록
- `app/api/store/settings/route.ts` — 매장 설정 (card_fee_rate, default_waiter_tip, 영업일 잠금)
- `app/api/store/service-types/route.ts` — 종목별 단가 (영업일 잠금)
- `app/api/store/settlement/overview/route.ts` — 사장 정산 현황
- `app/api/owner/settlement/route.ts` — 사장 정산 (열람 권한 적용, 개별 수익 비노출)
- `app/api/manager/settlement/summary/route.ts` — 실장 정산 요약
- `app/api/manager/hostesses/[hostess_id]/sessions/route.ts` — 아가씨 세션별 참여 내역
- `app/api/me/settlements/route.ts` — 아가씨 본인 정산 (실장수익 비노출)
- `app/api/credits/route.ts` — 외상 등록/목록 (3종 구조)
- `app/api/credits/[credit_id]/route.ts` — 외상 상세/상태변경
- `app/api/cross-store/settlement/route.ts` — 타매장 정산 (origin_store 기준)
- `app/api/operating-days/close/route.ts` — 영업일 마감 (draft 경고 + force)
- `app/api/transfer/request/route.ts` — 이적 요청
- `app/api/reports/daily/route.ts` — 일일 리포트
- `app/api/chat/rooms/route.ts` — 채팅방 생성/목록 (global/room/direct)
- `app/api/chat/messages/route.ts` — 채팅 메시지 전송/조회
- `app/api/chat/unread/route.ts` — 채팅 unread 합계
- `app/api/inventory/items/route.ts` — 재고 품목 CRUD
- `app/api/inventory/items/[item_id]/route.ts` — 품목 수정/삭제
- `app/api/inventory/transactions/route.ts` — 입출고 처리/이력
- `lib/auth/resolveAuthContext.ts` — 인증 (membership status 분리 검증)
- `lib/offline/sync.ts` — 오프라인 동기화 (새 엔드포인트 반영)

### Frontend Pages (검증 완료)
- `app/counter/page.tsx` — 카운터 대시보드
- `app/counter/[room_id]/page.tsx` — 카운터 룸 (선정산/청구서/결제 버튼)
- `app/counter/[room_id]/payment/page.tsx` — 결제 방식 입력
- `app/counter/[room_id]/pre-settlement/page.tsx` — 선정산 UI
- `app/counter/[room_id]/bill/page.tsx` — 손님 청구서 (밝은 테마, 인쇄)
- `app/settlement/page.tsx` — 정산 페이지 (role별 API 분기)
- `app/manager/settlement/page.tsx` — 실장 정산 목록
- `app/manager/settlement/[hostess_id]/page.tsx` — 실장별 아가씨 개별 정산 입력
- `app/owner/settlement/page.tsx` — 사장 정산 현황 (열람 권한 적용)
- `app/me/settlements/page.tsx` — 아가씨 본인 정산 조회 (읽기 전용)
- `app/credits/page.tsx` — 외상 관리 (목록/등록/회수/취소)
- `app/chat/page.tsx` — 채팅방 목록 (글로벌 자동참여, DM 생성)
- `app/chat/[chat_room_id]/page.tsx` — 채팅 메시지 (Supabase Realtime)
- `app/inventory/page.tsx` — 재고 관리 (품목/입출고/저재고 경고)
- `app/operating-days/page.tsx` — 영업일 마감 (draft 경고 + 강제 마감)
- `app/owner/page.tsx` — 사장 대시보드
- `app/manager/page.tsx` — 실장 대시보드
- `app/me/page.tsx` — 아가씨 대시보드
- `app/staff/page.tsx` — 스태프 관리

### DB Migrations (003~009)
- `database/003_credits.sql` — 외상 테이블
- `database/004_payment.sql` — 결제 방식 컬럼
- `database/005_chat.sql` — 채팅 테이블 (rooms/participants/messages)
- `database/006_pre_settlements.sql` — 선정산 테이블
- `database/007_inventory.sql` — 재고 테이블 (items/transactions)
- `database/008_business_rules.sql` — 웨이터팁/인사확인 컬럼
- `database/009_cross_store_settlement.sql` — 타매장 정산 테이블

### 검증 기록
- tsc --noEmit: 0 errors
- E2E Step 1~4: 인증→방조회→체크인→참여자→주문→체크아웃→정산→결제→외상→선정산→채팅→재고→청구서→마감경고→설정잠금
- 비즈니스 규칙 적용: 종목별 단가 DB조회, 인사확인, 영업일 잠금, 사장 열람 권한, 타매장 origin_store 분기
- 오프라인 동기화: 새 엔드포인트 4종 추가, 금지 타입 3종 추가

---

## 스킬 정의 (Skills)

### skill-01: schema-validator
적용 시점: DB 쿼리 작성 전 항상 실행
규칙:
- store_uuid 가 WHERE 조건에 반드시 포함되어야 함
- numeric store_id 사용 감지 시 즉시 reject
- deleted_at IS NULL 조건 누락 시 경고
- membership_id 없이 인원 식별 시 reject

### skill-02: session-resolver
적용 시점: session 관련 코드 작성 전
규칙:
- session_id = runtime 기준 SSOT
- room_uuid = canonical room identity (변경 불가)
- room_no = display only (식별자로 사용 금지)
- session_id 없이 room 접근 시 차단
- active_session_id를 room_uuid로 혼용 금지

### skill-03: role-guard
적용 시점: 페이지/API 생성 전
규칙:
- 모든 페이지는 role 가드 필수
- owner   → /owner
- manager → /manager
- hostess → /me
- counter → /counter
- 미승인(status != approved) → 401
- deleted_at IS NULL 조건 필수

### skill-04: error-classifier
적용 시점: 오류 발생 시
분류:
1. 도메인 규칙 위반
   → store_uuid 누락, numeric store_id 사용,
      room_no 식별자 사용, membership_id 누락
   → 즉시 reject + 사유 명시
2. 런타임 오류
   → API 응답 오류, DB 연결 오류
   → fallback 처리 후 보고
3. UI 오류
   → 렌더링 오류, 상태 누락
   → 해당 상태만 수정

---

## 에이전트 구조 (Agents)

### PLANNER (계획자)
역할: 작업 요청 수신 후 실행 전 반드시 수행
체크리스트:
- [ ] 수정할 파일 1개 명시
- [ ] 도메인 규칙 충돌 여부 확인
- [ ] skill-01 schema-validator 실행
- [ ] skill-02 session-resolver 실행
- [ ] skill-03 role-guard 확인
- [ ] 확인 안 되는 것은 질문 (추측 금지)
- [ ] 승인 후 EXECUTOR에게 전달

### EXECUTOR (실행자)
역할: PLANNER 승인된 파일만 수정
체크리스트:
- [ ] 단일 파일만 수정
- [ ] 확인된 API 응답 필드만 사용
- [ ] 추측으로 필드명 작성 금지
- [ ] numeric store_id 사용 금지
- [ ] 공용 컴포넌트 분리 금지
- [ ] 완료 후 VALIDATOR에게 전달

### VALIDATOR (검증자)
역할: 수정된 코드 도메인 규칙 위반 검증
체크리스트:
- [ ] store_uuid scope 확인 (skill-01)
- [ ] session_id SSOT 확인 (skill-02)
- [ ] role 가드 존재 확인 (skill-03)
- [ ] numeric store_id 미사용 확인
- [ ] room_no 식별자 미사용 확인
- [ ] membership_id 기준 인원 식별 확인
- [ ] 위반 발견 시 즉시 reject + 사유 명시
- [ ] 통과 시 결과 요약 보고

---

## 작업 흐름 (매 작업마다 반드시 준수)

1. 요청 수신
2. PLANNER 체크리스트 실행
3. 파일 1개 확정 + 규칙 충돌 없음 확인
4. EXECUTOR 실행
5. VALIDATOR 검증
6. 통과 → 결과 요약
7. 실패 → reject + 사유 → 2번으로 돌아감
