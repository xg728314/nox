"use client"

import type { ChatRoom } from "../hooks/useChatRooms"
import ChatRoomListItem from "./ChatRoomListItem"

/**
 * ChatRoomList — renders the room list or an empty-state card.
 * Pure UI.
 */

type Props = {
  rooms: ChatRoom[]
  error: string
  onOpen: (roomId: string) => void
  onTogglePin: (roomId: string, nextPinned: boolean) => void
  onLeave: (roomId: string, type: string, isCreator: boolean) => void
}

export default function ChatRoomList({ rooms, error, onOpen, onTogglePin, onLeave }: Props) {
  if (rooms.length === 0 && !error) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-8 text-center">
        <p className="text-slate-500 text-sm">채팅방이 없습니다.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {rooms.map((room) => (
        <ChatRoomListItem
          key={room.id}
          room={room}
          onClick={onOpen}
          onTogglePin={onTogglePin}
          onLeave={onLeave}
        />
      ))}
    </div>
  )
}
