"use client"

/**
 * ChatUnreadBadge — tiny pill showing the caller's total unread count.
 * Pure UI. Rendered by app/chat/page.tsx in the header next to the title.
 * All state lives in useChatUnread.
 */

type Props = {
  count: number
}

export default function ChatUnreadBadge({ count }: Props) {
  if (count <= 0) return null
  return (
    <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
      {count > 99 ? "99+" : count}
    </span>
  )
}
