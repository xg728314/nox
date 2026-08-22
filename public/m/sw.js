/* eslint-disable */
/**
 * NOX Legacy /m/sw.js — self-unregistering stub (R-zombie-sw, 2026-08-23).
 *
 * 배경:
 *   - _arch/legacy-mock/*.html 이 예전에 이 경로에 SW 를 등록했다.
 *   - 그 HTML 들은 archive 됐지만, **사용자 브라우저에는 옛 SW 가 남아있음.**
 *   - 옛 SW 는 fetch handler + staleWhileRevalidate 를 등록 → /api/* 응답을 clone
 *     하려다 body 재사용 → "Failed to execute 'clone' on 'Response'" 폭발.
 *   - 그 결과 채팅 페이지가 pattern-dispatch 200 을 받는데 브라우저는 400 으로 보고 →
 *     사용자 DevTools 에 400 spam.
 *
 * 해결:
 *   - 이 파일이 서버에 존재해야 옛 SW 가 update check → 새 script 로 교체됨.
 *   - 새 script (지금 이 파일) 는 activate 시 자기 unregister + cache 전멸.
 *   - fetch handler 없음 → 이미 활성화된 순간부터 network 직통.
 */

self.addEventListener("install", (event) => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await self.caches.keys()
        await Promise.all(keys.map((k) => self.caches.delete(k)))
      } catch (e) {}
      try {
        await self.registration.unregister()
      } catch (e) {}
      // 이미 controlled 된 클라이언트들에게 reload 신호 (선택적).
      try {
        const clients = await self.clients.matchAll({ type: "window" })
        for (const c of clients) {
          try { c.postMessage({ type: "sw-zombie-dead" }) } catch (e) {}
        }
      } catch (e) {}
    })(),
  )
})

// fetch handler 등록 안 함 — network 통과.
