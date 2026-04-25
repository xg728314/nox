# NOX 배포 체크리스트 (R1~R20 최종, 2026-04-25)

> 기존 `DEPLOY_CHECKLIST.md` 는 R1~R7 시점 문서. 이 파일이 **최신 기준**.

## 🔴 BLOCKER — 배포 전 반드시

### 1. Vercel Environment Variables 설정
Settings → Environment Variables (Production):

```
# 기존 필수
NEXT_PUBLIC_SUPABASE_URL=<project.supabase.co>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon>
SUPABASE_SERVICE_ROLE_KEY=<service-role>
SUPABASE_JWT_SECRET=<jwt-secret>
MFA_SECRET_KEY=<32자 랜덤>

# 신규 필수 (R7/R15 에서 추가 — 배포 전 반드시)
CRON_SECRET=<32자 랜덤>           # Vercel Cron 보호
TELEGRAM_BOT_TOKEN=<봇 토큰>      # 감시봇 알림
TELEGRAM_CHAT_ID=<chat id>        # 감시봇 알림
```

**검증**: 배포 후 `/ops/watchdog` 접속 → "Telegram ✓ 활성" → **테스트 알림** 클릭 → Telegram 수신.

### 2. DB Migration 전수 확인 (한번에)

```sql
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'membership_bank_accounts') AS m024,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'credits' AND column_name = 'linked_account_id') AS m025,
  (SELECT count(*) FROM information_schema.table_constraints WHERE constraint_name = 'rooms_floor_no_range_chk') AS m083,
  (SELECT count(*) FROM pg_constraint WHERE conname = 'cssi_header_fk') AS m084,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'receipts' AND column_name = 'archived_at') AS m085,
  (SELECT count(*) FROM pg_indexes WHERE indexname = 'idx_sp_store_status_active') AS m086,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'store_settings' AND column_name = 'monthly_rent') AS m087,
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'issue_reports') AS m088,
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'system_errors') AS m089,
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'cron_heartbeats') AS m090,
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'audit_events_archive') AS m091,
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'paper_ledger_snapshots') AS m092,
  (SELECT count(*) FROM pg_indexes WHERE indexname = 'uq_room_active_session') AS m093,
  (SELECT count(*) FROM information_schema.views WHERE table_name = 'v_index_usage') AS m094,
  (SELECT count(*) FROM information_schema.columns WHERE table_name='store_settings' AND column_name='attendance_period_days') AS m095a,
  (SELECT count(*) FROM information_schema.columns WHERE table_name='store_settings' AND column_name='monthly_rent') AS m095b,
  (SELECT count(*) FROM information_schema.columns WHERE table_name='store_settings' AND column_name='liquor_target_mode') AS m095c,
  (SELECT count(*) FROM information_schema.columns WHERE table_name='cross_store_settlements' AND column_name='confirmed_at') AS m096,
  (SELECT count(*) FROM information_schema.columns WHERE table_name='cross_store_settlements' AND column_name='tree_stage') AS m097,
  (SELECT count(*) FROM information_schema.tables WHERE table_name='settlement_tree_user_hides') AS m098;
```

**모든 값이 1.** 0 있으면 해당 migration 적용 (`090` R24, `091` R26, `092` R27, `095` R29 신규 — store_settings 컬럼 보강).

### Storage 버킷 — paper-ledgers (R27)
Supabase Dashboard → Storage → New bucket:
- name: `paper-ledgers`
- public: **off**
- file size limit: 10 MB
- allowed MIME: `image/jpeg, image/png, image/heic, image/webp`

### 환경 변수 추가 — ANTHROPIC_API_KEY (R28)
```
ANTHROPIC_API_KEY=<sk-ant-...>   # 종이장부 자동 추출용 (Vision API)
```
미설정 시 `/api/reconcile/[id]/extract` 가 503 반환. 종이장부 사진 보관/수동 리뷰 기능은 동작.

### 3. store_service_types 완전성 (각 매장 9개)

```sql
SELECT s.store_name, COUNT(sst.id) as count
FROM stores s
LEFT JOIN store_service_types sst ON sst.store_uuid = s.id AND sst.is_active = true
WHERE s.is_active = true
GROUP BY s.id, s.store_name
HAVING COUNT(sst.id) < 9;
```

**비어있어야 함.** 9개 미만 매장은 체크인 에러.

### 4. 레거시 시뮬 데이터 정리 (실운영 전)

```sql
-- 24시간 이상 active 상태인 시뮬 세션 강제 종료
UPDATE room_sessions
SET status = 'closed', ended_at = now()
WHERE status = 'active'
  AND started_at < now() - interval '24 hours'
  AND archived_at IS NULL;

-- draft 영수증 중 시뮬 세션 연결된 것 삭제 고려 (데이터 오염 방지)
-- 주의: 실운영 데이터와 혼재 시 신중하게.
```

