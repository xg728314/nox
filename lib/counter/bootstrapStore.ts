"use client"

/**
 * Counter bootstrap shared store.
 *
 * 2026-04-28 (perf round): /counter 첫 진입에서
 *   - useCounterBootstrap 이 GET /api/counter/bootstrap 호출 (rooms 슬롯 포함)
 *   - useRooms 가 별도로 GET /api/rooms 호출
 * 두 요청이 동시에 떠서 동일한 rooms 데이터를 두 번 받아왔다.
 *
 * 이 모듈은 bootstrap 응답을 단일 in-flight promise + 30s TTL 로 캐싱해서
 * 두 훅이 같은 페이로드를 공유하도록 한다.
 *
 * - getBootstrap()        — 캐시 hit 면 즉시 resolved Promise, miss 면 in-flight 공유.
 * - invalidateBootstrap() — 외부 변이 (예: 새 방 추가) 후 다음 호출에서 재요청 강제.
 *
 * fail-open: bootstrap 실패하면 reject 되어 호출자가 개별 fallback fetch 로 보완.
 */

import { apiFetch } from "@/lib/apiFetch"

export type BootstrapPayload = {
  rooms: {
    store_uuid: string
    business_day_id: string | null
    rooms: unknown[]
  } | null
  chat_unread: number | null
  inventory: { items: unknown[] } | null
  hostess_stats: Record<string, unknown> | null
  hostess_pool: unknown[] | null
  errors?: Record<string, string | null>
  generated_at?: string
}

const TTL_MS = 30_000

let cached: { data: BootstrapPayload; ts: number } | null = null
let inFlight: Promise<BootstrapPayload> | null = null

async function fetchBootstrap(): Promise<BootstrapPayload> {
  const res = await apiFetch("/api/counter/bootstrap")
  if (!res.ok) {
    // 401/403 등은 호출자 책임 (router.push("/login")) — 여기서는 throw
    // 만 해서 호출자가 status 를 분기하도록 한다.
    const status = res.status
    const body = await res.json().catch(() => ({}))
    const err = new Error(`bootstrap_failed_${status}`) as Error & { status: number; body: unknown }
    err.status = status
    err.body = body
    throw err
  }
  const data = (await res.json()) as BootstrapPayload
  return data
}

export function getBootstrap(): Promise<BootstrapPayload> {
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return Promise.resolve(cached.data)
  }
  if (inFlight) return inFlight
  inFlight = fetchBootstrap()
    .then((data) => {
      cached = { data, ts: Date.now() }
      return data
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

export function invalidateBootstrap(): void {
  cached = null
}

/**
 * peekBootstrap — 캐시에 hit 가 있으면 즉시 반환, 없으면 null.
 * 동기 컨텍스트(렌더 함수)에서 사용. 절대 fetch 트리거하지 않는다.
 */
export function peekBootstrap(): BootstrapPayload | null {
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.data
  return null
}
