/* eslint-disable */
/**
 * NOX Service Worker — minimal install / activate only.
 *
 * 정책 (2026-04-30):
 *   "PWA installable 조건만 만족하고, runtime cache 는 안 함."
 *
 * 이유:
 *   - 카운터는 항상 서버 truth 최신이어야 함. SW 가 stale 응답 캐시하면
 *     정산 / 세션 / 결제 데이터가 어긋날 수 있음 (실제 돈 사고).
 *   - PWA "홈 화면에 추가" / "앱처럼 standalone 실행" 만 활성화.
 *   - Offline 처리는 IndexedDB 기반 lib/offline (이미 존재) 가 담당.
 *
 * 동작:
 *   - install: skipWaiting (새 SW 즉시 활성화).
 *   - activate: clients.claim (기존 탭에도 즉시 적용).
 *   - fetch: handler 등록 X. 브라우저 default 그대로 (network 직통).
 *
 * 주의:
 *   - 본 파일을 수정하면 모든 사용자에 강제 갱신. 캐시 정책 도입 시
 *     별도 라운드에서 신중히 (cache-busting 전략 + 정산 영역 절대 제외).
 */

self.addEventListener("install", (event) => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  // R-sw-purge (2026-06-26): 활성 시 모든 cache 삭제. 사용자 브라우저에 캐시된
  //   옛 SW 의 staleWhileRevalidate 가 Response body 재사용 → "clone on Response"
  //   TypeError 폭발 (콘솔 54+9건). 이번 SW 가 install 되면 옛 캐시 정리.
  event.waitUntil(
    (async () => {
      try {
        const keys = await self.caches.keys()
        await Promise.all(keys.map((k) => self.caches.delete(k)))
      } catch (e) {
        // best-effort
      }
      await self.clients.claim()
    })(),
  )
})

// fetch handler 미등록 — 모든 요청 network 통과.
