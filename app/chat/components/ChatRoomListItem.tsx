"use client"

import type { ChatRoom } from "../hooks/useChatRooms"
import { getServerNow } from "@/lib/time/serverClock"

/**
 * ChatRoomListItem — single room row. Pure UI.
 * Accepts two events: click-to-open and pin-toggle. No fetch, no state.
 */

type Props = {
  room: ChatRoom
  onClick: (roomId: string) => void
  onTogglePin: (roomId: string, nextPinned: boolean) => void
  onLeave: (roomId: string, type: string, isCreator: boolean) => void
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return ""
  // 2026-05-03: server-adjusted now — 매장 PC 시계 어긋남 시 "방금"/"5시간 전" 일관.
  const diff = Math.floor((getServerNow() - new Date(dateStr).getTime()) / 60000)
  if (diff < 1) return "방금"
  if (diff < 60) return `${diff}분 전`
  if (diff < 1440) return `${Math.floor(diff / 60)}시간 전`
  return `${Math.floor(diff / 1440)}일 전`
}

function typeIcon(type: string): string {
  return type === "global" ? "🏢"
    : type === "room_session" || type === "room" ? "🚪"
    : type === "group" ? "👥"
    : "💬"
}

function typeLabel(type: string): string {
  return type === "global" ? "전체"
    : type === "room_session" || type === "room" ? "룸"
    : type === "group" ? "그룹"
    : "DM"
}

export default function ChatRoomListItem({ room, onClick, onTogglePin, onLeave }: Props) {
  const isPinned = !!room.pinned_at
  // STEP-009.4: leave button only for types the server allows (direct/group).
  // store/room_session rooms never show the leave button — matches server
  // rejection and avoids a button that can only produce a 403.
  const canLeave = room.type === "direct" || room.type === "group"
  // If the current user created this group, "leaving" auto-closes the room
  // for everyone (server-side). Surface that in the label so the action is
  // never ambiguous.
  const isGroupCreator = room.type === "group" && room.is_creator
  const leaveLabel = isGroupCreator ? "그룹 종료" : "나가기"
  const leaveTitle = isGroupCreator ? "그룹 종료 (모두에게 종료)" : "채팅방 나가기"
  return (
    <div
      onClick={() => onClick(room.id)}
      className={`w-full rounded-2xl border p-4 text-left transition-colors active:scale-[0.98] cursor-pointer ${
        isPinned
          ? "border-cyan-500/30 bg-cyan-500/[0.06] hover:bg-cyan-500/10"
          : "border-white/10 bg-white/[0.04] hover:bg-white/[0.06]"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="text-xl flex-shrink-0">{typeIcon(room.type)}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {isPinned && (
                <span className="text-[10px] text-cyan-300 flex-shrink-0" title="고정됨">📌</span>
              )}
              <span className="text-sm font-medium truncate">{room.display_name}</span>
              <span className="text-xs text-slate-600 flex-shrink-0">{typeLabel(room.type)}</span>
            </div>
            {room.last_message_text && (
              <p className="text-xs text-slate-500 truncate mt-0.5">{room.last_message_text}</p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-2">
          {room.last_message_at && (
            <span className="text-xs text-slate-600">{timeAgo(room.last_message_at)}</span>
          )}
          {room.unread_count > 0 && (
            <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
              {room.unread_count}
            </span>
          )}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onTogglePin(room.id, !isPinned) }}
              className={`text-[11px] px-1.5 py-0.5 rounded ${
                isPinned
                  ? "text-cyan-300 hover:text-cyan-200"
                  : "text-slate-500 hover:text-slate-300"
              }`}
              title={isPinned ? "고정 해제" : "상단 고정"}
            >
              {isPinned ? "고정됨" : "고정"}
            </button>
            {canLeave && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onLeave(room.id, room.type, isGroupCreator) }}
                className={`text-[11px] px-1.5 py-0.5 rounded ${
                  isGroupCreator
                    ? "text-red-300 hover:text-red-200"
                    : "text-slate-500 hover:text-red-300"
                }`}
                title={leaveTitle}
              >
                {leaveLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
