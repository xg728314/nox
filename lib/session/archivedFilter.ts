/**
 * archived_at 컬럼 존재 여부 런타임 감지 (per-table 캐시).
 *
 * 2026-04-25 hotfix v2: 이전 버전은 room_sessions 한 테이블만 probe 하고
 *   결과를 전역 캐시 → 다른 테이블 (credits 등) 에 archived_at 이 없을
 *   경우에도 필터를 적용해서 쿼리 실패. 이제 per-table 로 탐지/캐시.
 *
 * 사용:
 *   const apply = await archivedAtFilter(supabase, "credits")
 *   let q = supabase.from("credits").select(...)
 *   q = apply(q)   // 컬럼이 있으면 필터, 없으면 no-op
 */

import type { SupabaseClient } from "@supabase/supabase-js"

const cache = new Map<string, boolean>()

async function detectColumn(
  supabase: SupabaseClient,
  table: string,
): Promise<boolean> {
  const hit = cache.get(table)
  if (hit !== undefined) return hit
  try {
    const res = await supabase.from(table).select("archived_at").limit(1)
    const has = !res.error
    cache.set(table, has)
    return has
  } catch {
    cache.set(table, false)
    return false
  }
}

/**
 * 해당 table 에 archived_at 이 있으면 `.is("archived_at", null)` 을 적용하는
 * 함수를 반환. 없으면 no-op. table 인자 생략 시 기본 "room_sessions".
 */
export async function archivedAtFilter(
  supabase: SupabaseClient,
  table: string = "room_sessions",
) {
  const has = await detectColumn(supabase, table)
  return function apply<T>(qb: T): T {
    if (!has) return qb
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (qb as any).is("archived_at", null)
  }
}

/** 테스트용 캐시 리셋. */
export function __resetArchivedFilterCacheForTest() {
  cache.clear()
}
