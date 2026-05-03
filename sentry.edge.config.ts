/**
 * Sentry edge runtime init (middleware).
 *
 * Edge 는 nodejs 런타임과 분리돼 별도 init 필요.
 */

import * as Sentry from "@sentry/nextjs"

const dsn = process.env.SENTRY_DSN

if (dsn) {
  ;(globalThis as unknown as { Sentry: typeof Sentry }).Sentry = Sentry
  Sentry.init({
    dsn,
    enabled: process.env.NODE_ENV === "production",
    // 2026-05-03 R-Speed-x10: 5% → 2% (server config 와 동일).
    tracesSampleRate: 0.02,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    sendDefaultPii: false,
  })
}
