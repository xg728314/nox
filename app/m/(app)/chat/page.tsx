"use client"
import Link from "next/link"
import { PageHeader } from "../../_components/PageHeader"
import { TabBar } from "../../_components/TabBar"
import { ChatCard } from "../../_components/ChatCard"
import { useChatRooms } from "../../_hooks/useMobileData"

export default function ChatRoomsPage() {
  const { data, isLoading, error } = useChatRooms()
  const rooms = data?.rooms ?? []
  const pinned = rooms.filter((r) => r.type === "global" || r.type === "group")
  const direct = rooms.filter((r) => r.type === "direct" || r.type === "room_session")

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="채팅"
        subtitle="14매장 + 그룹 채팅"
        backHref="/m"
        right={
          <Link
            href="/m/chat/new"
            aria-label="새 채팅"
            className="w-9 h-9 rounded-full bg-[#2D2B26] text-white flex items-center justify-center no-underline"
          >
            ✏
          </Link>
        }
      />

      <div className="px-5 py-3 flex flex-col gap-4 pb-24">
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 rounded-xl bg-[#EFEBE3] animate-pulse" />
            ))}
          </div>
        )}
        {error && <div className="text-center text-red-600 text-[12px] font-semibold py-6">채팅을 불러올 수 없습니다</div>}

        {!isLoading && rooms.length === 0 && (
          <div className="text-center text-[12px] text-[#7A746A] font-semibold py-12">참여 중인 채팅방이 없습니다</div>
        )}

        {pinned.length > 0 && (
          <section>
            <div className="text-[10px] font-extrabold text-[#7A746A] uppercase tracking-wider mb-2 px-1">
              그룹 채팅
            </div>
            <div className="flex flex-col gap-1.5">
              {pinned.map((r) => (
                <ChatCard key={r.id} room={r} />
              ))}
            </div>
          </section>
        )}

        <Link
          href="/m/chat/new"
          className="block rounded-2xl bg-gradient-to-r from-[#C49B61] to-[#A87D45] text-white px-5 py-3 no-underline shadow-md"
        >
          <div className="flex items-center gap-3">
            <span className="text-[18px]">✏</span>
            <div className="flex-1">
              <div className="text-[13px] font-extrabold">새 그룹 채팅 만들기</div>
              <div className="text-[10px] font-semibold opacity-80">실장 / 아가씨 검색 → 그룹 생성</div>
            </div>
            <span className="text-[16px]">→</span>
          </div>
        </Link>

        {direct.length > 0 && (
          <section>
            <div className="text-[10px] font-extrabold text-[#7A746A] uppercase tracking-wider mb-2 px-1">
              1:1 채팅
            </div>
            <div className="flex flex-col gap-1.5">
              {direct.map((r) => (
                <ChatCard key={r.id} room={r} />
              ))}
            </div>
          </section>
        )}
      </div>

      <TabBar />
    </div>
  )
}
