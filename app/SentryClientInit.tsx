"use client"

import { useEffect } from "react"

/**
 * Sentry client init shim.
 *
 * 2026-04-28 (perf round): 기존엔 module top-level 에서
 * `import "../sentry.client.config"` → @sentry/nextjs 가 모든 페이지의
 * 클라이언트 번들 + 첫 paint 경로에 로드됐다. DSN 미설정 시에도 모듈
 * 로드만으로 ~수십 KB + execution 비용 발생.
 *
 * 이제 useEffect 안에서 dynamic import + DSN 존재 여부 체크 후에만
 * 로드한다. 첫 paint 와 경합하지 않고, DSN 없으면 아예 import 안 함.
 * 키 값 자체는 출력하지 않고 truthy 여부만 사용.
 */
export default function SentryClientInit() {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return
    // dynamic import — 첫 paint 이후 next-tick 에 로드.
    void import("../sentry.client.config").catch(() => {
      /* SDK 로드 실패는 silent — 앱 동작 차단 금지 */
    })
  }, [])
  return null
}
