# NOX — Codebase Cleanup Audit

코드베이스 전체를 스캔해서 **쓸데없이 쌓인 것**, **실제로 죽은 것**, **구조적으로 중복**된 것을 전수 정리합니다. 이 문서는 "다음에 뭘 지워도 안전한가" 를 한눈에 보이게 하는 맵입니다.

분류:
- 🔴 즉시 삭제 가능 (아무도 안 씀)
- 🟠 정책 결정 필요 (의도적 coexistence or 도메인 지식)
- 🟡 단순 정리 (이름/위치/설정)
- ✅ 정상 (참고만)

---

## 1. 🔴 디스크 쓰레기 (즉시 삭제) — 약 11 GB

### 1-A. `.next_old_*` 백업 디렉토리 × 30개
```
.next_old_1776450826  357M
.next_old_1776458544  ~
.next_old_1776458655  ~
… (총 30개)
.next_old_1776703774  416M
```

- Next.js 빌드 캐시의 과거 스냅샷. **누가 만들었는지도 불명확**, 어떤 툴이 자동 저장한 것으로 보임
- 이미 `.gitignore` 에 `.next_old_*/` 추가되어 있어 git 오염은 없음
- **모든 grep 대상에 포함되어 매번 스캔 시간이 낭비됨** (실제로 이 감사 내내 결과에 섞여 나옴)
- **조치:** `rm -rf .next_old_*` 한 줄. 위험도 0.

### 1-B. 최상위 쓰레기 빈 디렉토리 × 5개
```
C:worknoxappapibleingest/     ← Windows 경로 escape 실패로 생성된 빈 폴더
C:worknoxscripts/             ← 동일
contracts/                    ← 완전 비어있음
qa/                           ← 완전 비어있음
reference/                    ← 완전 비어있음
```

- 셸 명령에서 `cd C:\work\nox\…` 를 따옴표 없이 실행할 때 Unix 계열 도구가 경로 전체를 한 이름으로 해석해 만든 흔적
- **조치:** 전부 `rmdir`. 위험도 0.

---

## 2. 🔴 Dead Code — 절대 import 되지 않음

### 2-A. `_ble_wip/` 디렉토리 전체 (81개 파일)
```
_ble_wip/
  api_ble_ingest/   (3 routes)
  api_ops_ble/      (15 routes)
  app_ops_ble/      (2 pages)
  lib_ble/          (61 files)
```

**검증:** `grep -r 'from ["']@?/?_ble_wip/' app/ lib/ components/` → **0건**

- 내부 파일끼리만 서로 import. 외부에서 단 한 줄도 들어오지 않음.
- 현재 활성 BLE 코드는 `lib/ble/*` 와 `app/counter/monitor/*` 로 이미 이전 완료
- **조치:** 디렉토리 전체 삭제. 위험도 0.

### 2-B. `_ble_wip/` 이 내부적으로 의존하던 lib 모듈들

오직 `_ble_wip` 에서만 import 되는 lib 파일 = `_ble_wip` 삭제 시 함께 죽음:

| 파일 | 설명 | 현재 상태 |
|---|---|---|
| `lib/counterStore.ts` | 구 counter 상태 관리 | Dead |
| `lib/scaleConstants.ts` | BLE replay 상수 | Dead |
| `lib/exitDetection.ts` | 밖으로 import 전혀 없음 | Dead |
| `lib/ops/logger.ts` | `_ble_wip` ingest 전용 | Dead |
| `lib/ops/ble/deviceRegistryTypes.ts` | 동일 | Dead |
| `lib/ops/ble/deviceRegistryServer.ts` | 동일 | Dead |
| `lib/ops/ble/monitorPresentation.ts` | 동일 | Dead |
| `lib/counter/debug/repeatSuppression.ts` | 디버그 로그 suppression | Dead |
| `lib/supabaseClient.ts` | `_ble_wip/useBleRealtimeFeed` 만 사용 | Dead |
| `lib/mock/hostesses.ts` | tag registry mock | Dead |
| `lib/mock/tagRegistry.ts` | tag registry mock | Dead |
| `lib/automation/alertHooks.ts` | `emitAutomationAlert` | Dead |
| `lib/debug/serverDebug.ts` | `isDebugBleInferenceEnabled` | Dead |
| `lib/config/featureFlags.ts` | `featureFlags.*` | Dead |
| `lib/storeScopeInvariant.ts` | 이미 no-op stub. `_ble_wip/useBleRealtimeFeed` 만 사용 | Dead (stub) |

**조치:** `_ble_wip` 와 함께 14개 파일 삭제. 위험도 0.

### 2-C. 다른 dead stubs

