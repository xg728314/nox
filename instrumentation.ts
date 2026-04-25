/**
 * Next.js instrumentation hook.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * 2026-04-25: Sentry 연결 준비. 현재는 no-op. 실운영 전 SENTRY_DSN 환경변수
 *   설정하고 @sentry/nextjs 설치하면 자동 활성.
 *
 * 활성화 순서:
 *   1. `npm i @sentry/nextjs`
 *   2. `npx @sentry/wizard@latest -i nextjs` 또는 수동 `sentry.server.config.ts` /
 *      `sentry.edge.config.ts` / `sentry.client.config.ts` 생성
 *   3. Vercel env 에 `NEXT_PUBLIC_SENTRY_DSN` 추가
 *   4. 재배포 → captureException() 이 자동으로 Sentry 로 라우팅됨
 *
 * 현재 captureException 은:
 *   - console.error (서버/클라 공통)
 *   - system_errors DB 테이블 insert (클라이언트)
 *   - window.__noxTelemetry sink (옵션, Sentry 감지 용)
 *
 * Sentry 붙이면:
 *   - stack deobfuscation (source maps 자동 업로드)
 *   - release tracking
 *   - performance monitoring
 *   - user feedback widget 자동 노출
 */

export async function register() {
  // R28-sentry (2026-04-26): @sentry/nextjs 통합 활성.
  //   SENTRY_DSN 미설정 시 sentry.*.config.ts 가 init 스킵 → silent.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config")
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config")
  }
}

/**
 * Sentry 가 자동으로 server-action / page-render 에러를 잡도록 hook 노출.
 * Next.js 15 권장 패턴.
 */
export async function onRequestError(
  err: unknown,
  request: Parameters<NonNullable<typeof onRequestErrorImpl>>[1],
  context: Parameters<NonNullable<typeof onRequestErrorImpl>>[2],
) {
  if (onRequestErrorImpl) await onRequestErrorImpl(err, request, context)
}

// Sentry 의 captureRequestError 가 있으면 사용, 없으면 no-op.
// 직접 import 하면 SENTRY_DSN 미설정 시에도 모듈 로드되므로 lazy.
let onRequestErrorImpl:
  | ((err: unknown, req: unknown, ctx: unknown) => Promise<void> | void)
  | null = null
;(async () => {
  if (!process.env.SENTRY_DSN && !process.env.NEXT_PUBLIC_SENTRY_DSN) return
  try {
    const Sentry = await import("@sentry/nextjs")
    onRequestErrorImpl = Sentry.captureRequestError as typeof onRequestErrorImpl
  } catch { /* SDK 없음 — silent */ }
})()
