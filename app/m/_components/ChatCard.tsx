"use client"
import Link from "next/link"
import { cn } from "../_lib/cn"
import { fmtRelative } from "../_lib/format"
import type { ChatRoom } from "../_hooks/useMobileData"

export function ChatCard({ room }: { room: ChatRoom }) {
  const isHot = room.unread_count >= 3
  return (
    <Link
      href={`/m/chat/${encodeURIComponent(room.id)}`}
      className={cn(
        "block bg-[#FFFCF6] rounded-xl px-3 py-2.5 transition-colors border border-[#D8D2C8]/50",
        room.unread_count > 0 && "bg-green-50/50 border-green-500/30",
        isHot && "bg-green-100/50 border-green-500/50",
      )}
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <div className="text-[13px] font-extrabold tracking-tight truncate text-[#2D2B26] flex items-center gap-1.5">
          {room.title}
          {room.unread_count > 0 && (
            <span
              className={cn(
                "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-white text-[10px] font-extrabold",
                isHot ? "bg-green-600" : "bg-[#C49B61]",
              )}
            >
              {room.unread_count}
            </span>
          )}
        </div>
        <div className="text-[10px] font-semibold text-[#7A746A] shrink-0">{fmtRelative(room.last_message_at)}</div>
      </div>
      {room.last_message && (
        <div className={cn("text-[11px] font-medium truncate", room.unread_count > 0 ? "text-[#2D2B26]" : "text-[#7A746A]")}>
          {room.last_message}
        </div>
      )}
    </Link>
  )
}