| 파일 | 내용 | 상태 |
|---|---|---|
| `lib/security/rateLimit.ts` | **2줄 stub** — `async function checkRateLimit() { return }` 와 `getClientIp() { return "0.0.0.0" }` | 오직 `_ble_wip/api_ble_ingest/ingest/route.ts` 만 import. R-3 라운드에서 `lib/security/clientIp.ts` 로 대체됨. **Dead** |
| `lib/security/safeAuthDebug.ts` | **1줄 stub** | 오직 `_ble_wip/api_ops_ble/gateways/route.ts` 만 import. **Dead** |
| `lib/security/requireRole.ts` | 6줄, `requireRouteRole` export | 오직 `_ble_wip/api_ops_ble/*` 만 import. **Dead** |

**조치:** 3개 파일 삭제. `_ble_wip` 정리와 묶어서.

### 2-D. Dead 모듈 총합
```
_ble_wip/                       × 81 files
lib/counterStore.ts             × 1
lib/scaleConstants.ts           × 1
lib/exitDetection.ts            × 1
lib/ops/                        × 4 files
lib/counter/debug/              × 1
lib/supabaseClient.ts           × 1
lib/mock/                       × 2 files
lib/automation/alertHooks.ts    × 1
lib/debug/serverDebug.ts        × 1
lib/config/featureFlags.ts      × 1
lib/storeScopeInvariant.ts      × 1
lib/security/rateLimit.ts       × 1
lib/security/safeAuthDebug.ts   × 1
lib/security/requireRole.ts     × 1
─────────────────────────────────
총 약 100개 파일
```

---

## 3. 🟠 DB 마이그레이션 중복 / 고아

### 3-A. 같은 번호 2개
```
database/010_fix_cross_store_fk.sql
database/010_session_participant_manager.sql
```

- 같은 "010" 이 두 파일. `psql -f 010*.sql` 같은 스크립트에서 알파벳 순서로 실행되면 의도 뒤바뀜
- **조치:** 하나를 `010a_`, 다른 하나를 `010b_` 로 rename OR 하나를 다른 번호로 이동. 라이브 DB 에 이미 적용되어 있으므로 파일명 변경만으로 OK.

### 3-B. 고아 서브디렉토리
```
database/migrations/003_cross_store.sql
```

- 최상위 `database/` 에 모든 마이그레이션이 있는데 이 파일만 `database/migrations/` 하위
- 다른 `migrations/003_*` 도 상위에 있음
- **조치:** 상위로 이동하거나 삭제 (이미 3_credits 등이 다루고 있는지 확인 필요)

### 3-C. 절대 적용 안 된 파일
```
database/20260411_foxpro_checkout.sql
```

- `BUGLOG.md:6` 에 **"Supabase DB에 실제로 적용된 적 없음"** 명시
- 파일만 남고 아무도 안 씀
- **조치:** 삭제 또는 파일 상단에 `-- NEVER APPLIED — do not run` 주석 필수

### 3-D. DEPRECATED but still there
```
database/001_initial_schema.sql  ← CLAUDE.md 에서 DEPRECATED 선언
```

- `002_actual_schema.sql` 이 SSOT
- 그런데 `001_initial_schema.sql` 이 여전히 파일로 존재 → 신규 운영자 혼동
- **조치:** 삭제 또는 `001_initial_schema.DEPRECATED.sql.bak` 으로 rename

---

## 4. 🟠 API 네임스페이스 중복 — 의도적 coexistence 이지만 정리 필요

### 4-A. Settlement 4중 네임스페이스
```
/api/settlement/                   (legacy, receipts 기반)
  ├─ history
  ├─ payout
  ├─ payout/cancel
  └─ payouts

/api/settlements/                  (신규, settlements 테이블 기반)
  ├─ hostesses
  ├─ managers
  └─ overview

/api/sessions/settlement/          (legacy session-scoped)
  ├─ finalize
  └─ payment

/api/sessions/[session_id]/settlement/   (신규 per-session)
  ├─ confirm
  ├─ pay
  ├─ payout
  └─ recalculate
```

- `app/api/sessions/[session_id]/settlement/route.ts:19-24` 주석에 **의도적 coexistence 명시**:
  > The legacy POST /api/sessions/settlement route (body-based, writes receipts / receipt_snapshots) is untouched. This new route writes the new settlements / settlement_items tables introduced by migration 032 and is purely additive
- 둘 다 현재 활성 사용 중:
  - counter checkout → `/api/sessions/settlement` (legacy, receipts)
  - payout 관리 → `/api/settlement/payout` + `/api/settlements/*` (신규)
