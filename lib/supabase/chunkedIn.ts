/**
 * R-chunked-in (2026-08-24, 계승 2026-08-25):
 * Supabase `.in(col, ids)` 필터가 URL 길이 초과로 `TypeError: fetch failed`
 * silent 발생 · 데이터 손실 없이 조용히 빈 배열 반환 · 사용자 화면 값 0/empty.
 *
 * 실 사고 (2건 · 이번 세션):
 *   1. settlementSummary — hostessIds 430 → URL 15KB → 정산 매출 0 (2026-08-24)
 *   2. building/hostesses — profileIds 350 → URL 13KB → 채팅 매칭 empty (2026-08-24)
 *   3. manager/hostesses  — hostessIds 430 → URL 15KB → 조판 홈 empty (2026-08-25)
 *
 * 규칙: UUID (36자) 배열 100개 이상이면 이 helper 사용. 100개 = URL 3.7KB · 안전.
 *
 * 사용:
 *   import { chunkedInFetch } from "@/lib/supabase/chunkedIn"
 *   const { data, error } = await chunkedInFetch<Row>(
 *     ids,
 *     (chunk) => supabase.from("x").select("y").in("id", chunk),
 *   )
 *
 * 관련 스킬: .claude/skills/chunked-in-fetch/SKILL.md
 */

const IN_CHUNK_DEFAULT = 100

export function chunkArray<T>(arr: T[], size = IN_CHUNK_DEFAULT): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function chunkedInFetch<Row>(
  ids: string[],
  build: (chunk: string[]) => Promise<{ data: Row[] | null; error: unknown }>,
  opts: { chunkSize?: number } = {},
): Promise<{ data: Row[]; error: unknown | null }> {
  const chunks = chunkArray(ids, opts.chunkSize ?? IN_CHUNK_DEFAULT)
  const results = await Promise.all(chunks.map((c) => build(c)))
  const rows: Row[] = []
  let firstErr: unknown | null = null
  for (const r of results) {
    if (r.error && !firstErr) firstErr = r.error
    if (r.data) rows.push(...r.data)
  }
  return { data: rows, error: firstErr }
}
