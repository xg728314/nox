"use client"
import { useCallback, useEffect, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import { invalidateApi } from "./useApi"

/**
 * R-auto-close (2026-06-25): 10분 초과 자동 세션 종료 polling hook.
 *
 *   - 60초 주기 polling. 페이지 mount 즉시 1회 호출.
 *   - 호출 자체가 close 트리거 (멱등) + 최근 30분 내 auto-closed 목록 반환.
 *   - closed_now 발생 시 hostesses + rooms cache invalidate → UI 즉시 갱신.
 *   - recently_closed 가 변하면 setBannerRows 로 부모에 전달 → 배너 표시.
 */

export type AutoClosedRow = {
  participant_id: string
  membership_id: string
  hostess_name: string
  store_name: string
  overdue_minutes: number
  left_at: string
}

const POLL_MS = 60_000

export function useAutoCloseExpired(): { recent: AutoClosedRow[]; refresh: () => Promise<void> } {
  const [recent, setRecent] = useState<AutoClosedRow[]>([])

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch("/api/sessions/auto-close-expired", { method: "POST" })
      if (!res.ok) return
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        closed_now?: AutoClosedRow[]
        recently_closed?: AutoClosedRow[]
      }
      if (j.closed_now && j.closed_now.length > 0) {
        invalidateApi("/api/manager/hostesses")
        invalidateApi("/api/building/hostesses")
        invalidateApi("/api/rooms")
      }
      setRecent(j.recently_closed ?? [])
    } catch {
      /* silent — background polling */
    }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [refresh])

  return { recent, refresh }
}