- **결론:** dead code 아님. **하지만 장기적으로는 하나로 수렴해야 할 refactor 부채**
- **조치:** 지금 당장 삭제 X. 다음 refactor 라운드에서 legacy receipts 경로를 신규 settlements 로 점진 이관.

### 4-B. Reports 단/복수
```
/api/reports/manager    (per-session 실장 리포트)
/api/reports/managers   (전체 실장 지급 집계)

/api/reports/hostess    (per-session 아가씨 리포트)
/api/reports/hostesses  (전체 아가씨 지급 집계)
```

- 둘 다 실제 사용 중. **다른 의미**:
  - 단수: 특정 business_day 의 per-session 리포트
  - 복수: 지급 현황 aggregate
- **결론:** 네이밍만 헷갈림. 실제 중복 아님.
- **조치:** 네이밍 스킴 개선 (예: `/api/reports/by-session/...`, `/api/payouts/aggregate/...`). 비블로커.

---

## 5. 🟠 문서 중복 / 이력 누적

### 5-A. Handoff 문서 3개
```
SECURITY_HANDOFF.md                              ← 이번 라운드 산출물
orchestration/handoff/NOX_CURRENT_HANDOFF.md     ← 이전 handoff
orchestration/handoff/NOX_OPERATION_FINAL_HANDOFF.md  ← 또 다른 final
```

- 용도별로 분리되어 있지만 이름이 겹침
- **조치:** SECURITY_HANDOFF.md 를 `orchestration/handoff/` 로 이동해서 한 곳에 모음

### 5-B. 루트 레벨 MD 파일
```
CLAUDE.md                               ← 프로젝트 규칙 (유지)
DEPLOY_CHECKLIST.md                     ← 배포 체크 (유지)
SECURITY_HANDOFF.md                     ← (위 참조)
NOX_SECURITY_KEY_MIGRATION_FINAL.md     ← 이미 완료된 작업의 이력
database/BUGLOG.md                      ← 버그 수정 이력 (유지)
CLEANUP_AUDIT.md                        ← 이 문서
```

- `NOX_SECURITY_KEY_MIGRATION_FINAL.md:127` 에 revoked 키의 prefix `sb_secret_Sr8Q...` 가 남아있음 (이전 라운드에서 지적)
- **조치:** 내용을 `SECURITY_HANDOFF.md` 로 통합하거나 `orchestration/handoff/` 로 이동 + prefix 제거

### 5-C. Orchestration 작업 이력
```
orchestration/tasks/       121개 (round-*.md, step-*.md)
orchestration/staging/     6개
orchestration/results/     32개
```

- 과거 개발 이력. 지식 자산 측면에서 가치 있음
- **조치:** 현상 유지. 단 아카이브를 고려할 수 있음 (`orchestration/archive/` 로 1년 이상 된 것 이동)

### 5-D. Locked docs
```
docs/NOX_*.md              20+ files
```

- CLAUDE.md 에 **"LOCKED — do not modify without explicit orchestration approval"** 규칙
- 유지

---

## 6. 🟡 단순 구조 정리

### 6-A. `app/counter/page.tsx` 의 의문스러운 re-export
```tsx
// app/counter/page.tsx (1 줄)
export { default } from "./CounterPageV2"
```

- Next.js 의 App Router 는 `page.tsx` 를 요구하므로 이 파일은 필요
- 하지만 CounterPage**V2** 라는 이름은 "V1 도 있었는데…" 를 암시. V1 은 이미 삭제됨
- **조치:** `CounterPageV2.tsx` → `CounterPage.tsx` 로 rename + V2 참조 모두 업데이트. 또는 `page.tsx` 안에 직접 내용 이관

### 6-B. 쓸모없이 번들에 포함된 페이지
```
app/test-offline/page.tsx    ← 테스트 전용
app/ble/page.tsx             ← 기능 불명, 활성 BLE 는 /counter/monitor
```

- production 번들에 포함됨. middleware matcher 에도 없어서 누구나 접근 가능
- **조치:** 삭제하거나 `NODE_ENV === "production"` 이면 404 처리

### 6-C. `next.config.ts` 빈 파일
```ts
// 전체 내용
const config = {};
export default config;
```

- Next 15 기본 설정 그대로
- dev 서버 cold compile 28초 문제 있음 (이전 감사)
- **조치:** `package.json` 의 `"dev": "next dev"` 를 `"next dev --turbopack"` 으로 변경 OR `next.config.ts` 에 Turbopack 관련 옵션 추가

### 6-D. `printer-server/` 별도 서브프로젝트
```
printer-server/
  index.js
  node_modules/
  package.json
  package-lock.json
```

