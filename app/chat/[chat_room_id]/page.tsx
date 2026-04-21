"use client"

import { use } from "react"
import { useChatMessages } from "../hooks/useChatMessages"
import MessageList from "../components/MessageList"
import ChatComposer from "../components/ChatComposer"

/**
 * ChatRoomPage — composition container.
 *
 * All state/fetch/mutation lives in useChatMessages. This page only renders
 * layout chrome + wires hook return → components.
 *
 * STEP-008.1: no realtime subscription. Messages refresh on visibilitychange
 * (owned by the hook) and via optimistic append on send.
 */

export default function ChatRoomPage({
  params,
}: {
  params: Promise<{ chat_room_id: string }>
}) {
  const { chat_room_id } = use(params)
  const {
    messages, loading, sending, error, setError,
    roomName, hasMore,
    input, setInput,
    messagesEndRef, containerRef,
    send, loadOlder, goBack,
  } = useChatMessages(chat_room_id)

  if (loading) {
    return (
      <div className="min-h-screen bg-[#030814] flex items-center justify-center">
        <div className="text-cyan-400 text-sm">로딩 중...</div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-[#030814] text-white flex flex-col">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 flex-shrink-0">
        <button onClick={goBack} className="text-cyan-400 text-sm">← 목록</button>
        <span className="font-semibold text-sm truncate max-w-[200px]">{roomName}</span>
        <div className="w-12" />
      </div>

      {error && (
        <div className="mx-4 mt-2 p-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
          {error}
          <button onClick={() => setError("")} className="ml-2 underline">닫기</button>
        </div>
      )}

      <MessageList
        messages={messages}
        hasMore={hasMore}
        onLoadOlder={loadOlder}
        endRef={messagesEndRef}
        containerRef={containerRef}
      />

      <ChatComposer
        input={input}
        sending={sending}
        onChange={setInput}
        onSubmit={send}
      />
    </div>
  )
}
