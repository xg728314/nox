# NOX 부하 테스트 (k6)

6~8층 확장 전 **14 매장 × 30 방 × realtime** 부하 한계 측정용.

## 사전 준비

1. **k6 설치** (Windows): `choco install k6` 또는 https://k6.io/docs/get-started/installation/
2. **테스트 계정 토큰 발급** — 스크립트는 Bearer 토큰을 환경변수로 받는다.
   ```powershell
   $env:BASE_URL = "https://your-preview-url.vercel.app"
   $env:TOKEN    = "eyJ..."   # /api/auth/login 결과의 access_token
   ```
3. **테스트 환경 격리** — 프로덕션 DB 에 절대 실행 금지. preview / staging 전용.

## 실행

```bash
# 기본 시나리오 (ramp-up 20 VU, 5분)
k6 run scripts/load-test/k6-counter-read.js

# 높은 부하 (100 VU, 10분)
k6 run --vus 100 --duration 10m scripts/load-test/k6-counter-read.js

# 결과 JSON 저장
k6 run --out json=results.json scripts/load-test/k6-counter-read.js
```

## 판정 기준

- **p95 < 800ms** — 일반 API 응답
- **p99 < 2s** — 가장 느린 쿼리
- **error rate < 0.5%** — 5xx / 네트워크 실패 총합
- **지속 동시접속** — 14 매장 × 평균 3 단말 = **42 VU 이상**에서 30분 안정

## 시나리오 개요

- `k6-counter-read.js` — /api/rooms + /api/counter/monitor 조회 반복. 가장 자주 쓰이는 읽기 경로.
- `k6-session-lifecycle.js` — 체크인 → 참여자 추가 → 체크아웃 → 정산. 쓰기 스트레스.
- `k6-settlement-calc.js` — 정산 finalize + 결제 + archive 체인.

> `k6-session-lifecycle.js` 와 `k6-settlement-calc.js` 는 본 라운드에
> 포함하지 않았다 (쓰기 시나리오는 테스트 데이터 정리까지 같이 설계해야
> 안전). 먼저 read-only 시나리오로 API 응답 한계를 측정하고, 그 결과에
> 따라 쓰기 시나리오를 추가한다.
