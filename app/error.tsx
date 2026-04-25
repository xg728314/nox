"use client"

/**
 * Next.js App Router 에러 경계.
 *
 * 2026-04-24: 이전에는 한 페이지의 React 크래시가 전체 흰 화면을 만듦.
 *   이 파일로 route 단위 error boundary 를 도입해 "다시 시도" / "홈으로"
 *   옵션을 제공.
 *
 * NOX 는 장부 시스템이므로 사용자에게 raw stack trace 노출하지 않고,
 * digest 만 보여준다 (지원 요청 시 digest 로 로그 추적).
 */

import { useEffect } from "react"
import { captureException } from "@/lib/telemetry/captureException"

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    captureException(error, {
      tag: "route_error",
      extra: {
        digest: error.digest,
        path: typeof window !== "undefined" ? window.location.pathname : null,
      },
    })
  }, [error])

  return (
    <div className="min-h-screen bg-[#030814] flex items-center justify-center px-6">
      <div className="max-w-md w-full rounded-2xl border border-red-500/20 bg-red-500/[0.04] p-6">
        <div className="text-red-400 text-sm font-bold mb-2">페이지 오류</div>
        <p className="text-slate-300 text-sm leading-relaxed mb-4">
          이 페이지를 불러오던 중 예상치 못한 오류가 발생했습니다. 작업
          내용은 저장되어 있으니 다시 시도해 주세요.
        </p>
        {error.digest && (
          <p className="text-[10px] text-slate-500 mb-4">
            오류 ID: <code className="text-slate-400">{error.digest}</code>
          </p>
        )}
        <div className="flex gap-2">
          <button
            onClick={() => reset()}
            className="flex-1 py-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-sm font-medium hover:bg-red-500/25"
          >
            다시 시도
          </button>
          <button
            onClick={() => { window.location.href = "/" }}
            className="flex-1 py-2.5 rounded-xl bg-white/[0.03] border border-white/10 text-slate-400 text-sm hover:bg-white/[0.08]"
          >
            홈으로
          </button>
        </div>
      </div>
    </div>
  )
}
