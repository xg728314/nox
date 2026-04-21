"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { apiFetch } from "@/lib/apiFetch"

/**
 * useChatMessages — owns message list + pagination + send + room-name lookup
 * + visibilitychange refetch. Extracted verbatim from
 * app/chat/[chat_room_id]/page.tsx.
 *
 * Does NOT own JSX. Does NOT reintroduce realtime (STEP-008.1 B안).
 */

export type Message = {
  id: string
  chat_room_id: string
  sender_membership_id: string
  sender_name: string | null
  content: string
  message_type: string
  created_at: string
  is_mine: boolean
  // STEP-009.7: per-message read aggregation. read_count is the total
  // number of chat_message_reads evidence rows for this message (includes
  // sender if they ever hit POST /read). is_read_by_me is server-derived
  // from the caller's read cursor.
  read_count?: number
  is_read_by_me?: boolean
}

type UseChatMessagesReturn = {
  messages: Message[]
  loading: boolean
  sending: boolean
  error: string
  setError: (v: string) => void
  roomName: string
  hasMore: boolean
  input: string
  setInput: (v: string) => void
  messagesEndRef: React.RefObject<HTMLDivElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
  send: () => Promise<void>
  loadOlder: () => Promise<void>
  goBack: () => void
}

export function useChatMessages(chatRoomId: string): UseChatMessagesReturn {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [roomName, setRoomName] = useState("채팅")
  const [hasMore, setHasMore] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // STEP-009.7: remember the last message id we've already marked as read
  // so repeat calls within the same "viewing session" are suppressed. This
  // is the hook-side dedupe layer; the server also dedupes via the
  // chat_message_reads unique index.
  const lastMarkedReadRef = useRef<string | null>(null)

  const fetchRoomInfo = useCallback(async () => {
    try {
      const res = await apiFetch("/api/chat/rooms")
      if (res.ok) {
        const data = await res.json()
        const room = (data.rooms ?? []).find((r: { id: string }) => r.id === chatRoomId)
        if (room) setRoomName(room.display_name || "채팅")
      }
    } catch { /* ignore */ }
  }, [chatRoomId])

  // STEP-009.7: mark-as-read with dedupe + hidden-tab guard.
  // Called after a successful initial fetch (no cursor) and after send().
  // Skipped when: tab is hidden, the room has no messages, or the newest
  // message id matches what we last marked. All three conditions keep the
  // /read endpoint off the hot path during routine polling.
  const markAsRead = useCallback(async (latestMessageId: string | null) => {
    if (!latestMessageId) return
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return
    if (lastMarkedReadRef.current === latestMessageId) return
    lastMarkedReadRef.current = latestMessageId
    try {
      await apiFetch(`/api/chat/rooms/${chatRoomId}/read`, { method: "POST" })
    } catch { /* best-effort; cursor is eventual */ }
  }, [chatRoomId])

  const fetchMessages = useCallback(async (cursor?: string) => {
    try {
      let url = `/api/chat/messages?chat_room_id=${chatRoomId}&limit=50`
      if (cursor) url += `&cursor=${cursor}`
      const res = await apiFetch(url)
      if (res.ok) {
        const data = await res.json()
        const fetched = (data.messages ?? []).reverse() as Message[]
        if (cursor) {
          setMessages((prev) => [...fetched, ...prev])
        } else {
          setMessages(fetched)
          // STEP-009.7: on initial / refocus fetch, mark the newest message
          // as read. Paginating older messages must not trigger a read.
          const newest = fetched.length > 0 ? fetched[fetched.length - 1].id : null
          void markAsRead(newest)
        }
        setHasMore(data.has_more ?? false)
      } else {
        setError("메시지를 불러올 수 없습니다.")
      }
    } catch {
      setError("서버 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }, [chatRoomId, markAsRead])

  useEffect(() => {
    fetchMessages()
    fetchRoomInfo()

    // STEP-008.1 hardening: no realtime subscription. Refetch on tab refocus.
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchMessages()
      }
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatRoomId])

  // 초기 로드 후 스크롤
  useEffect(() => {
    if (!loading && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  const send = useCallback(async () => {
    if (!input.trim() || sending) return
    setSending(true)
    try {
      const res = await apiFetch("/api/chat/messages", {
        method: "POST",
        body: JSON.stringify({
          chat_room_id: chatRoomId,
          content: input.trim(),
        }),
      })
      if (res.ok) {
        // Optimistic append — STEP-008.1: realtime is disabled, so the
        // sender's own message must be inserted locally. The POST response
        // body is the authoritative server-returned row (not a guess).
        const data = await res.json()
        const newMsg: Message = {
          id: data.message_id,
          chat_room_id: data.chat_room_id,
          sender_membership_id: data.sender_membership_id,
          sender_name: null,
          content: data.content,
          message_type: data.message_type,
          created_at: data.created_at,
          is_mine: true,
        }
        setMessages((prev) => prev.some((m) => m.id === newMsg.id) ? prev : [...prev, newMsg])
        setInput("")
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
        }, 50)
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.message || "전송 실패")
      }
    } catch {
      setError("서버 오류")
    } finally {
      setSending(false)
    }
  }, [chatRoomId, input, sending])

  const loadOlder = useCallback(async () => {
    if (messages.length === 0) return
    await fetchMessages(messages[0].id)
  }, [messages, fetchMessages])

  const goBack = useCallback(() => {
    router.push("/chat")
  }, [router])

  return {
    messages, loading, sending, error, setError,
    roomName, hasMore,
    input, setInput,
    messagesEndRef, containerRef,
    send, loadOlder, goBack,
  }
}
