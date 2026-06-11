"use client"
import Link from "next/link"
import { cn } from "../_lib/cn"
import { fmtRelative } from "../_lib/format"
import type { ChatRoom } from "../_hooks/useMobileData"

export function ChatCard({ room }: { room: ChatRoom }) {
  const isHot = room.unread_count >= 3

  // 표시 이름: 백엔드 title (display_name) 우선. fallback 단계적으로.
  const displayTitle = room.title || room.display_name || room.name || "채팅방"

  // 참여자 sub-line — 그룹 채팅방에서 참여자 이름 표시
  //   - 사용자가 방 이름을 따로 설정했어도 누가 있는지 보여줌
  //   - default 이름 ("그룹 채팅" 등) 일 경우 displayTitle 자체에 이미 이름이 들어가 있으니 sub 는 생략
  let participantSub: string | null = null
  if (room.type === "group" && (room.participant_names?.length ?? 0) > 0) {
    const names = room.participant_names ?? []
    const total = room.participant_count ?? names.length
    const shown = names.slice(0, 3).join(", ")
    const rest = Math.max(0, total - 1 - Math.min(names.length, 3)) // -1 = 본인
    const fullList = shown + (rest > 0 ? ` 외 ${rest}명` : "")
    // 방 이름이 사용자 설정값이면 (= 자동 생성된 참여자 이름이 아니라면) 별도 sub 로 표시
    if (displayTitle !== fullList) {
      participantSub = fullList
    }
  }

  // 미리보기 — last_message 또는 백엔드 alias
  const preview = room.last_message ?? room.last_message_text ?? null

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
          {displayTitle}
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

      {/* 참여자 이름 (그룹 채팅) */}
      {participantSub && (
        <div className="text-[10px] font-semibold text-[#A87D45] truncate mb-0.5">
          👥 {participantSub}
        </div>
      )}

      {/* 마지막 메시지 미리보기 */}
      {preview && (
        <div className={cn("text-[11px] font-medium truncate", room.unread_count > 0 ? "text-[#2D2B26]" : "text-[#7A746A]")}>
          {preview}
        </div>
      )}
      {!preview && !participantSub && (
        <div className="text-[11px] font-medium text-[#7A746A] italic truncate">아직 메시지가 없습니다</div>
      )}
    </Link>
  )
}