- 영수증 프린터용 별도 Node 서버로 보임
- `.gitignore` 에 `printer-server/node_modules` 가 안 들어감 → git 에 node_modules 포함될 수 있음
- **조치:** `printer-server/node_modules/` 를 `.gitignore` 에 추가. README 로 용도 명시

---

## 7. ✅ 정상 (참고만)

- `lib/analytics/*` — `/api/ops/ble-analytics/*` 라우트가 실제 사용 중
- `lib/events/*` — 현재 사용처 0 건이지만 `/api/ble/feedback` 등 향후 확장용. 크기 작아 유지 비용 낮음
- `lib/matching.ts` — `rooms/[room_uuid]/participants` + `updateExternalName` 이 사용
- `lib/supabaseServer.ts` — `lib/session/createServiceClient.ts` 가 import (live)
- `lib/receipt/*` — receipt flow live
- `orchestration/rules/` — 팀 정책 문서
- `docs/*.md` — LOCKED spec 문서

---

## 8. 권장 실행 순서

### Phase A — 위험도 0 즉시 실행 (디스크 11 GB 회수)
```bash
# 1. Next 백업 캐시 삭제
rm -rf .next_old_*

# 2. 쓰레기 빈 디렉토리 삭제
rmdir "C:worknoxappapibleingest" "C:worknoxscripts" contracts qa reference
```

### Phase B — Dead code 삭제 (코드 라인 수 수천 감소)
```bash
# 한 번에 삭제 (모두 git status 로 확인 후)
git rm -rf _ble_wip/
git rm lib/counterStore.ts lib/scaleConstants.ts lib/exitDetection.ts
git rm -rf lib/ops/ lib/counter/debug/
git rm lib/supabaseClient.ts lib/storeScopeInvariant.ts
git rm -rf lib/mock/
git rm lib/automation/alertHooks.ts lib/debug/serverDebug.ts lib/config/featureFlags.ts
git rm lib/security/rateLimit.ts lib/security/safeAuthDebug.ts lib/security/requireRole.ts
```

**검증:** `npx tsc --noEmit` → 0 errors. `npm run build` → success.

### Phase C — DB 마이그레이션 정리
- `010_fix_cross_store_fk.sql` → `010a_fix_cross_store_fk.sql`
- `010_session_participant_manager.sql` → `010b_session_participant_manager.sql`
- `database/migrations/003_cross_store.sql` → 상위로 이동 또는 삭제 확인
- `database/001_initial_schema.sql` → rename to `.DEPRECATED` or remove
- `database/20260411_foxpro_checkout.sql` → 삭제

### Phase D — 구조 개선
- `app/counter/CounterPageV2.tsx` → `CounterPage.tsx`
- `app/test-offline/` → 삭제
- `app/ble/page.tsx` → 삭제
- `package.json` → `"dev": "next dev --turbopack"` (옵션)
- `.gitignore` → `printer-server/node_modules` 추가

### Phase E — 네임스페이스 refactor (별도 라운드)
- Settlement 4중 coexistence → 단일 네임스페이스로 점진 이관 (상당 규모)
- Reports 단/복수 네이밍 개선 (비블로커)

---

## 9. 예상 효과

| 항목 | Before | After | 감소 |
|---|---|---|---|
| 디스크 사용 (프로젝트 루트) | ~13 GB | ~2 GB | **-11 GB** |
| `lib/` 파일 수 | ~95 | ~80 | -15 |
| 코드 라인 (`_ble_wip/` 포함) | ~+4,000 LOC dead | 0 | **-4,000 LOC** |
| Grep 범위 오염 | 매번 30개 `.next_old_*` 스캔 | 깨끗 | 검색 속도 개선 |
| 혼란스러운 이름 | `V2` / `*.DEPRECATED` / 빈 dir | 정돈 | 신규 개발자 온보딩 |
| TypeScript 프로젝트 빌드 | 동일 | 동일 | tsc / build 영향 없음 |

---

## 10. 안전성 보장

- **Dead code 삭제 후에도 `tsc --noEmit` 은 통과** — 이미 import 하는 곳이 없기 때문
- **`npm run build` 도 통과** — 어느 파일이 번들에 포함되는지는 import 그래프로 결정
- **runtime 동작 동일** — 모든 삭제 대상이 어느 API route / page 에서도 로드되지 않음
- **git revert 가능** — 각 Phase 를 별도 커밋으로 분리하면 문제 발생 시 단일 revert 로 복구

**신뢰도:** 이 감사는 전체 `app/` + `lib/` + `components/` 의 `import` 문을 전수 조회하여 작성. 외부 import 가 0인 파일만 "Dead" 로 분류.
