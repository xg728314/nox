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

    const onLoad = async () => {
      // R-zombie-sw (2026-08-23): 옛 legacy _arch/legacy-mock 이 등록한 /m/sw.js
      //   (fetch handler + staleWhileRevalidate 로 clone 폭발) 를 강제 unregister.
      //   방치하면 /api/* 응답을 clone → body-reuse 에러 → 채팅 페이지에서 fetch()
      //   가 실패 상태로 관측됨 (서버는 200 인데 DevTools 는 400/에러). 자세한 사연
      //   은 public/m/sw.js 헤더 주석 참고.
      try {
        const regs = await navigator.serviceWorker.getRegistrations()
        for (const reg of regs) {
          const scope = reg.scope || ""
          const scriptUrl = reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL || ""
          // /sw.js (scope: /) 만 유지, 나머지 (/m/sw.js 등) 는 청소.
          const isCurrent = scriptUrl.endsWith("/sw.js") && !scriptUrl.includes("/m/sw.js")
          const isRootScope = scope === `${location.origin}/` || scope === location.origin || scope === "/"
          if (!isCurrent || !isRootScope) {
            try { await reg.unregister() } catch { /* best-effort */ }
          }
        }
      } catch { /* getRegistrations 실패는 무시 (사파리 일부) */ }

      try {
        await navigator.serviceWorker.register("/sw.js")
      } catch {
        // PWA 미지원 / 등록 실패는 silent — 일반 웹앱으로 동작.
      }
    }
    if (document.readyState === "complete") onLoad()
    else window.addEventListener("load", onLoad)

    return () => window.removeEventListener("load", onLoad)
  }, [])

  return null
}
