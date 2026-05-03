# NOX DB Backup / Restore Runbook

**최종 업데이트**: 2026-05-03
**대상**: Supabase project `piboecawkeqahyqbcize` (nox, ACTIVE_HEALTHY)
**책임자**: super_admin (xg728314@gmail.com)

---

## 0. 평소 (자동 백업 — Supabase 관리)

Supabase Pro tier 이상에서 **PITR (Point-In-Time Recovery)** 활성. 별도 cron 불필요.

확인:
- Supabase Dashboard → Project Settings → Backups
- "Daily backups" 7일 치 + "Point in time" 7일 치 보존되는지 확인.
- 매월 1일에 한 번 위 화면 캡처 → `ops/backup-evidence/YYYY-MM.png` 저장.

---

## 1. 분기별 시연 절차 (실행: 분기 첫째 주 평일 새벽)

NOX 운영 중단 없이 백업 → 복원 시연. 실 production 에 영향 없음.

### Step 1: Supabase Dashboard 에서 새 branch 생성
1. Dashboard → **Branches** → `Create new branch`
2. 이름: `restore-test-YYYY-MM-DD`
3. Source: `main` (현재 production)
4. **Wait** 약 3~5분 (DB clone)

### Step 2: branch 의 connection string 으로 검증
```bash
# branch endpoint 받기 (Dashboard 상단)
export TEST_DB_URL="postgres://postgres:PASSWORD@db.<branch-id>.supabase.co:5432/postgres"

# 핵심 테이블 행 수 비교
psql "$TEST_DB_URL" -c "SELECT 'sessions', count(*) FROM room_sessions
                       UNION ALL SELECT 'orders',  count(*) FROM orders
                       UNION ALL SELECT 'receipts', count(*) FROM receipts;"
```
production 과 비교해 같으면 **OK**.

### Step 3: 가상 disaster 시나리오 — branch 에서 의도적 손상
```sql
-- 시나리오: 누군가 실수로 stores 한 row 를 삭제했다고 가정.
DELETE FROM stores WHERE store_name = 'TEST_INTENTIONAL_DELETE_DO_NOT_RUN_IN_PROD';
```
(실제로 prod 에 없는 dummy store 라 영향 없음. 시연 형식만.)

### Step 4: PITR 로 5분 전 시점 복원 (시뮬레이션)
1. Dashboard → Backups → **Point in time** 탭
2. 가장 최근 시각으로 복원 클릭
3. 복원 완료까지 대기
4. 위 SELECT 다시 → 행 수 동일 확인

### Step 5: 시연 종료
1. test branch 삭제 (Dashboard 에서)
2. `ops/backup-restore-drill/YYYY-Q.md` 에 결과 기록:
   ```
   - 일시: YYYY-MM-DD HH:MM KST
   - 실행자: <이름>
   - 결과: PASS / FAIL
   - 복원 소요 시간: <분>
   - 관찰: <기록>
   ```

---

## 2. 진짜 disaster 시 응급 절차

### 시나리오 A: 단일 row 손상 (실수 DELETE 등)
1. 즉시 운영 중단 공지 (chat → super_admin)
2. Supabase Dashboard → Backups → Point in time
3. 사고 직전 시각 (분 단위) 으로 PITR 복원
4. 복원 완료 후 영향받은 테이블만 row 단위 비교 후 SELECT/INSERT 로 재반영
5. 재발 방지 audit_events 검토

### 시나리오 B: 전체 DB 손상
1. 운영 중단 공지
2. Supabase support 즉시 contact (Pro 이상 우선순위)
3. Daily backup 으로 복원
4. 복원 후 **마지막 백업 ~ 현재** 사이의 데이터는 종이장부 + paper_ledger_uploads
   (mig 092) 사진으로 수동 reconcile (`/reconcile/[id]` 페이지 활용)

---

## 3. 필수 환경 변수 백업 (별도 보관)

다음 값들은 DB 와 별도로 평문 보관 + 암호화:
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SENTRY_DSN`
- Vercel team token (배포용)

저장 위치: 1Password vault `NOX-Production-Secrets`.
열람 권한: super_admin only.

---

## 3-bis. Cold start 방지 (Uptime Monitor 등록)

운영 중 첫 사용자가 4초+ 기다리는 cold start 를 막기 위해 `/api/system/warmup`
endpoint 를 외부 uptime monitor 에 등록한다.

추천 도구 (무료):
- **UptimeRobot** — HTTP(s) 모니터, 5분 간격 무료, 알림 메일.
- **Better Uptime** — 30초 간격 가능 (free plan).
- **Vercel monitoring** — 자체 dashboard 에서 health check.

설정:
1. monitor 등록 → URL: `https://<production-domain>/api/system/warmup`
2. Method: GET
3. Interval: 1분 (또는 free plan 의 가장 짧은 간격)
4. 알림: 3회 연속 실패 시 super_admin 메일.

검증:
```bash
curl -s https://<domain>/api/system/warmup
# {"ok":true,"warm_at":"...","rtt_ms":12,"env_ok":true}
```

`rtt_ms` 가 항상 100ms 이하 = warm pool 유지 중.
첫 호출에 800ms+ 면 cold start 발생 → 알림 주기 단축 검토.

---

## 4. 점검 일정 (필수)

| 시점 | 작업 | 담당 |
|---|---|---|
| 매일 자동 | Supabase daily backup | (자동) |
| 매주 월 09:00 | watchdog 페이지 (`/ops/watchdog`) cron heartbeat 확인 | 운영자 |
| 매월 1일 | Supabase Dashboard 백업 보존 캡처 | 운영자 |
| 분기 첫째 주 | 위 시연 절차 1회 수행 | 운영자 |
| 연 1회 | 1Password 시크릿 회전 (service_role_key 갱신) | 운영자 |

---

## 5. 비고

- 종이장부는 **법적/세무 5년 보관** 별도 의무. 복원 후 paper ledger 와 reconcile 가능.
- `archived_at` 스탬프된 정산 데이터는 hard delete 안 됨. PITR 후에도 그대로 살아있음.
- `audit_events` 는 partition rollover (R26) — 1년 이상된 partition 은 cold storage 로 분리 검토.
