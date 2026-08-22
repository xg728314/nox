---
name: useApi-perf
description: NOX useApi hook 성능 · cache 동기 hydrate · flicker 제거. 커스텀 SWR 대체. 페이지 이동 체감 속도 개선.
---

# useApi Performance

`app/m/_hooks/useApi.ts` 는 가벼운 useSWR 대체. cache Map + subscribe/notify + TTL 기반 background refresh.

## 핵심 성능 패턴 (2026-08-23 fix)

### 문제: 매 페이지 이동마다 "로딩 중" flash

기존 코드:
```typescript
const [state, setState] = useState({
  data: null,
  error: null,
  isLoading: url != null,  // 항상 true
})
```

**증상**: 캐시 hit 여도 초기 렌더에서 `isLoading: true, data: null` → 컴포넌트가 "로딩 중" 표시 → useEffect 후 cache hit → 데이터 세팅 → 다음 렌더에 데이터 표시. **Flash of loading state**.

### Fix: cache 동기 hydrate

```typescript
const [state, setState] = useState<ApiState<T>>(() => {
  if (!url) return { data: null, error: null, isLoading: false }
  const ttl = opts.ttl ?? TTL_MS
  const cached = CACHE.get(url)
  if (cached && Date.now() - cached.ts < ttl) {
    return { data: cached.data as T, error: null, isLoading: false }
  }
  return { data: null, error: null, isLoading: true }
})
```

**결과**:
- 재방문 (TTL 이내): 즉시 데이터 표시 · flicker 없음
- 첫 방문: 기존 동일 (loading → data)
- TabBar 이동 (조판↔채팅↔정산) 체감 2-3배 향상

## TTL 설정 (useMobileData)

| Hook | TTL |
|---|---|
| useMe | 30s |
| useHostesses | 5s |
| useAttendance | 5s |
| useChatRooms | 5s |
| useRooms | 10s |
| useBuildingRooms | 8s |
| useBuildingHostesses | 30s |
| useServiceTypes | 60s |
| useBuildingStores | 300s |
| useSettlement | 10s |

**TTL 짧을수록** cache miss 잦음 → 매번 fresh fetch. UX 는 정합성 vs 속도 트레이드오프.

## invalidateApi 패턴

mutation 후 관련 캐시 무효화:
```typescript
await apiFetch(`/api/hostesses/${id}/merge`, { method: "POST", ... })
invalidateApi("/api/manager/hostesses")
invalidateApi("/api/building/hostesses")
```

Prefix 기반 · 여러 캐시 한번에 clear.

## Pub/sub 실시간 갱신

mount 된 컴포넌트가 invalidate 신호 받으면 즉시 re-fetch:
```typescript
const unsub = subscribe(url, () => {
  if (aliveRef.current) fetcherRef.current()
})
```

## 자주 하는 실수

- ❌ mutation 후 invalidateApi 안 부름 → UI stale (사용자가 새로고침 해야 함)
- ❌ TTL 너무 짧게 (1s 등) → 매 렌더마다 fetch · 서버 부담
- ❌ TTL 너무 길게 (10분 등) → 다른 사용자 변경 안 보임
- ❌ CACHE 를 localStorage 로 persist 하려 함 → 다른 사용자 데이터 leak 위험

## 다음 개선 후보

- **localStorage backup** — 탭 새로고침 시 즉시 hydrate. 하지만 user-specific data 는 안전 검토 필요
- **Stale-while-revalidate** — cache hit + background refetch (이미 부분 지원)
- **Suspense integration** — React Suspense 로 loading fallback UI 통일
