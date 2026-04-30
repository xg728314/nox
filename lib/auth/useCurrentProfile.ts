"use client"

/**
 * useCurrentProfile — read-only access to the current user's auth
 * identity, sourced from the server.
 *
 * SECURITY (R-1 remediation):
 *   Previously this hook read `user_id` / `role` / `store_uuid` from
 *   `localStorage`. Those values were client-writable and therefore
 *   untrustworthy — a UI can render or hide menus based on them but
 *   the server was the real gate. Now the hook fetches the values
 *   from `/api/auth/me` (which runs `resolveAuthContext` server-side,
 *   reading the HttpOnly cookie).
 *
 *   Consequences:
 *     - `profile` is `null` until the round-trip completes.
 *     - If the cookie is missing / expired, `/api/auth/me` returns
 *       401 and this hook surfaces `needsLogin = true`. Callers
 *       should redirect to `/login` in that case.
 *     - No fallback to localStorage. Clients that formerly relied on
 *       synchronous localStorage reads must tolerate an async state.
 *
 * 2026-04-28 (perf round):
 *   /counter 첫 진입에서 useCurrentProfile 호출자 3곳
 *   (CounterPageV2, CounterBleMinimapWidget, IssueReportButton 의 직접
 *    fetch) 이 동시에 /api/auth/me 를 3회 친 사실 확인. 모듈 레벨
 *   in-flight 공유 + 30s TTL 캐시로 1회로 수렴. invalidate() 는
 *   로그아웃/membership 변경 시 호출자가 명시적으로 호출.
 *
 *   캐시는 process(=tab) 내부 메모리. SSR 영향 없음 (모듈 자체는
 *   client-only).
 */

import { useEffect, useRef, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"

export type CurrentProfile = {
  user_id: string
  membership_id: string
  store_uuid: string
  /** R-store-name (2026-04-30): 매장 이름. 상단 banner 표시용. null 가능. */
  store_name?: string | null
  role: "owner" | "manager" | "waiter" | "staff" | "hostess"
  membership_status: "approved" | "pending" | "rejected" | "suspended"
  /** R-super-admin-view: 운영자 권한 여부. /api/auth/me 가 자체적으로 노출. */
  is_super_admin?: boolean
}

type State =
  | { loading: true;  profile: null;             needsLogin: false; error: null }
  | { loading: false; profile: CurrentProfile;   needsLogin: false; error: null }
  | { loading: false; profile: null;             needsLogin: true;  error: null }
  | { loading: false; profile: null;             needsLogin: false; error: string }

const INITIAL: State = { loading: true, profile: null, needsLogin: false, error: null }

const TTL_MS = 30_000

let cached: { state: State; ts: number } | null = null
let inFlight: Promise<State> | null = null
const subscribers = new Set<(s: State) => void>()

function publish(s: State) {
  cached = { state: s, ts: Date.now() }
  for (const fn of subscribers) {
    try { fn(s) } catch { /* ignore */ }
  }
}

async function doFetch(): Promise<State> {
  try {
    const r = await apiFetch("/api/auth/me")
    if (r.status === 401 || r.status === 403) {
      return { loading: false, profile: null, needsLogin: true, error: null }
    }
    if (!r.ok) {
      return { loading: false, profile: null, needsLogin: false, error: `HTTP ${r.status}` }
    }
    const data = (await r.json()) as CurrentProfile
    return { loading: false, profile: data, needsLogin: false, error: null }
  } catch (e) {
    return {
      loading: false, profile: null, needsLogin: false,
      error: e instanceof Error ? e.message : "network error",
    }
  }
}

function getOrFetch(): Promise<State> {
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return Promise.resolve(cached.state)
  }
  if (inFlight) return inFlight
  inFlight = doFetch()
    .then((s) => {
      publish(s)
      return s
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/**
 * Force-refresh the cached profile. Call after logout / membership change /
 * password reset so subsequent reads see fresh state.
 */
export function invalidateCurrentProfile(): void {
  cached = null
}

/**
 * Full-state variant. Preferred for new code.
 */
export function useCurrentProfileState(): State {
  // Synchronous initial state — if cache hit, render immediately with data
  // (eliminates the loading flash for second mounts within TTL window).
  const [state, setState] = useState<State>(() => {
    if (cached && Date.now() - cached.ts < TTL_MS) return cached.state
    return INITIAL
  })
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true

    // Subscriber: cache 가 갱신될 때 (다른 호출자가 fetch 완료) 즉시 반영.
    const onPublish = (s: State) => {
      if (mounted.current) setState(s)
    }
    subscribers.add(onPublish)

    // 초기 fetch (캐시 hit 면 동기 resolve).
    void getOrFetch().then((s) => {
      if (mounted.current) setState(s)
    })

    return () => {
      mounted.current = false
      subscribers.delete(onPublish)
    }
  }, [])

  return state
}

/**
 * Backwards-compatible signature: returns just the profile object
 * (or null while loading / unauthenticated). Existing callers keep
 * working without changes. Use `useCurrentProfileState()` when you
 * need to distinguish "loading" from "unauthenticated".
 */
export function useCurrentProfile(): CurrentProfile | null {
  const s = useCurrentProfileState()
  return s.profile
}
