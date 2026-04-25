"use client"

/**
 * root layout 레벨의 최종 방어선.
 * error.tsx 밖 (layout 자체) 에서 크래시 나면 여기로.
 * html/body 태그를 직접 렌더해야 한다 (Next.js 요구사항).
 */

import { useEffect } from "react"
import { captureException } from "@/lib/telemetry/captureException"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    captureException(error, {
      tag: "global_error",
      extra: {
        digest: error.digest,
        path: typeof window !== "undefined" ? window.location.pathname : null,
      },
    })
  }, [error])

  return (
    <html lang="ko">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#030814", color: "#e2e8f0" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
          <div style={{ maxWidth: "420px", width: "100%", padding: "24px", borderRadius: "16px", border: "1px solid rgba(239, 68, 68, 0.2)", background: "rgba(239, 68, 68, 0.04)" }}>
            <div style={{ color: "#f87171", fontSize: "14px", fontWeight: 700, marginBottom: "8px" }}>
              시스템 오류
            </div>
            <p style={{ color: "#cbd5e1", fontSize: "14px", lineHeight: 1.6, marginBottom: "16px" }}>
              앱 초기화 중 심각한 오류가 발생했습니다. 새로고침 후 다시
              시도해주세요. 문제가 지속되면 관리자에게 아래 오류 ID 를
              전달하세요.
            </p>
            {error.digest && (
              <p style={{ fontSize: "10px", color: "#64748b", marginBottom: "16px" }}>
                오류 ID: <code style={{ color: "#94a3b8" }}>{error.digest}</code>
              </p>
            )}
            <button
              onClick={() => reset()}
              style={{ width: "100%", padding: "10px", borderRadius: "12px", background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.3)", color: "#fca5a5", fontSize: "14px", cursor: "pointer" }}
            >
              다시 시도
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
