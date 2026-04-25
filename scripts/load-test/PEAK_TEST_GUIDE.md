# NOX 부하 테스트 — 380명 피크 시나리오 가이드

R29 (2026-04-26) 신규.

## 왜 이걸 해야 하나

- 실 사용자 380명 (실장 80 + 아가씨 300) 동시 투입 전 **사용 가능 vs 불가능 객관 판단**
- R29 에서 추가한 캐시 (rooms, monitor) 효과 검증
- DB connection pool / Realtime 한도 / Vercel function timeout 한계 측정

## 사전 준비

### 1. k6 설치
```powershell
choco install k6
# 또는 https://k6.io/docs/get-started/installation/
```

### 2. Staging 환경 (production 절대 금지)
```powershell
# Vercel preview 또는 별도 staging 프로젝트
$env:BASE_URL = "https://nox-staging-xxx.vercel.app"
```

### 3. 테스트 토큰 발급 (2개)
```powershell
# Owner JWT — 카운터 시점 시뮬용
$response = Invoke-RestMethod -Uri "$env:BASE_URL/api/auth/login" -Method Post -ContentType "application/json" -Body '{"email":"marvel-owner@nox-test.com","password":"Test1234!"}'
$env:TOKEN_OWNER = $response.access_token

# Hostess JWT — /me 폴링 시뮬용
$response = Invoke-RestMethod -Uri "$env:BASE_URL/api/auth/login" -Method Post -ContentType "application/json" -Body '{"email":"marvel-h1@nox-test.com","password":"Test1234!"}'
$env:TOKEN_HOSTESS = $response.access_token
```

### 4. 시드 데이터 — 매장 활성, 방 1개 active session
시뮬레이션 결과가 현실적이려면 active session 1개가 필요. `npx tsx scripts/seed-test-data.ts` 후 카운터에서 임의 방 체크인.

## 시나리오별 실행

### A. Read-path baseline (기존, 빠른 확인)
```powershell
npm run load:read
```
- 50 VU, 5분
- p95 < 800ms 면 OK

### B. 380명 피크 (R29 신규, 핵심)
```powershell
k6 run scripts/load-test/k6-peak-380.js
```
- 7분 (1분 ramp-up + 5분 sustain + 1분 ramp-down)
- 380 VU 동시 (실장 80 + 아가씨 300)
- 테스트 끝나면 `load-test-summary.json` 자동 저장

### C. 채팅 폭주 (피크의 10배 가속)
```powershell
$env:CHAT_ROOM_ID = "<test_chat_room_uuid>"
k6 run scripts/load-test/k6-chat-burst.js
```
- 100 VU 가 30초 동안 ~300 msg/초 (실 5K/일의 10배)
- DB lock contention + Realtime broadcast 부하

### D. 세션 라이프사이클 (체크인 → 주문 → 체크아웃)
```powershell
npm run load:lifecycle
```

## 결과 해석

### ✅ 사용 가능 (테스트 진행 OK)
```
p95_ms         : < 800
p99_ms         : < 2000
error_rate     : < 1%
rooms_p95_ms   : < 500   (캐시 잘 동작)
monitor_p95_ms : < 1000
```

### 🟡 경고 (개선 후 진행)
```
p95_ms         : 800 ~ 1500
error_rate     : 1% ~ 3%
```
원인 가능성:
- Supabase connection pool 부족 → Pro plan + pooler transaction mode 확인
- `/api/counter/monitor` 가 캐시 안 타고 있음 → invalidateCache 빈도 점검
- Vercel function cold start → /api 호출 빈도 늘려 warm 유지

### 🔴 사용 불가 (배포 보류)
```
p95_ms     : > 2000
error_rate : > 5%
```
원인 가능성:
- DB CPU 100% → 인덱스 미사용 (m094 view 로 확인)
- Realtime 한도 초과 → Supabase plan 업그레이드
- Memory leak / connection leak

## 자동 분석 (Top 5 슬로우 endpoint)

k6 결과 + watchdog `/api/telemetry/watchdog` 의 db_health 비교:

```sql
-- staging DB 에서 실행
SELECT
  table_name,
  index_name,
  idx_scan,
  size
FROM v_index_usage
WHERE idx_scan = 0
ORDER BY size DESC
LIMIT 5;
-- 결과: 사용 안 되는 인덱스. 캐시 미스 폭증 시 여기 의심.

SELECT * FROM v_table_stats
WHERE dead_rows > live_rows * 0.2
ORDER BY live_rows DESC
LIMIT 10;
-- 결과: VACUUM 필요한 테이블.
```

## 결과 기록 템플릿

`docs/OPERATIONS/LOAD_TEST_LOG.md` 에 누적:

```markdown
## 2026-04-26 (R29 캐시 검증)
- staging URL: https://...
- Scenario: k6-peak-380
- 결과:
  - total_requests: 18,420
  - p95: 612 ms ✓
  - p99: 1,840 ms ✓
  - error_rate: 0.4% ✓
  - rooms_p95: 110 ms (캐시 잘 동작 ✓)
  - monitor_p95: 480 ms ✓
  - cache_hits: 18,000+ / cache_misses: 200
- 판정: ✅ 380명 투입 가능
- 발견 이슈: monitor 응답에 BLE confidence 없는 매장 1건 → 별도 티켓
- 다음 측정: 1주 후 (실 사용 데이터 누적 후)
```

## CI 자동 실행 (R30 후속 라운드 후보)

```yaml
# .github/workflows/load-test.yml
on:
  pull_request:
    branches: [main]
jobs:
  k6-peak:
    runs-on: ubuntu-latest
    steps:
      - uses: grafana/k6-action@v0.3.0
        with:
          filename: scripts/load-test/k6-peak-380.js
        env:
          BASE_URL: ${{ secrets.STAGING_URL }}
          TOKEN_OWNER: ${{ secrets.STAGING_OWNER_TOKEN }}
          TOKEN_HOSTESS: ${{ secrets.STAGING_HOSTESS_TOKEN }}
      - name: Fail if p95 too high
        run: |
          P95=$(jq '.p95_ms' load-test-summary.json | tr -d '"')
          if (( $(echo "$P95 > 1000" | bc -l) )); then exit 1; fi
```

배포 PR 마다 자동 실행 → regression 즉시 차단.
