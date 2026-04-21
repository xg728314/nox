"use client"

import { useCallback, useEffect, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"

/**
 * useChatUnread — self-scope total unread count for the chat nav badge.
 *
 * Design (STEP-009.5):
 *   - Single scalar: the sum of the caller's chat_participants.unread_count
 *     across all active memberships in their store. Server-owned, per
 *     STEP-008.3's atomic increment guarantee.
 *   - No realtime (STEP-008.1 stance preserved). Refresh on:
 *       a) mount
 *       b) tab refocus (visibilitychange)
 *       c) fixed 7s poll (STEP-009.6) — keeps the badge in sync with the
 *          rooms list's own polling after leave/close actions, so the badge
 *          never lags the list. Polling pauses while the tab is hidden to
 *          avoid needless load.
 *       d) explicit caller refresh() — e.g. after navigating back from a
 *          room detail page, the rooms list hook can call refresh() to
 *          pick up the zero-reset that GET /api/chat/messages just did.
 *
 * Does NOT own JSX. Consumer mounts the scalar into a badge component.
 */

type UseChatUnreadReturn = {
  totalUnread: number
  loading: boolean
  refresh: () => Promise<void>
}

export function useChatUnread(): UseChatUnreadReturn {
  const [totalUnread, setTotalUnread] = useState(0)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch("/api/chat/unread")
      if (res.ok) {
        const d = await res.json()
        setTotalUnread(Number(d.unread_count ?? 0))
      }
    } catch { /* swallow — badge is best-effort */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    refresh()
    // STEP-009.6: match the rooms-list cadence (7s) so the badge and the
    // list never drift after a leave/close. Polling pauses on hidden tabs.
    const POLL_MS = 7000
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return
      refresh()
    }, POLL_MS)
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refresh()
      }
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [refresh])

  return { totalUnread, loading, refresh }
}
