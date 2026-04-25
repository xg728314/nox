# Telemetry — 에러 보고 체계

## 현재 상태

- `captureException(error, context)` 하나로 모든 에러 전송 일원화.
- SDK 없이도 작동 — `console.error` 로 구조화 로그 출력.
- 전역 sink `window.__noxTelemetry` 주입하면 그곳으로 라우팅.
- 이미 연결된 곳: `app/error.tsx`, `app/global-error.tsx`,
  `app/credits/page.tsx`, `app/counter/[room_id]/payment/page.tsx`,
  `app/counter/[room_id]/bill/PrintAndArchiveButton.tsx`.

## Sentry 실제 연결 (선택, 실전 운영 시)

### 1. 패키지 설치
```bash
npm i @sentry/nextjs
```

### 2. 환경변수
```env
NEXT_PUBLIC_SENTRY_DSN=https://<public>@o<org>.ingest.sentry.io/<project>
SENTRY_AUTH_TOKEN=<for source map upload>
```

### 3. `instrumentation.ts` (프로젝트 루트)
```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const Sentry = await import("@sentry/nextjs")
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0.1,
    })
  }
}
```

### 4. 클라이언트에서 sink 주입 (`app/layout.tsx` 안 `<Script strategy="afterInteractive">` 또는 최상위 client comp)
```ts
"use client"
import * as Sentry from "@sentry/nextjs"
import { useEffect } from "react"

export function SentryBootstrap() {
  useEffect(() => {
    Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN, tracesSampleRate: 0.1 })
    ;(window as unknown as { __noxTelemetry?: unknown }).__noxTelemetry = {
      captureException: (e: unknown, ctx?: { tag?: string; extra?: Record<string, unknown> }) => {
        Sentry.captureException(e, { tags: ctx?.tag ? { tag: ctx.tag } : undefined, extra: ctx?.extra })
      },
    }
  }, [])
  return null
}
```

### 5. 배포 전 체크
- Source map 업로드 설정 (`sentry-cli` 또는 next plugin).
- PII 마스킹 룰 — 손님 이름/전화, 스태프 이름이 extra 에 안 들어가는지.
- rate limiting — `tracesSampleRate` 보수적으로 (0.1 → 0.05).

## 호출 규약

```ts
import { captureException } from "@/lib/telemetry/captureException"

try {
  ...
} catch (e) {
  captureException(e, {
    tag: "billing_submit",       // 분류용 태그
    extra: { session_id, step }, // 디버깅 맥락 (PII 금지)
  })
  setError("사용자에게 보여줄 메시지")
}
```

## ✅ DO / ❌ DON'T

- ✅ user action 이 실패한 catch 블록에서 호출
- ✅ `tag` 는 소문자 + 언더스코어 (검색/그룹화 기준)
- ❌ PII 를 `extra` 에 넣지 않기 (이름/전화/주민번호 등)
- ❌ 정상 흐름에서 captureException 호출 안 함 (노이즈)
- ❌ `console.error` 직접 호출 — 이 wrapper 만 사용
