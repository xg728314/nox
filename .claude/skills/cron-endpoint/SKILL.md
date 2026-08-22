---
name: cron-endpoint
description: NOX cron API route (Cloud Run + GitHub Actions 트리거) 작성 시 CRON_SECRET 검증 · heartbeat 스탬프 · fire-and-forget 패턴 규칙
---

# Cron Endpoint

Cloud Run 은 자체 cron 없음. GitHub Actions schedule 이 외부에서 트리거.

## 아키텍처

```
GitHub Actions (.github/workflows/external-cron.yml)
  └── HTTP GET/POST → https://nox.ai.kr/api/cron/<name>
        (Header: X-Cron-Secret: $CRON_SECRET)
       └── Cloud Run 컨테이너 실행
             └── cron_heartbeats 테이블에 stamp
             └── 실제 작업 수행 (fire-and-forget)
```

## 필수 template

```typescript
import { NextResponse } from "next/server"
import { getServiceClient } from "@/lib/supabase/serviceClient"

export async function POST(request: Request) {
  // 1. Secret 검증
  const secret = request.headers.get("x-cron-secret")
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
  }

  const sb = getServiceClient()

  // 2. Heartbeat stamp (반드시 작업 시작 시)
  try {
    await sb.from("cron_heartbeats").upsert({
      job_name: "<이 endpoint 이름>",
      last_run_at: new Date().toISOString(),
    })
  } catch { /* best-effort */ }

  // 3. 실제 작업
  try {
    // ... 로직
    return NextResponse.json({ ok: true, processed: N })
  } catch (e) {
    // fire-and-forget: 다음 실행에 재시도. 500 만 반환.
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
```

## 등록된 cron endpoints (12개)

| endpoint | 빈도 | KST |
|---|---|---|
| `ops-alerts-scan` | 5분 | — |
| `ble-attendance-sync` | 5분 | — |
| `ble-session-inference` | 5분 | — |
| `watchdog` | 5분 | — |
| `ble-history-reaper` | 일 1회 | 12:00 |
| `settlement-tree-advance` | 일 1회 | 17:00 |
| `audit-archive` | 일 1회 | 03:00 |
| `system-errors-cleanup` | 일 1회 | 04:00 |
| `paper-ledger-expire` | 일 1회 | 04:00 |
| `push-imminent` | 필요 시 | — |
| `broadcast-queue-drain` | 5분 (신규) | — |
| `choice-state-refresh` | 5분 (신규) | — |

## 신규 cron 추가 절차

1. `app/api/cron/<name>/route.ts` 작성 (위 template)
2. `.github/workflows/external-cron.yml` 에 cron entry 추가
3. `cron_heartbeats` 테이블 확인 (migration 090 존재)
4. `/ops/watchdog` 페이지에서 자동 모니터링

## 함정

- ❌ Cron 안에서 `Date.now()` 로 KST 판단 → UTC 서버라 오차 (business-date-guard 참조)
- ❌ 무거운 작업 sync 처리 → Cloud Run timeout (300s) 걸림. 배치 나눠서.
- ❌ heartbeat stamp 잊음 → `/ops/watchdog` 이 stale 오탐
- ❌ error swallow 안 함 → 다음 실행 안 됨. try-catch 로 반드시 감쌈.

## 로컬 테스트

```bash
curl -X POST http://localhost:3000/api/cron/<name> \
  -H "x-cron-secret: local-dev-secret"
```

`.env.local` 에 `CRON_SECRET=local-dev-secret` 필요.

## 체크리스트

- [ ] `x-cron-secret` header 검증
- [ ] `cron_heartbeats` upsert (best-effort)
- [ ] try-catch 로 전체 감쌈
- [ ] 배치 나눠서 timeout 회피
- [ ] business_date 판단 시 KST 헬퍼 사용
- [ ] GitHub Actions workflow 등록
