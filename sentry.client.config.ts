/**
 * Sentry client-side init.
 */

import * as Sentry from "@sentry/nextjs"

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  ;(globalThis as unknown as { Sentry: typeof Sentry }).Sentry = Sentry

  Sentry.init({
    dsn,

    enabled: process.env.NODE_ENV === "production",

    tracesSampleRate: 1.0,

    environment:
      process.env.NEXT_PUBLIC_VERCEL_ENV ??
      process.env.NODE_ENV ??
      "development",

    sendDefaultPii: false,

    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    ignoreErrors: [
      "AbortError",
      "ResizeObserver loop limit exceeded",
      "Non-Error promise rejection captured",
    ],
  })
}