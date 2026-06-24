"use client"
import { useEffect, useState, useRef, useCallback } from "react"
import { apiFetch } from "@/lib/apiFetch"

/**
 * 가벼운 useSWR 대체 — fetch + state 관리 + 5초 캐시.
 *
 * 사용:
 *   const { data, error, isLoading, refresh } = useApi<MeResponse>("/api/auth/me")
 */

type ApiState<T> = {
  data: T | null
  error: Error | null
  isLoading: boolean
}

const CACHE = new Map<string, { ts: number; data: unknown }>()
const TTL_MS = 5000

// R-realtime-invalidate (2026-06-25): mount 된 컴포넌트가 invalidate 신호를
//   받고 즉시 re-fetch 하도록 pub/sub. 이전엔 캐시만 비우고 통지 안 해서
//   다음 mount 까지 stale state 유지 → 화면 새로고침 필요했음.
const SUBSCRIBERS = new Map<string, Set<() => void>>()
function subscribe(url: string, cb: () => void): () => void {
  let set = SUBSCRIBERS.get(url)
  if (!set) {
    set = new Set()
    SUBSCRIBERS.set(url, set)
  }
  set.add(cb)
  return () => {
    set!.delete(cb)
    if (set!.size === 0) SUBSCRIBERS.delete(url)
  }
}
function notifyMatching(urlPrefix: string | undefined) {
  if (!urlPrefix) {
    for (const set of SUBSCRIBERS.values()) set.forEach((cb) => cb())
    return
  }
  for (const [url, set] of SUBSCRIBERS) {
    if (url.startsWith(urlPrefix)) set.forEach((cb) => cb())
  }
}

export function useApi<T>(
  url: string | null,
  opts: { ttl?: number; init?: RequestInit } = {},
): ApiState<T> & { refresh: () => Promise<void> } {
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    error: null,
    isLoading: url != null,
  })
  const aliveRef = useRef(true)

  const fetcher = useCallback(async () => {
    if (!url) return
    const ttl = opts.ttl ?? TTL_MS
    const cached = CACHE.get(url)
    if (cached && Date.now() - cached.ts < ttl) {
      if (aliveRef.current) {
        setState({ data: cached.data as T, error: null, isLoading: false })
      }
      return
    }
    if (aliveRef.current) {
      setState((s) => ({ ...s, isLoading: true }))
    }
    try {
      const res = await apiFetch(url, opts.init)
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          // SessionExpiredGate 가 처리
          throw new Error(`AUTH_${res.status}`)
        }
        const txt = await res.text().catch(() => "")
        throw new Error(`HTTP ${res.status}${txt ? `: ${txt.slice(0, 120)}` : ""}`)
      }
      const json = (await res.json()) as T
      CACHE.set(url, { ts: Date.now(), data: json })
      if (aliveRef.current) {
        setState({ data: json, error: null, isLoading: false })
      }
    } catch (err) {
      if (aliveRef.current) {
        setState({ data: null, error: err as Error, isLoading: false })
      }
    }
  }, [url, opts.init, opts.ttl])

  // fetcher ref — opts 가 매 렌더 새 객체라도 subscription 은 stable 하게 유지
  const fetcherRef = useRef(fetcher)
  useEffect(() => { fetcherRef.current = fetcher }, [fetcher])

  useEffect(() => {
    if (!url) return
    aliveRef.current = true
    fetcherRef.current()
    const unsub = subscribe(url, () => {
      if (aliveRef.current) fetcherRef.current()
    })
    return () => {
      aliveRef.current = false
      unsub()
    }
  }, [url])

  const refresh = useCallback(async () => {
    if (url) CACHE.delete(url)
    await fetcher()
  }, [url, fetcher])

  return { ...state, refresh }
}

/** 캐시 비우기 + mount 된 컴포넌트 즉시 re-fetch (mutation 후 호출) */
export function invalidateApi(urlPrefix?: string) {
  if (!urlPrefix) {
    CACHE.clear()
    notifyMatching(undefined)
    return
  }
  for (const k of CACHE.keys()) {
    if (k.startsWith(urlPrefix)) CACHE.delete(k)
  }
  notifyMatching(urlPrefix)
}
