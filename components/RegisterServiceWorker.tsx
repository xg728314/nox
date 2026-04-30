"use client"

/**
 * Service worker 등록 — PWA installable 조건 충족용.
 *
 * 정책 (2026-04-30):
 *   - production 에서만 등록 (dev 에서는 noop).
 *   - /sw.js 가 install/activate 만 처리 (fetch handler 없음).
 *   - 등록 실패는 silent (PWA 미지원 브라우저 / 사파리 일부 등 정상).
 */

import { useEffect } from "react"

export default function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined") return
    if (!("serviceWorker" in navigator)) return
    if (process.env.NODE_ENV !== "production") return

    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // PWA 미지원 / 등록 실패는 silent — 일반 웹앱으로 동작.
      })
    }
    if (document.readyState === "complete") onLoad()
    else window.addEventListener("load", onLoad)

    return () => window.removeEventListener("load", onLoad)
  }, [])

  return null
}
