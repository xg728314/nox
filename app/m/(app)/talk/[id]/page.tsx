"use client"
import { use, useEffect, useRef, useState } from "react"
import { PageHeader } from "../../../_components/PageHeader"
import { apiFetch } from "@/lib/apiFetch"
import { useToast } from "../../../_components/Toast"
import { useMe } from "../../../_hooks/useMobileData"

type Msg = {
  id: string
  sender_user_id: string
  body: string | null
  image_url: string | null
  created_at: string
}

export default function ChoiceTalkRoomPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const me = useMe()
  const toast = useToast()
  const [messages, setMessages] = useState<Msg[]>([])
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  async function fetchMessages() {
    const r = await apiFetch(`/api/choice-talk/rooms/${id}/messages`)
    if (r.ok) {
      const j = await r.json()
      setMessages(j.messages ?? [])
    }
  }

  useEffect(() => {
    fetchMessages()
    const iv = setInterval(fetchMessages, 5000)
    return () => clearInterval(iv)
  }, [id])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages.length])

  async function send() {
    if (!text.trim() || sending) return
    setSending(true)
    try {
      const r = await apiFetch(`/api/choice-talk/rooms/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text.trim() }),
      })
      if (!r.ok) throw new Error("HTTP " + r.status)
      setText("")
      fetchMessages()
    } catch (e) {
      toast(`실패: ${(e as Error).message}`, "error")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-[#0a0a10] text-white">
      <PageHeader title="1:1 채팅" backHref="/m/talk" />

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {messages.map((m) => {
          const mine = m.sender_user_id === me.data?.user_id
          return (
            <div
              key={m.id}
              className={`flex ${mine ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[75%] rounded-2xl px-3 py-2 ${
                  mine
                    ? "bg-purple-500 text-white"
                    : "bg-white/10 text-white"
                }`}
              >
                {m.body && <div className="text-[13px] whitespace-pre-wrap">{m.body}</div>}
                {m.image_url && (
                  <img src={m.image_url} alt="" className="mt-2 rounded-lg max-w-full" />
                )}
                <div className="text-[9px] opacity-60 mt-1">
                  {new Date(m.created_at).toLocaleTimeString("ko-KR", {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="border-t border-white/10 bg-[#0a0a10] px-3 py-3 flex items-center gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="메시지 입력..."
          className="flex-1 bg-white/10 border border-white/10 rounded-full px-4 py-2.5 text-[13px] outline-none placeholder:text-white/40"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !text.trim()}
          className="bg-purple-500 rounded-full px-4 py-2.5 text-[12px] font-extrabold disabled:opacity-40"
        >
          전송
        </button>
      </div>
    </div>
  )
}
