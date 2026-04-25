# NOX — Counter OS for Hostess Clubs

한국 유흥업소 운영 관리 시스템. 종이 장부에서 온라인으로 전환되는 시점의 보조/검증 도구이자, 점차 단독 운영 가능한 OS 로 발전.

## Tech

- **Next.js 15** (App Router) + **React 19** + **TypeScript 5**
- **Supabase** (PostgreSQL + Auth + Realtime)
- **Tailwind CSS 4**
- **Vitest** (unit) + **Playwright** (E2E) + **k6** (load)
- **Sentry** (error tracking, optional)
- **Anthropic Claude Sonnet** (종이장부 OCR, optional)

## Quick start

```bash
npm i
cp .env.example .env.local           # 채울 항목은 아래 환경변수 섹션 참조
npm run dev
```

## Commands

```bash
# 개발
npm run dev          # dev 서버
npm run build        # production 빌드
npm run lint         # next lint
npm run start        # production 실행

# 테스트
npm test             # vitest unit 테스트 (~200 tests)
npm run test:watch   # 감시 모드

# E2E
npm run e2e:install  # 최초 1회 — chromium 다운로드
npm run e2e          # smoke + auth + issue-report
npm run e2e:ui       # UI 모드 (디버깅)

# 부하 테스트 (k6 설치 필요)
$env:BASE_URL = "https://staging.example.com"
$env:TOKEN = "<test_user_jwt>"
npm run load:read
npm run load:lifecycle

# 정리
npm run cleanup:audit
npm run cleanup:knip
```

## 주요 환경 변수

| 키 | 필수 | 설명 |
|---|:-:|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✓ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓ | Anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | Service-role (서버만) |
| `SUPABASE_JWT_SECRET` | ✓ | JWT 검증 |
| `MFA_SECRET_KEY` | ✓ | 32 byte base64. TOTP secret 암호화 |
| `CRON_SECRET` | ✓ | Vercel cron 보호 |
| `TELEGRAM_BOT_TOKEN` |  | 감시봇 알림 (선택) |
| `TELEGRAM_CHAT_ID` |  | 감시봇 알림 (선택) |
| `SENTRY_DSN` |  | 서버 측 에러 트래킹 (선택) |
| `NEXT_PUBLIC_SENTRY_DSN` |  | 클라이언트 측 에러 트래킹 |
| `ANTHROPIC_API_KEY` |  | 종이장부 OCR (선택) |

배포 직전 체크리스트는 `DEPLOY_CHECKLIST_R20.md` 참조.

## 폴더 구조

```
app/                       Next.js App Router
  api/                     REST endpoints (route.ts)
    sessions/, rooms/, settlement/, transfer/, ...
  counter/                 카운터 화면 (메인 운영 UI)
    components/{modals,cards,layouts}/
    monitor/components/{panels,badges,ble,nav}/
    hooks/, services/, widgets/
  owner/, manager/, me/    role 별 대시보드
  reconcile/               종이장부 ↔ NOX 대조 (R27~R30)
  ops/                     관리자 도구 (watchdog, issues, errors)

components/                전역 재사용 컴포넌트 (모달, 토스트, 백 버튼)
lib/                       도메인 로직
  auth/                    인증 / 권한
  session/                 세션 lifecycle / matching / archive
  settlement/              정산 계산 (PURE — 단위 테스트 우선)
  reconcile/               종이장부 도메인 (PURE)
  server/queries/{manager,me,staff,store,ops}/  도메인별 SQL helpers
  ble/, monitor/           BLE 위치 / 모니터 도메인
  security/                MFA, backup codes, rate limit
  automation/              cron heartbeat, alert hooks
  time/                    KST businessDate 헬퍼

database/                  SQL migrations (00X 부터 09X 까지)
  002_actual_schema.sql    초기 스키마 (참조 전용)
  09X_*.sql                R24~R28 보강 (heartbeat, retention, paper ledger 등)

middleware.ts              role 기반 라우트 가드
next.config.ts             보안 헤더 (CSP/HSTS/Frame 등)
instrumentation.ts         Sentry 초기화
```

## 도메인 핵심 규칙 (절대 위반 금지)

상세는 `CLAUDE.md` 참조. 요약:

1. **store_uuid 스코프** — 모든 query 에 store_uuid 필수
2. **business_date** — 영업일 기준 (자정 넘는 세션은 시작일에 귀속). `lib/time/businessDate.ts` 사용
3. **server-side 정산** — 클라가 보낸 금액 절대 신뢰 X
4. **종목별 단가** — DB `store_service_types` 에서만 조회. 하드코딩 금지
5. **Cross-store** — origin_store_uuid 영구 귀속
6. **Owner 가시성** — manager_payout / hostess_payout 개별 노출 금지 (per-manager `show_*_to_owner` 토글로만)
7. **Audit log** — 모든 mutation, PII read 도 기록

## 운영 모니터링

- `/ops/watchdog` — 종합 감시 (cron / 에러 / auth 이상 / 데이터 이상 / 이슈 / DB 헬스)
- `/ops/issues` — 사용자 신고 (A/S 버튼)
- `/ops/errors` — 시스템 에러 로그 (system_errors 테이블)

## 개발 가이드

- 단일 파일 변경 원칙 (작은 PR)
- TypeScript `--noEmit` clean 강제
- 모든 mutation 은 `auth.role` 가드 + `audit_events` insert
- 모든 매장 스코프 query 는 `store_uuid` 필터
- KST 시간이 필요하면 `getBusinessDateForOps()` 사용 (절대 `new Date().toISOString().split("T")[0]` 사용 금지 — UTC 버그)
- 비밀번호 / TOTP secret / 백업 코드 평문은 절대 로그/audit 에 안 남김

## 라이센스

Private — 내부 개발용.
