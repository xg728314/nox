---
name: silent-fetch-alarm
description: Supabase / fetch 응답에서 조용한 empty 반환은 데이터 없음이 아닌 fetch 실패일 수 있음. error 무시 · silent fall-back 금지 · 로그 필수.
---

# Silent Fetch Alarm — 조용한 실패 감시

## 배경 (실 사고 · 2026-08-24)
정산 화면 매출이 3,152만 → 0 으로 급락. 사장 · 실장 문의 폭주. 원인:
1. `hostessIds` 배열이 임계값 넘음 → Supabase `.in()` URL 초과
2. `TypeError: fetch failed` 반환
3. 코드: `const { data } = ...; const rows = data ?? []`
4. Error 무시 · 빈 배열로 계산 · 정산 결과 0
5. **사용자 경험: 데이터가 사라진 것처럼 보임**. 실제로는 fetch 자체 실패.

## 규칙

### RULE 1 — `{ data, error }` 분리

**Bad**:
```ts
const { data } = await supabase.from("x").select("*")
const rows = data ?? []
```

**Good**:
```ts
const { data, error } = await supabase.from("x").select("*")
if (error) {
  console.error(JSON.stringify({ tag: "x.fetch.error", err: String(error) }))
  // 조용히 빈 배열 대체 금지 — throw 또는 fail 반환
  throw new Error(`x fetch failed: ${error.message ?? error}`)
}
const rows = data ?? []  // 이제 진짜 empty
```

### RULE 2 — fetch() 응답 status 확인

**Bad**:
```ts
const j = await fetch(url).then(r => r.json())
setItems(j.items ?? [])
```

**Good**:
```ts
const r = await fetch(url)
if (!r.ok) {
  console.error(`fetch ${url} status=${r.status}`)
  setError("연결이 원활하지 않아요")
  return
}
const j = await r.json()
setItems(j.items ?? [])
```

### RULE 3 — 사용자 알림

Fetch 실패는 **사용자에게 알림**:
- Server route: `throw new Error(...)` → 상위 catch → 5xx 응답
- Client: `setError()` state + UI 표시 · toast 등. 조용한 빈 상태 표시 금지 (empty state vs error state 명확 구분)

### RULE 4 — 로그 태그

에러 로그는 `tag: "..."` prefix 로 grep 가능하게:
```ts
console.error(JSON.stringify({ tag: "settle.participations.fetch.fail", err: String(error), ids_len: ids.length }))
```

Watchdog · alerting 이 이 태그로 필터.

## 검사 대상 pattern (grep 로 찾음)

```bash
grep -rn 'data ?? \[\]' app/api lib | grep -v '__tests__'
grep -rn 'catch\(\) *=> *({' app/api lib
grep -rn '\.then((r) => r.ok ? r.json() :' app
```

각 hit 은 검토:
- error 무시 · silent empty 인가?
- 사용자에게 알림 있는가?
- 로그 있는가?

## 특수 케이스

- **rate limit (429)**: silent empty 대신 명시적 429 응답 · 사용자에게 "잠시 후 다시" 안내
- **auth failure (401)**: refresh flow 후 재시도 · 그래도 실패면 로그인 리다이렉트
- **PostgREST 42P01** (table missing): migration 미적용 · 감지 후 명시 오류

## 관련 스킬
- [[chunked-in-fetch]]: 대량 IN 필터로 인한 URL 초과 → fetch 실패 → 이 alarm 대상.
