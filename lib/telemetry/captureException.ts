/**
 * Vendor-agnostic 에러 텔레메트리 wrapper.
 *
 * 2026-04-25: 운영 중 500/크래시를 놓치지 않도록 단일 진입점 제공.
 *   실제 Sentry(또는 다른 SDK) 는 추후 도입할 수 있고, 지금은 SDK 없이도
 *   이 wrapper 를 호출하면:
 *     - window.__noxTelemetry (주입식 sink) 가 있으면 그곳으로 전달
 *     - 없으면 console.error + 구조화 로그
 *
 * 장점: 애플리케이션 코드는 이 함수만 알면 됨. SDK 갈아끼울 때 한 곳만 수정.
 *
 * Sentry 붙이는 법 (선택):
 *   1. `npm i @sentry/nextjs`
 *   2. `instrumentation.ts` 에서 `Sentry.init(...)` 호출
 *   3. client 컴포넌트에서 한 번:
 *        import * as Sentry from "@sentry/nextjs"
 *        ;(window as unknown as { __noxTelemetry?: unknown }).__noxTelemetry = {
 *          captureException: (e, ctx) => Sentry.captureException(e, { extra: ctx }),
 *        }
 *   이후 이 wrapper 는 자동으로 Sentry 로 라우팅됨.
 */

export type TelemetryContext = {
  /** 예: "bill_page_fetch", "payment_submit" */
  tag?: string
  /** 추가 메타 (store_uuid, session_id 등). PII 금지. */
  extra?: Record<string, unknown>
  /** 심각도. 기본 "error". "warning" 도 권장값. */
  level?: "error" | "warning" | "info"
}

type TelemetrySink = {
  captureException: (error: unknown, context?: TelemetryContext) => void
}

function getInjectedSink(): TelemetrySink | null {
  if (typeof window === "undefined") return null
  const w = window as unknown as { __noxTelemetry?: TelemetrySink }
  return w.__noxTelemetry ?? null
}

/**
 * Sentry 로 직접 전송. 모듈 임포트가 실패하면 (SDK 없음) silent.
 *   forward 가 실패해도 호출자에게 throw 안 함 — 텔레메트리 실패가 비즈니스 흐름 끊으면 안 됨.
 */
function forwardToSentry(error: unknown, context: TelemetryContext): void {
  // SDK 가 없으면 try/catch 가 모듈 로드 시점에 잡지 못하므로 require-style 회피.
  // 대신 globalThis 에 Sentry 가 노출되도록 sentry.*.config.ts 가 init 시 자동 처리.
  type SentryLike = {
    captureException: (e: unknown, opts?: { extra?: Record<string, unknown>; tags?: Record<string, string>; level?: string }) => void
  }
  const g = globalThis as unknown as { Sentry?: SentryLike }
  const Sentry = g.Sentry
  if (!Sentry || typeof Sentry.captureException !== "function") return
  try {
    Sentry.captureException(error, {
      extra: context.extra,
      tags: context.tag ? { tag: context.tag } : undefined,
      level: context.level === "warning" ? "warning" : context.level === "info" ? "info" : "error",
    })
  } catch { /* silent */ }
}

/**
 * 에러를 텔레메트리로 전송. 어디서든 호출 가능 (클라/서버 무관).
 *
 * 사용 예:
 *   try { ... } catch (e) {
 *     captureException(e, { tag: "bill_fetch", extra: { session_id } })
 *     setError("…")
 *   }
 */
export function captureException(
  error: unknown,
  context: TelemetryContext = {},
): void {
  // R28-sentry: @sentry/nextjs 가 설치돼 있으면 직접 전달.
  //   클라/서버/edge 모두 동일 SDK 사용. SENTRY_DSN 미설정 시 init 안 돼서 no-op.
  forwardToSentry(error, context)

  const sink = getInjectedSink()
  if (sink) {
    try {
      sink.captureException(error, context)
      return
    } catch {
      // sink 자체 오류 시 기본 경로로 fallback
    }
  }

  const level = context.level ?? "error"
  const prefix = context.tag ? `[${context.tag}]` : "[telemetry]"
  const payload = {
    level,
    tag: context.tag ?? null,
    extra: context.extra ?? null,
    error:
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : error,
  }
  if (level === "info") {
    console.info(prefix, payload)
  } else if (level === "warning") {
    console.warn(prefix, payload)
  } else {
    console.error(prefix, payload)
  }

  // 2026-04-25: 서버 DB 저장 (fire-and-forget, 실패해도 무시).
  //   브라우저에서만 POST. info level 은 DB 로 안 보냄 (스팸 방지).
  if (typeof window !== "undefined" && level !== "info") {
    try {
      const errObj = error instanceof Error ? error : null
      const digest = (error as { digest?: unknown })?.digest
      fetch("/api/telemetry/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        credentials: "include",
        body: JSON.stringify({
          tag: context.tag ?? null,
          error_name: errObj?.name ?? null,
          error_message:
            errObj?.message ??
            (typeof error === "string" ? error : JSON.stringify(error)?.slice(0, 500)),
          stack: errObj?.stack ?? null,
          digest: typeof digest === "string" ? digest : null,
          url: window.location.href,
          user_agent: navigator.userAgent,
          extra: context.extra ?? null,
        }),
      }).catch(() => { /* silent */ })
    } catch { /* silent */ }
  }
}

/**
 * 브레드크럼/info 이벤트 기록. 크래시 직전 맥락 파악용.
 */
export function captureMessage(
  message: string,
  context: TelemetryContext = {},
): void {
  captureException(new Error(message), { ...context, level: context.level ?? "info" })
}
