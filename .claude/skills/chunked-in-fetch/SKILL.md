---
name: chunked-in-fetch
description: NOX Supabase `.in()` filter 사용 시 array 100개 넘으면 chunked fetch 필수. URL 초과로 조용히 empty 반환 → 데이터 없어 보이는 심각 버그.
---

# Chunked IN Fetch — 대량 배열 필터 안전 규칙

## 배경 (실 사고 · 2026-08-24)
- `settlementSummary` route 에서 `hostessIds.length === 430` → URL `~15KB`
- `.in("membership_id", hostessIds)` 로 참여자 조회 → `TypeError: fetch failed` (URL 초과)
- Supabase-js 는 error 반환 · 하지만 route 는 `data ?? []` 로 조용히 빈 배열 사용
- 정산 화면 · 매출 · 식구 지급 · 찡값 **모두 0 표시**. 사장 · 실장 문의 폭주.
- 이전 hostess 357 → 어쩌다 통과 → auto-provisioning 73명 추가 → 430 → 임계값 넘음

## 규칙

### RULE 1 — `.in()` 배열 크기 사전 판단

작성 시 아래 조건 하나라도 해당하면 **chunked fetch 필수**:
- 배열 원소 UUID (36자) 이고 · 크기가 **~50개 이상**일 가능성이 있음
- 배열이 사용자 매장 hostesses · sessions · participants · orders 등 성장 가능
- 초기엔 작아도 seed / auto-provisioning / 시간 흐름으로 증가하는 것

### RULE 2 — Chunked fetch helper 사용

```ts
const IN_CHUNK = 100  // UUID 36자 × 100 = 3.7KB · 안전
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}
async function chunkedFetch<Row>(
  build: (ids: string[]) => Promise<{ data: Row[] | null; error: unknown }>,
): Promise<{ data: Row[]; error: unknown | null }> {
  const chunks = chunk(ids, IN_CHUNK)
  const results = await Promise.all(chunks.map((c) => build(c)))
  const rows: Row[] = []
  let firstErr: unknown | null = null
  for (const r of results) {
    if (r.error && !firstErr) firstErr = r.error
    if (r.data) rows.push(...r.data)
  }
  return { data: rows, error: firstErr }
}
```

`lib/server/queries/manager/settlementSummary.ts` 참조 (실 사용 예).

### RULE 3 — `data ?? []` 후 error 무시 절대 금지

**Bad** (silent 데이터 손실):
```ts
const { data } = await supabase.from("x").select("*").in("id", ids)
const rows = data ?? []
```

**Good** (에러 로그 · 상위 전파):
```ts
const { data, error } = await supabase.from("x").select("*").in("id", ids)
if (error) {
  console.error(JSON.stringify({ tag: "fetch.error", route: "x", err: String(error) }))
  throw new Error(`x fetch failed: ${error.message ?? error}`)
}
const rows = data ?? []
```

또는 chunkedFetch helper 를 통해 → error 값 확인.

### RULE 4 — 진단 로그 필수

`.in()` 뒤에 응답 검증 log:
```ts
console.log(JSON.stringify({
  tag: "perf.x.derive",
  ids_len: ids.length,
  chunks: chunks.length,
  rows: data.length,
  err: error ? String(error) : null,
}))
```

`ids_len` 은 늘어남 → 언젠가 임계값 넘음. 로그 있으면 사후 진단 가능.

## 예외 (chunked 안 해도 되는 경우)
- `.in()` 배열이 **명시적으로 상한** 있음 (예: 요청 body 에서 `limit(20)` 로 항상 20 이하)
- `.eq()` + 단일 값만 사용

의심되면 chunked 로 · 오버헤드는 미미 (병렬 fetch).

## 다른 유사 실패
- **JSON body size 초과**: POST body 에 큰 array 넣을 때. RPC 는 상관 없지만 REST 인터페이스.
- **PostgREST `?column=in.(...)`**: 같은 문제.
- 결론: 항상 chunk.

## 자동 감지
Repo 에서 `.in(` grep 후 배열이 (a) props/state 에서 옴 (b) fetch 결과에서 옴 인 케이스는 리뷰 대상. `.eq()` 로 대체 가능한 것은 대체.
