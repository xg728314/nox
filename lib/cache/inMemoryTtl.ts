/**
 * R29-perf (2026-04-26): hot endpoint 부하 감소.
 *
 * 380명 동시 사용 + 5초 폴링 패턴이면 /api/rooms, /api/counter/monitor 같은
 * read-heavy endpoint 가 매장당 분당 ~300 req. DB 직격으로 가면 connection pool
 * 고갈 + 슬로우 쿼리 누적.
 *
 * 해결: process-local in-memory TTL 캐시.
 *   - Vercel serverless 마다 별개 프로세스 → 일관성 보장 X
 *   - mutation 후 stale 도 일정 — TTL 짧게 (3~5초) 운영
 *   - 매장별 키 분리 (cross-store 누설 방지)
 *
 * 더 강한 캐시 (Redis / Upstash) 는 R30+ 후속 라운드.
 */

type Entry<T> = { value: T; expiresAt: number }

const stores: Map<string, Map<string, Entry<unknown>>> = new Map()

function bucket(scope: string): Map<string, Entry<unknown>> {
  let m = stores.get(scope)
  if (!m) { m = new Map(); stores.set(scope, m) }
  return m
}

/**
 * 캐시 또는 fresh fetch.
 *   key 는 scope 안에서 유일. store-scoped 라면 scope = "rooms", key = store_uuid.
 */
export async function cached<T>(
  scope: string,
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const m = bucket(scope)
  const now = Date.now()
  const e = m.get(key) as Entry<T> | undefined
  if (e && e.expiresAt > now) return e.value
  const value = await fetcher()
  m.set(key, { value, expiresAt: now + ttlMs })
  return value
}

/** mutation 후 명시 invalidate. */
export function invalidate(scope: string, key?: string): void {
  if (key) {
    bucket(scope).delete(key)
  } else {
    stores.delete(scope)
  }
}

/** 디버깅용 — 캐시 통계. */
export function cacheStats(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [scope, m] of stores) out[scope] = m.size
  return out
}
