/**
 * Sentry server-side init.
 *
 * R28-sentry (2026-04-26): 외부 에러 트래킹.
 *   기존 captureException 은 system_errors DB 와 console 만 사용 → DB 죽으면
 *   silent. Sentry 가 백업 채널.
 *
 * 활성 조건: SENTRY_DSN env 설정 시. 미설정 시 init 스킵 (운영 데이터 누설 X).
 */

import * as Sentry from "@sentry/nextjs"

const dsn = process.env.SENTRY_DSN

if (dsn) {
  // captureException wrapper 가 globalThis.Sentry 를 lookup.
  ;(globalThis as unknown as { Sentry: typeof Sentry }).Sentry = Sentry
  Sentry.init({
    dsn,
    // 프로덕션에서만 sampling. dev 환경 로컬 노이즈 차단.
    enabled: process.env.NODE_ENV === "production",
    // 트랜잭션 5%. 비용 통제 + 핵심 흐름 가시성.
    tracesSampleRate: 0.05,
    // 환경 태그 — staging/production 분리.
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    // PII 보호. user.id 만 보내고 email/IP 는 안 보냄.
    sendDefaultPii: false,
    // 노이즈 컷
    ignoreErrors: [
      "AbortError",
      "NEXT_NOT_FOUND",
      "NEXT_REDIRECT",
    ],
  })
}
