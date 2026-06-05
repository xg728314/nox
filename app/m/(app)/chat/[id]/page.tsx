"use client"
import { useEffect, useRef, useState } from "react"
import { useParams } from "next/navigation"
import { PageHeader } from "../../../_components/PageHeader"
import { apiFetch } from "@/lib/apiFetch"
import { useToast } from "../../../_components/Toast"
import { fmtHM } from "../../../_lib/format"
import { cn } from "../../../_lib/cn"

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
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const toast = useToast()

  useEffect(() => {
    if (!roomId) return
    setLoading(true)
    apiFetch(`/api/chat/messages?chat_room_id=${encodeURIComponent(roomId)}&limit=50`)
      .then((r) => r.json())
      .then((j) => setMessages(Array.isArray(j?.messages) ? j.messages : []))
      .catch(() => toast("메시지를 불러올 수 없습니다", "error"))
      .finally(() => setLoading(false))
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
    <div className="flex flex-col min-h-full h-[100dvh]">
      <PageHeader title="채팅방" subtitle={roomId.slice(0, 12)} backHref="/m/chat" />

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {loading && <div className="text-center text-[12px] text-[#7A746A] py-6">불러오는 중...</div>}
        {!loading && messages.length === 0 && (
          <div className="text-center text-[12px] text-[#7A746A] py-10">아직 메시지가 없습니다</div>
        )}
        <div className="flex flex-col gap-2">
          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} />
          ))}
        </div>
      </div>

      <div
        className="border-t border-[#D8D2C8]/60 bg-white px-3 py-2 flex items-center gap-2"
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
    </div>
  )
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
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
        <div className={cn("text-[9px] text-[#7A746A] mt-0.5", isMine ? "text-right" : "text-left", "px-1")}>
          {fmtHM(msg.created_at)}
        </div>
      </div>
    </div>
  )
}
