/**
 * 스태프동기화 — Service Worker
 *
 * 전략:
 *   - HTML / CSS / SVG → cache-first (즉시 로딩)
 *   - 외부 폰트 (Pretendard CDN) → cache-first
 *   - 외부 이미지 (Unsplash 등) → cache-first
 *
 * 보안:
 *   - 같은 origin 만 캐시 (CDN 폰트 제외)
 *   - sensitive 경로 (api/, auth/) 캐시 X (향후 Phase 3)
 *   - cache poisoning 방지: 응답 OK 만 캐시
 */

const VERSION = 'v1.0.0'
const STATIC_CACHE = `staffsync-static-${VERSION}`
const RUNTIME_CACHE = `staffsync-runtime-${VERSION}`

// 미리 캐시 (필수 자산)
const PRECACHE_URLS = [
  '/m/',
  '/m/index.html',
  '/m/style.css',
  '/m/manifest.json',
  '/m/icon-192.svg',
  '/m/icon-512.svg',
  '/m/staff-list.html',
  '/m/staff.html',
  '/m/chat.html',
  '/m/settle.html',
  '/m/me.html'
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[sw] precache 일부 실패', err)
      })
    )
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const req = event.request

  // 보안: GET 만 처리. POST / PUT 등은 모두 그대로 통과 (캐시 X)
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // 보안: 향후 인증 / API 경로는 캐시 안 함
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/login') ||
    url.pathname.includes('/_next/data/')
  ) {
    return
  }

  // 외부 CDN (Pretendard 폰트) — cache-first
  if (
    url.host === 'cdn.jsdelivr.net' ||
    url.host.endsWith('.unsplash.com')
  ) {
    event.respondWith(cacheFirst(req, STATIC_CACHE))
    return
  }

  // /m/* 정적 자산 — cache-first
  if (url.pathname.startsWith('/m/') || url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE))
    return
  }

  // 기타 — network only
})

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req)
  if (cached) return cached
  try {
    const res = await fetch(req)
    if (res && res.ok) {
      const cache = await caches.open(cacheName)
      cache.put(req, res.clone())
    }
    return res
  } catch (err) {
    return new Response('Offline', { status: 503, statusText: 'Offline' })
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cached = await caches.match(req)
  const fetchPromise = fetch(req)
    .then((res) => {
      if (res && res.ok) {
        caches.open(cacheName).then((cache) => cache.put(req, res.clone()))
      }
      return res
    })
    .catch(() => cached)
  return cached || fetchPromise
}

// 메시지 핸들러 — 클라이언트가 캐시 정리 요청 시
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => caches.delete(k)))
    )
  }
})
