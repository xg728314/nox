"use client"

import { useCallback, useEffect, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"

/**
 * useMySalesSummary — self-scope sales summary.
 *
 * Data source:
 *   - GET /api/me/settlements (existing, membership-scoped)
 *     returns { settlements, daily_summary }
 *
 * Exposes:
 *   - dailySummary: { date, total_payout, count, finalized }[]
 *   - totals: aggregated across all returned days
 *   - loading / error / refresh
 *
 * Does NOT own:
 *   - account management (useMyAccounts)
 *   - session-level detail (existing /me sessions page)
 *   - store-wide aggregation (out of self scope)
 */

export type MyDailyRow = {
  date: string
  total_payout: number
  count: number
  finalized: number
}

export type MySalesTotals = {
  total_payout: number
  count: number
  finalized: number
  days: number
}

type UseMySalesSummaryReturn = {
  dailySummary: MyDailyRow[]
  totals: MySalesTotals
  loading: boolean
  error: string
  refresh: () => Promise<void>
}

const EMPTY_TOTALS: MySalesTotals = {
  total_payout: 0,
  count: 0,
  finalized: 0,
  days: 0,
}

export function useMySalesSummary(): UseMySalesSummaryReturn {
  const [dailySummary, setDailySummary] = useState<MyDailyRow[]>([])
  const [totals, setTotals] = useState<MySalesTotals>(EMPTY_TOTALS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const refresh = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await apiFetch("/api/me/settlements")
      if (res.ok) {
        const d = await res.json()
        const rows = (d.daily_summary ?? []) as MyDailyRow[]
        setDailySummary(rows)
        setTotals(rows.reduce<MySalesTotals>(
          (acc, r) => ({
            total_payout: acc.total_payout + (r.total_payout || 0),
            count: acc.count + (r.count || 0),
            finalized: acc.finalized + (r.finalized || 0),
            days: acc.days + 1,
          }),
          EMPTY_TOTALS,
        ))
      } else {
        setError("매출 요약을 불러올 수 없습니다.")
      }
    } catch {
      setError("서버 오류")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return { dailySummary, totals, loading, error, refresh }
}
