"use client"

import type { Message } from "../hooks/useChatMessages"
import MessageBubble from "./MessageBubble"

/**
 * MessageList — renders the scrollable message list with "load older" header
 * and end-of-list anchor ref. Pure UI.
 */

type Props = {
  messages: Message[]
  hasMore: boolean
  onLoadOlder: () => void
  endRef: React.RefObject<HTMLDivElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
}

function MessageList(
  { messages, hasMore, onLoadOlder, endRef, containerRef }: Props,
) {
  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
      {hasMore && (
        <button
          onClick={onLoadOlder}
          className="w-full text-center text-xs text-slate-500 py-2 hover:text-slate-300"
        >
          이전 메시지 불러오기
        </button>
      )}

      {messages.length === 0 && (
        <div className="text-center py-12 text-slate-500 text-sm">
          아직 메시지가 없습니다. 첫 메시지를 보내보세요.
        </div>
      )}

      {messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)}

      <div ref={endRef} />
    </div>
  )
}

// Refs are passed as props (parent-owned by useChatMessages), no forwardRef needed.
export default MessageList
