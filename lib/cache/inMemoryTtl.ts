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
 *
 * 2026-05-03 R-Cold-SWR: stale-while-revalidate 추가.
 *   기존 동작: TTL 만료 → 다음 요청이 fresh fetch 동안 (200ms~4s) 기다림.
 *   새 동작: stale 반환 즉시 + 백그라운드 fetch 로 다음 요청부터 fresh.
 *     softTtlMs = TTL (이 시점부터 백그라운드 refresh)
 *     hardTtlMs = TTL × 4 (이 시점 넘으면 stale 도 못 줌, blocking fetch)
 *   콜드 cache (entry 자체가 없음) 만 첫 요청이 기다림.
 */

type Entry<T> = {
  value: T
  /** 이 시각이 지나면 stale — 백그라운드 refresh 로 갈음. */
  staleAt: number
  /** 이 시각이 지나면 stale 도 무효 — 무조건 blocking fetch. */
  hardExpiresAt: number
  /** 백그라운드 refresh 진행 중인지. 중복 fetch 방지. */
  refreshing: boolean
}

const stores: Map<string, Map<string, Entry<unknown>>> = new Map()

function bucket(scope: string): Map<string, Entry<unknown>> {
  let m = stores.get(scope)
  if (!m) { m = new Map(); stores.set(scope, m) }
  return m
}

/**
 * 캐시 또는 fresh fetch.
 *   key 는 scope 안에서 유일. store-scoped 라면 scope = "rooms", key = store_uuid.
 *
 * 행동:
 *   - 캐시 미스 → blocking fetch (콜드 path).
 *   - 캐시 fresh (now < staleAt) → 즉시 반환.
 *   - 캐시 stale (staleAt ≤ now < hardExpiresAt) → stale 반환 + 백그라운드 refresh.
 *   - 캐시 hard expired (now ≥ hardExpiresAt) → blocking fetch.
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

  // 캐시 미스 또는 hard expired → blocking fetch.
  if (!e || now >= e.hardExpiresAt) {
    const value = await fetcher()
    m.set(key, {
      value,
      staleAt: now + ttlMs,
      hardExpiresAt: now + ttlMs * 4,
      refreshing: false,
    })
    return value
  }

  // 캐시 fresh → 즉시 반환.
  if (now < e.staleAt) return e.value

  // 캐시 stale (TTL 지났지만 hardTtl 아직 살아있음) → stale 반환 +
  // 백그라운드 refresh (이미 refreshing 이 아닐 때만).
  if (!e.refreshing) {
    e.refreshing = true
    void fetcher()
      .then((value) => {
        const ts = Date.now()
        m.set(key, {
          value,
          staleAt: ts + ttlMs,
          hardExpiresAt: ts + ttlMs * 4,
          refreshing: false,
        })
      })
      .catch(() => {
        // refresh 실패 — refreshing flag 만 풀고 stale 유지. 다음 요청이 다시 시도.
        const cur = m.get(key) as Entry<T> | undefined
        if (cur) cur.refreshing = false
      })
  }
  return e.value
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
