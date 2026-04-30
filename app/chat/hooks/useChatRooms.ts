"use client"

import { useCallback, useEffect, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import { useCurrentProfile } from "@/lib/auth/useCurrentProfile"

// Global 채팅 자동 참여 허용 role. 서버 가드(SSOT)와 동일 집합 유지.
// 다른 role 은 여전히 /chat 리스트 자체는 열 수 있지만 global 방에는
// 자동으로 upsert 되지 않음. 서버가 추가 방어 (ROLE_FORBIDDEN 403).
const GLOBAL_AUTOJOIN_ROLES: readonly string[] = ["owner", "manager"]

/**
 * useChatRooms — owns the chat rooms list + new-DM modal + auto-join-global
 * behavior extracted verbatim from app/chat/page.tsx.
 *
 * Does NOT own JSX. Consumer page mounts the returned state into components.
 *
 * Navigation rule (post-loop-fix): this hook does NOT perform any
 * router navigation. Auth gates and room-open navigation are the page's
 * responsibility. When the hook detects an expired/missing auth state it
 * surfaces `needsLogin=true` and the page is free to react however it wants
 * (most commonly by pushing to /login). This removes the automatic
 * navigation class that was causing the rooms-list → chat-detail loop.
 */

export type ChatRoom = {
  id: string
  type: string
  display_name: string
  last_message_text: string | null
  last_message_at: string | null
  unread_count: number
  is_active: boolean
  pinned_at: string | null
  // STEP: server-derived flag — true if the caller's membership_id matches
  // chat_rooms.created_by. Used by the list UI to swap "나가기" for "그룹 종료"
  // on group rooms the caller created (leaving auto-closes the room).
  is_creator: boolean
}

export type StaffMember = {
  membership_id: string
  name: string
  role: string
}

type UseChatRoomsReturn = {
  rooms: ChatRoom[]
  loading: boolean
  error: string
  setError: (v: string) => void
  needsLogin: boolean
  showNewDm: boolean
  openNewDm: () => void
  closeNewDm: () => void
  staff: StaffMember[]
  creating: boolean
  createDm: (targetMembershipId: string) => Promise<string | null>
  refresh: () => Promise<void>
  togglePin: (roomId: string, nextPinned: boolean) => Promise<void>
  leaveRoom: (roomId: string) => Promise<void>
}

export function useChatRooms(): UseChatRoomsReturn {
  const [rooms, setRooms] = useState<ChatRoom[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [needsLogin, setNeedsLogin] = useState(false)
  const [showNewDm, setShowNewDm] = useState(false)
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [creating, setCreating] = useState(false)

  const profile = useCurrentProfile()
  const role = profile?.role ?? null

  const fetchRooms = useCallback(async () => {
    try {
      // Global 채팅방 자동 참여 — owner/manager 만. 그 외 role 은 서버 가드
      // (ROLE_FORBIDDEN 403) 로도 차단되지만 불필요한 POST 자체를 생략.
      if (role !== null && GLOBAL_AUTOJOIN_ROLES.includes(role)) {
        await apiFetch("/api/chat/rooms", {
          method: "POST",
          body: JSON.stringify({ type: "global" }),
        })
      }

      const res = await apiFetch("/api/chat/rooms")
      if (res.ok) {
        const data = await res.json()
        setRooms(data.rooms ?? [])
      } else if (res.status === 401 || res.status === 403) {
        // No navigation here — the page observes needsLogin and decides.
        setNeedsLogin(true)
      }
    } catch {
      setError("채팅 목록을 불러올 수 없습니다.")
    } finally {
      setLoading(false)
    }
  }, [role])

  const fetchStaff = useCallback(async () => {
    try {
      const res = await apiFetch("/api/store/staff")
      if (res.ok) {
        const data = await res.json()
        setStaff(data.staff ?? [])
      }
    } catch { /* ignore */ }
  }, [])

  const openNewDm = useCallback(() => {
    setShowNewDm(true)
    fetchStaff()
  }, [fetchStaff])

  const closeNewDm = useCallback(() => {
    setShowNewDm(false)
  }, [])

  const createDm = useCallback(async (targetMembershipId: string): Promise<string | null> => {
    setCreating(true)
    try {
      const res = await apiFetch("/api/chat/rooms", {
        method: "POST",
        body: JSON.stringify({ type: "direct", target_membership_id: targetMembershipId }),
      })
      if (res.ok) {
        const data = await res.json()
        return data.chat_room_id ?? null
      }
      const errData = await res.json().catch(() => ({}))
      setError(errData.message || "채팅방 생성 실패")
      return null
    } catch {
      setError("서버 오류")
      return null
    } finally {
      setCreating(false)
      setShowNewDm(false)
    }
  }, [])

  // openRoom intentionally removed — the page performs router.push on
  // list-item click. Keeping navigation in the page prevents accidental
  // auto-nav from the hook and makes the navigation-loop class impossible.

  const togglePin = useCallback(async (roomId: string, nextPinned: boolean) => {
    try {
      const res = await apiFetch(`/api/chat/rooms/${roomId}/pin`, {
        method: "PATCH",
        body: JSON.stringify({ pinned: nextPinned }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.message || "고정 변경 실패")
        return
      }
      // Refetch to apply the new ordering (pinned → unread → last_message).
      await fetchRooms()
    } catch {
      setError("서버 오류")
    }
  }, [fetchRooms])

  // STEP-009.4: personal leave. Server-side route enforces type gating
  // (direct/group only — store/room_session rejected) and creator-cannot-
  // leave-group semantics. On success, refetch so the left room drops out
  // of the list via the left_at IS NULL filter in /api/chat/rooms.
  const leaveRoom = useCallback(async (roomId: string) => {
    try {
      const res = await apiFetch(`/api/chat/rooms/${roomId}/leave`, { method: "POST" })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.message || "나가기 실패")
        return
      }
      await fetchRooms()
    } catch {
      setError("서버 오류")
    }
  }, [fetchRooms])

  useEffect(() => {
    // Auth now lives in the HttpOnly cookie. We can't peek at it from
    // client JS, so we just fire the fetch; a 401 response surfaces
    // needsLogin via the page's response-handling path.
    fetchRooms()

    // STEP-009.6 + 2026-05-01 R-Perf-Chat:
    //   기존 7s → 15s. 사용자 호소: "아무 작업 안 해도 신호 계속 뜸".
    //   채팅은 실시간성이 어느 정도 필요하지만 7s 는 dev 콘솔 폭주 + server
    //   부하 부담. 15s 면 새 메시지 알림 최대 15초 지연이지만 운영에서
    //   허용 가능. 더 빠르게 필요하면 추후 supabase realtime 도입 라운드.
    const POLL_MS = 15000
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return
      fetchRooms()
    }, POLL_MS)
    const onVisibility = () => {
      if (document.visibilityState === "visible") fetchRooms()
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility)
    }
    return () => {
      clearInterval(interval)
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility)
      }
    }
    // role 이 profile 로드 후 null → "owner" 등으로 1회 전이되면 fetchRooms
    //   closure 가 갱신되어야 global 자동 참여 분기가 실제로 POST 를 쏜다.
    //   그 외에는 변경 없음 (role 은 mount 후 최대 1~2회만 변함).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role])

  return {
    rooms, loading, error, setError,
    needsLogin,
    showNewDm, openNewDm, closeNewDm,
    staff, creating, createDm,
    refresh: fetchRooms,
    togglePin,
    leaveRoom,
  }
}
