"use client"

import type { Message } from "../hooks/useChatMessages"

/**
 * MessageBubble — single message row. Pure UI.
 * Handles both regular and system message types.
 */

type Props = {
  msg: Message
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
}

export default function MessageBubble({ msg }: Props) {
  if (msg.message_type === "system") {
    return (
      <div className="text-center">
        <span className="text-xs text-slate-500 bg-white/5 px-3 py-1 rounded-full">
          {msg.content}
        </span>
      </div>
    )
  }

  return (
    <div className={`flex ${msg.is_mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[75%] ${msg.is_mine ? "order-1" : ""}`}>
        {!msg.is_mine && msg.sender_name && (
          <div className="text-xs text-slate-500 mb-1 ml-1">{msg.sender_name}</div>
        )}
        <div className={`rounded-2xl px-3.5 py-2.5 text-sm ${
          msg.is_mine
            ? "bg-cyan-600 text-white rounded-br-md"
            : "bg-white/10 text-slate-200 rounded-bl-md"
        }`}>
          {msg.content}
        </div>
        <div className={`text-xs text-slate-600 mt-0.5 ${msg.is_mine ? "text-right mr-1" : "ml-1"}`}>
          {formatTime(msg.created_at)}
          {msg.is_mine && typeof msg.read_count === "number" && msg.read_count > 0 && (
            <span className="ml-1.5 text-[10px] text-cyan-400">읽음 {msg.read_count}</span>
          )}
        </div>
      </div>
    </div>
  )
}