---

## 🟡 배포 후 24시간 내

### 5. 감시 대시보드 모니터링
- `/ops/watchdog` — 5분 자동 갱신. 빨간 점 뜨면 즉시 확인
- `/ops/errors` — 런타임 에러. 3건 이상 쌓이면 원인 분석
- `/ops/issues` — 실장 신고. 매 아침 트리아지

### 6. E2E 수동 검증 (최소 1회)
```
빈 방 선택 → 실장 배정 → 손님 정보 →
스태프 4명 (일괄 추가) → 주문 2건 →
연장 1회 → 체크아웃 (스와이프) →
정산 생성 → 정산 확정 → 결제 (혼합) →
청구서 인쇄 → Archive
```

각 단계 에러 0 = 통과.

### 7. 역할별 로그인 테스트
- owner 계정: 사이드바 13개 메뉴 전부 클릭 → 각 페이지 로딩
- manager 계정: 제한된 메뉴만 보이는지 + 자기 매장 데이터만
- staff 계정: /me 접근, /counter 접근 불가

### 8. 🐞 신고 버튼 verify
- **미로그인 상태**: 버튼 안 보여야 함 (R18-1)
- 로그인 후: 버튼 표시 → 테스트 이슈 1건 → `/ops/issues` 에서 확인

---

## 🟢 1주일 내 / 선택 사항

### 9. 외부 감시봇 cron 등록 (선택)
`monitoring/bots/*.mjs` 5종을 ops 서버의 cron 또는 systemd 로:
```cron
*/5 * * * * node /opt/nox/monitoring/bots/nox-security-watch.mjs
*/5 * * * * node /opt/nox/monitoring/bots/nox-db-guardian.mjs
```

### 10. 부하 테스트 (선택)
```powershell
$env:BASE_URL = "https://<preview>.vercel.app"
$env:TOKEN    = "<test_token>"
k6 run scripts/load-test/k6-counter-read.js
```
판정: p95 < 800ms, p99 < 2s, error rate < 1%

### 11. E2E 자동 테스트 (R23, 권장)

```bash
npm run e2e:install        # 최초 1회 — chromium 다운로드
npm run e2e                # smoke + auth + issue-report (~30초)
npm run e2e:ui             # 디버깅용 (실패 추적)
```

CI / 배포 직전 게이트로 사용. 시드 계정 활용 시 환경 변수:

```bash
export E2E_OWNER_EMAIL=marvel-owner@nox-test.com
export E2E_OWNER_PASSWORD=Test1234!
export E2E_MANAGER_EMAIL=marvel-mgr2@nox-test.com
export E2E_MANAGER_PASSWORD=Test1234!
```

**금지**: `BASE_URL=https://...vercel.app npm run e2e` (production 대상). counter-flow
는 자동 거부. owner/manager 로그인은 production credential 절대 사용 금지.

### 12. Sentry 연결 (권장)
`npm i @sentry/nextjs` → `instrumentation.ts` 에서 init → `captureException` 이 자동 라우팅. 현재는 DB + console 만.

---

## 📋 정상 지표 (배포 후)

| 지표 | 기준 | 조회 경로 |
|---|---|---|
| 전체 상태 | ✅ 정상 | /ops/watchdog |
| API p95 | < 800ms | Vercel Logs |
| 에러율 | < 0.1% | /ops/errors |
| 로그인 실패 | < 5/분 | /ops/watchdog |
| 미체크아웃 6h+ | 0건 | /ops/watchdog |
| 실장 미지정 24h | 0건 | /ops/watchdog |

---

## 🚨 Rollback

**코드**: Vercel Dashboard → Deployments → 이전 Promote
**DB**: migration 은 backward-compatible (컬럼 추가만). rollback 불필요.

---

## 📚 사용자 교육

실장/스태프 첫 로그인 후 사이드바 **[📖 가이드]** 메뉴 안내.
role 별 FAQ 포함:
- 카운터 운영 (체크인 → 스태프 추가 → 체크아웃)
- 정산 & 매출 (draft/finalize, 월간 리포트, 양주 목표)
- 문제 발견 시 (🐞 버튼)

---

## 📊 R1~R20 누적 성과

- 이슈 해결: 85+
- 신규 인프라: 20+ (format, floors, errors dict, idle, archive RPC, issue reports, system errors, watchdog, help, skeleton, empty state, ...)
- DB migrations: 8개 적용 완료
- TypeScript errors: 0
- Unit tests: 111/111 pass
- 신규 테이블: issue_reports, system_errors
- 신규 인덱스: 12개
- 신규 API 엔드포인트: 15+
- 신규 UI 페이지: 10+
