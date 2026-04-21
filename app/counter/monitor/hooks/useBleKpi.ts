"use client"

/**
 * useBleKpi — polling hook for `/api/ble/feedback/kpi`.
 *
 * Powers the thin accuracy strip + per-user contribution counter.
 * Polls every 30 seconds; any component that calls a feedback /
 * correction mutation should also call `refresh()` immediately for
 * instant UI gratification.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"

export type BleKpi = {
  today_start_iso: string
  store: {
    corrections_today: number
    positive_today: number
    negative_today: number
    accuracy_rate: number // 0..1
    top_problem_zone: string | null
    top_problem_count: number
  }
  me: {
    corrections_today: number
    positive_today: number
    negative_today: number
    contribution_score: number
  }
}

const POLL_MS = 30_000

export function useBleKpi(): {
  kpi: BleKpi | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
} {
  const [kpi, setKpi] = useState<BleKpi | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    mounted.current = false
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const r = await apiFetch("/api/ble/feedback/kpi")
      if (!r.ok) {
        if (!mounted.current) return
        setError(r.status === 401 || r.status === 403 ? "접근 권한이 없습니다." : `로드 실패 (${r.status})`)
        setLoading(false)
        return
      }
      const data = (await r.json()) as BleKpi
      if (!mounted.current) return
      setKpi(data)
      setError(null)
      setLoading(false)
    } catch (e) {
      if (!mounted.current) return
      setError(e instanceof Error ? e.message : "네트워크 오류")
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let stopped = false
    const loop = async () => {
      if (stopped) return
      await refresh()
      if (stopped) return
      timer.current = setTimeout(loop, POLL_MS)
    }
    loop()
    return () => {
      stopped = true
      if (timer.current) clearTimeout(timer.current)
    }
  }, [refresh])

  return { kpi, loading, error, refresh }
}
