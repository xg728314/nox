"use client"
import { useEffect, useRef, useState } from "react"
import { useParams } from "next/navigation"
import { PageHeader } from "../../../_components/PageHeader"
import { TabBar } from "../../../_components/TabBar"
import { apiFetch } from "@/lib/apiFetch"
import { useToast } from "../../../_components/Toast"
import { useMe } from "../../../_hooks/useMobileData"
import { fmtHM } from "../../../_lib/format"
import { cn } from "../../../_lib/cn"
import { ChatPatternAction } from "./ChatPatternAction"

type ChatMessage = {
  id: string
  chat_room_id: string
  sender_membership_id: string | null
  sender_name: string | null
  content: string
  created_at: string
}

export default function ChatRoomPage() {
  const params = useParams<{ id: string }>()
  const roomId = decodeURIComponent(params.id ?? "")
  const me = useMe()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [patternEnabled, setPatternEnabled] = useState(false)
  const [patternBusy, setPatternBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const toast = useToast()

  // 채팅방의 패턴 인식 활성화 상태 조회
  useEffect(() => {
    if (!roomId) return
    apiFetch(`/api/chat/rooms/${encodeURIComponent(roomId)}/pattern-toggle`)
      .then((r) => r.json())
      .then((j) => setPatternEnabled(!!j?.pattern_enabled))
      .catch(() => { /* swallow */ })
  }, [roomId])

  async function togglePattern() {
    if (patternBusy) return
    setPatternBusy(true)
    try {
      const res = await apiFetch(`/api/chat/rooms/${encodeURIComponent(roomId)}/pattern-toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !patternEnabled }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        throw new Error(j?.message ?? `HTTP ${res.status}`)
      }
      setPatternEnabled(!!j.pattern_enabled)
      toast(`패턴 자동 인식 ${j.pattern_enabled ? "활성화" : "비활성화"}`, "success")
    } catch (e) {
      toast(`전환 실패: ${(e as Error).message}`, "error")
    } finally {
      setPatternBusy(false)
    }
  }

  // R-chat-realtime (2026-06-25): 3초 polling 으로 새 메시지 자동 갱신.
  //   기존엔 mount 시 1회만 fetch → 새로고침 해야 새 메시지 보임.
  //   페이지 가시성 hidden 일 땐 polling 중지 (배경 탭 절약).
  useEffect(() => {
    if (!roomId) return
    let cancelled = false
    async function fetchMessages(initial: boolean) {
      if (initial) setLoading(true)
      try {
        const r = await apiFetch(`/api/chat/messages?chat_room_id=${encodeURIComponent(roomId)}&limit=50`)
        const j = await r.json()
        // 서버가 created_at DESC 반환 → UI 는 오래된 위/최신 아래.
        // 한 번에 reverse (in-place 아님, 새 배열).
        const raw = Array.isArray(j?.messages) ? (j.messages as ChatMessage[]) : []
        const next = [...raw].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""))
        if (cancelled) return
        // 중복 제거 — id 기준 (서버는 동일 데이터 반환 가능)
        setMessages((prev) => {
          if (prev.length === next.length) {
            // 같은 길이면 마지막 id 비교로 변경 여부 빠르게 확인
            const lastA = prev[prev.length - 1]?.id
            const lastB = next[next.length - 1]?.id
            if (lastA === lastB) return prev // no change
          }
          return next
        })
      } catch {
        if (initial && !cancelled) toast("메시지를 불러올 수 없습니다", "error")
      } finally {
        if (initial && !cancelled) setLoading(false)
      }
    }
    fetchMessages(true)
    const id = setInterval(() => {
      if (document.visibilityState === "visible") fetchMessages(false)
    }, 3000)
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchMessages(false)
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [roomId, toast])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" })
  }, [messages])

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    try {
      const res = await apiFetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_room_id: roomId, content: text }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const sent = (await res.json()) as ChatMessage
      setMessages((arr) => [...arr, sent])
      setInput("")
    } catch (e) {
      toast(`전송 실패: ${(e as Error).message}`, "error")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="채팅방"
        subtitle={roomId.slice(0, 12)}
        backHref="/m/chat"
        right={me.data?.is_super_admin ? (
          <button
            type="button"
            onClick={togglePattern}
            disabled={patternBusy}
            className={cn(
              "text-[10px] font-extrabold px-2.5 py-1 rounded-full border",
              patternEnabled
                ? "bg-[#C49B61]/15 text-[#A87D45] border-[#C49B61]/40"
                : "bg-white text-[#7A746A] border-[#D8D2C8]",
            )}
            title="운영자 — 메이드 패턴 자동 인식 토글"
          >
            🎯 자동인식 {patternEnabled ? "ON" : "OFF"}
          </button>
        ) : undefined}
      />

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 min-h-[200px]">
        {loading && <div className="text-center text-[12px] text-[#7A746A] py-6">불러오는 중...</div>}
        {!loading && messages.length === 0 && (
          <div className="text-center text-[12px] text-[#7A746A] py-10">아직 메시지가 없습니다</div>
        )}
        <div className="flex flex-col gap-2">
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              msg={m}
              myStoreUuid={me.data?.store_uuid ?? null}
              patternEnabled={patternEnabled}
            />
          ))}
        </div>
      </div>

      <div
        className="sticky bottom-0 z-10 border-t border-[#D8D2C8]/60 bg-white px-3 py-2 flex items-center gap-2"
        style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="메시지 입력"
          className="flex-1 bg-[#F8F4ED] border border-[#D8D2C8] rounded-full px-4 py-2 text-[13px] outline-none focus:border-[#C49B61]"
        />
        <button
          type="button"
          onClick={send}
          disabled={!input.trim() || sending}
          className="w-10 h-10 rounded-full bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white font-extrabold disabled:opacity-40"
        >
          ↑
        </button>
      </div>

      <TabBar />
    </div>
  )
}

function MessageBubble({ msg, myStoreUuid, patternEnabled }: { msg: ChatMessage; myStoreUuid: string | null; patternEnabled: boolean }) {
  // sender_membership_id 가 본인이면 우측 정렬 — 본인 판단은 me 와 비교 필요하나
  //   여기서는 sender_name 가 없으면 본인으로 처리 (보낸 직후)
  const isMine = !msg.sender_name
  return (
    <div className={cn("flex", isMine ? "justify-end" : "justify-start")}>
      <div className="max-w-[78%]">
        {!isMine && msg.sender_name && (
          <div className="text-[10px] font-bold text-[#7A746A] mb-0.5 px-1">{msg.sender_name}</div>
        )}
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2 text-[13px] font-medium",
            isMine
              ? "bg-gradient-to-br from-[#C49B61] to-[#A87D45] text-white rounded-tr-sm"
              : "bg-white border border-[#D8D2C8]/60 text-[#2D2B26] rounded-tl-sm",
          )}
        >
          {msg.content}
        </div>
        {/* R-chat-pattern (2026-06-25): 메시지 자동 파싱 → 확인 버튼.
            운영자가 토글한 채팅방 (pattern_enabled=true) 에서만 렌더. */}
        {patternEnabled && (
          <ChatPatternAction content={msg.content} chatMessageId={msg.id} myStoreUuid={myStoreUuid} />
        )}
        <div className={cn("text-[9px] text-[#7A746A] mt-0.5", isMine ? "text-right" : "text-left", "px-1")}>
          {fmtHM(msg.created_at)}
        </div>
      </div>
    </div>
  )
}
