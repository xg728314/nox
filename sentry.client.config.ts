/**
 * Sentry client-side init.
 *
 * NEXT_PUBLIC_SENTRY_DSN 사용 (브라우저 노출 가능). DSN 은 public 정보.
 */

import * as Sentry from "@sentry/nextjs"

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  ;(globalThis as unknown as { Sentry: typeof Sentry }).Sentry = Sentry
  Sentry.init({
    dsn,
    enabled: process.env.NODE_ENV === "production",
    // 클라이언트 트랜잭션 1% (네트워크/번들 비용 절약)
    tracesSampleRate: 0.01,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    sendDefaultPii: false,
    // Replay 비활성 (PII 위험 + 비용)
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    ignoreErrors: [
      "AbortError",
      "ResizeObserver loop limit exceeded",
      "Non-Error promise rejection captured",
    ],
  })
}
