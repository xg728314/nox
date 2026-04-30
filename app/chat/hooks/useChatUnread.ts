"use client"

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"

/**
 * useChatUnread — self-scope total unread count for the chat nav badge.
 *
 * 2026-05-01 R-Perf-Chat: 별도 polling 제거. rooms 응답에서 derive.
 *   증상: /chat 페이지에서 useChatUnread + useChatRooms 가 동시에 7초 polling
 *     → 한 페이지에서 14 req/min 로 dev 콘솔 로그 폭주 ("아무 작업 안 해도
 *     계속 신호 뜸"). 두 endpoint 가 거의 같은 타이밍에 fire.
 *   원인: rooms 응답에 이미 chat_participants.unread_count 포함되어 있음
 *     (getRoomList 의 enriched). /api/chat/unread 가 같은 sum 을 다시 계산.
 *
 * 변경:
 *   - mount 시 1회 /api/chat/unread (initial seed) — rooms 응답이 들어오기
 *     전 badge 가 0 으로 깜빡이는 것 방지.
 *   - 그 후 setUnreadFromRooms(rooms) caller 가 호출 → polling 제거.
 *   - useChatRooms 가 rooms 응답 받을 때마다 sum 해서 setUnreadFromRooms 호출.
 *   - visibilitychange 시 caller 가 refresh 하므로 본 hook 별도 listener X.
 *
 * 효과: /chat 페이지 polling 14 req/min → 7 req/min (50% 감소).
 *
 * Does NOT own JSX. Consumer mounts the scalar into a badge component.
 */

type UseChatUnreadReturn = {
  totalUnread: number
  loading: boolean
  /** rooms 응답에서 derive 한 unread sum 으로 업데이트. caller=useChatRooms. */
  setUnreadFromRooms: (rooms: ReadonlyArray<{ unread_count: number }>) => void
  /** 명시 reset (/chat/[id] 에서 메시지 읽고 돌아온 후). */
  refresh: () => Promise<void>
}

export function useChatUnread(): UseChatUnreadReturn {
  const [totalUnread, setTotalUnread] = useState(0)
  const [loading, setLoading] = useState(true)

  // mount 시 1회 — rooms 응답 도착 전 badge seed.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch("/api/chat/unread")
        if (cancelled) return
        if (res.ok) {
          const d = await res.json()
          setTotalUnread(Number(d.unread_count ?? 0))
        }
      } catch { /* badge best-effort */ }
      finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  return {
    totalUnread,
    loading,
    setUnreadFromRooms: (rooms) => {
      let sum = 0
      for (const r of rooms) sum += r.unread_count ?? 0
      setTotalUnread(sum)
    },
    refresh: async () => {
      try {
        const res = await apiFetch("/api/chat/unread")
        if (res.ok) {
          const d = await res.json()
          setTotalUnread(Number(d.unread_count ?? 0))
        }
      } catch { /* swallow */ }
    },
  }
}
