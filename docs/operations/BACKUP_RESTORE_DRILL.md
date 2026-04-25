# DB Backup Restore Drill — NOX

R28 신규. **운영 첫 주 안에 반드시 1회 실시.**

## 왜 필요한가

Supabase PITR (Point-in-Time Recovery) 가 켜져있다는 가정만 하고 있음. 실제로 5분 안에 복원 가능한지 한 번도 시연 안 함. 운영 중 데이터 손실/오염 시 검증되지 않은 절차 = **복구 못 함**.

## 사전 조건

1. Supabase 프로젝트 plan: **Pro 이상** (PITR 7일 / Pro+ 14일 / Team 30일)
2. Daily backup + WAL 보관 활성 확인
   - Dashboard → Settings → Database → Backups
3. 별도 staging Supabase 프로젝트 1개 (격리된 복원 대상)
4. `.env.local.staging` 파일에 staging URL/키 분리

## 실행 단계 (월 1회 권장)

### Step 1 — production snapshot 시점 기록

```sql
-- production DB 에서 실행 (Supabase Dashboard SQL Editor)
SELECT now() AS snapshot_target;
-- 결과를 메모: 예) 2026-04-26 15:30:00 KST
```

### Step 2 — staging 으로 PITR 복원

Supabase Dashboard (production project) → Database → Backups:
1. "Restore to a point in time" 클릭
2. 시점 선택: Step 1 의 `snapshot_target`
3. **새 프로젝트로 복원** 선택 (production 덮어쓰기 절대 금지)
4. staging 프로젝트로 데이터 복원 진행

⏱ 예상 소요: 5~15분

### Step 3 — staging 정합성 검증

```sql
-- staging DB 에서 실행
-- 1) 핵심 테이블 row 수 비교 (production 과 ±5% 이내여야 OK)
SELECT 'stores' AS t, count(*) FROM stores
UNION ALL SELECT 'rooms', count(*) FROM rooms
UNION ALL SELECT 'room_sessions', count(*) FROM room_sessions
UNION ALL SELECT 'session_participants', count(*) FROM session_participants
UNION ALL SELECT 'orders', count(*) FROM orders
UNION ALL SELECT 'receipts', count(*) FROM receipts
UNION ALL SELECT 'audit_events', count(*) FROM audit_events;

-- 2) 가장 최근 mutation 시각 — snapshot_target 직전 데이터까지 보여야 함
SELECT max(created_at) FROM audit_events;
SELECT max(updated_at) FROM room_sessions;

-- 3) 인덱스 / 제약 모두 살아있는지
SELECT count(*) FROM pg_indexes WHERE schemaname = 'public';
SELECT count(*) FROM information_schema.table_constraints WHERE table_schema = 'public';
```

### Step 4 — application 동작 확인

```bash
# .env.local.staging 으로 NOX 띄우기
cp .env.local.staging .env.local.tmp && mv .env.local .env.local.bak && mv .env.local.tmp .env.local
npm run dev
```

체크리스트:
- [ ] /login 으로 들어가서 로그인 성공
- [ ] /counter 에서 방 목록 표시
- [ ] 임의 세션 1개의 정산 표시 정확
- [ ] /chat 에서 최근 메시지 보임

→ 모두 OK 면 staging 종료, `.env.local.bak` 복구.

### Step 5 — 결과 기록

`docs/OPERATIONS/RESTORE_DRILL_LOG.md` 에 추가:

```
## 2026-04-26
- snapshot_target: 2026-04-26 15:30:00 KST
- restore 소요: 9분 12초
- row count delta: ±0.3%
- 검증 결과: OK
- 발견 이슈: (없음)
- 수행자: <name>
```

## 실패 시나리오 대응

| 증상 | 원인 가능성 | 대응 |
|---|---|---|
| 복원 시작 안 됨 | PITR 비활성 또는 plan 미달 | Supabase support 문의, plan upgrade |
| 복원은 되는데 row 수 차이 큼 | WAL 누락 / 보관 기간 초과 | 더 가까운 시점으로 재시도 |
| application 인증 실패 | service-role key 가 새 프로젝트라 다름 | staging env 의 키로 갱신 |
| 정산 표시 깨짐 | 의존 view/RPC 누락 | migration 재적용 (`database/0XX_*.sql`) |

## 자동화 (선택)

월 1회 자동 drill 가능. Supabase Management API + GitHub Actions 조합:

```yaml
# .github/workflows/restore-drill.yml (예시)
on:
  schedule:
    - cron: "0 2 1 * *"  # 매월 1일 02:00 UTC
jobs:
  drill:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -X POST https://api.supabase.com/v1/projects/$STAGING_REF/database/restore-pitr \
            -H "Authorization: Bearer $SUPABASE_TOKEN" \
            -d '{"recovery_target_time": "<5min ago ISO>"}'
      - run: |
          # 복원 완료 polling + row-count 검증 + Slack 알림
```

R30+ 후속 라운드 후보.

## RPO / RTO 목표

- **RPO** (Recovery Point Objective): ≤ 5분 (PITR WAL 기반)
- **RTO** (Recovery Time Objective): ≤ 30분 (복원 + 앱 재배포 + DNS 전환)

이 목표 달성 여부는 매월 drill 에서 검증.
