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
    tracesSampleRate: 0.05,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    sendDefaultPii: false,
  })
}
