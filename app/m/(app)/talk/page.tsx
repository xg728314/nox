"use client"
import Link from "next/link"
import { useApi } from "../../_hooks/useApi"
import { PageHeader } from "../../_components/PageHeader"
import { TabBar } from "../../_components/TabBar"
import { useMe } from "../../_hooks/useMobileData"

type Room = {
  id: string
  initiator_user_id: string
  counterparty_user_id: string | null
  ad_id: string | null
  region_tag: string | null
  category_tag: string | null
  last_message_at: string
  initiator_unread: number
  counterparty_unread: number
}

export default function TalkListPage() {
  const me = useMe()
  const { data, isLoading } = useApi<{ rooms: Room[] }>(
    "/api/choice-talk/rooms",
    { ttl: 15_000 },
  )
  const rooms = data?.rooms ?? []

  return (
    <div className="flex flex-col min-h-full bg-[#0a0a10] text-white">
      <PageHeader title="초이스톡" backHref="/m/me" />

      <div className="px-4 pb-24">
        <div className="text-[10px] font-bold text-white/50 mb-2 tracking-wider uppercase">
          내 대화방 {rooms.length}
        </div>

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 rounded-2xl bg-white/5 animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && rooms.length === 0 && (
          <div className="text-center py-10 text-white/40">
            <div className="text-[36px] mb-2">💬</div>
            <div className="text-[12px]">아직 대화가 없습니다</div>
            <div className="text-[10px] mt-1">
              채용 광고 → [1:1 채팅] 으로 시작
            </div>
          </div>
        )}

        <div className="space-y-2">
          {rooms.map((r) => {
            const isInitiator = r.initiator_user_id === me.data?.user_id
            const unread = isInitiator ? r.initiator_unread : r.counterparty_unread
            return (
              <Link
                key={r.id}
                href={`/m/talk/${r.id}`}
                className="block bg-white/5 border border-white/10 rounded-2xl px-4 py-3 no-underline text-white active:bg-white/10"
              >
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-purple-500 to-fuchsia-500 flex items-center justify-center text-[14px] font-extrabold shrink-0">
                    💬
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] font-extrabold truncate">
                        {r.category_tag ?? "대화"} · {r.region_tag ?? "?"}
                      </span>
                    </div>
                    <div className="text-[10px] text-white/50 mt-0.5">
                      {new Date(r.last_message_at).toLocaleString("ko-KR", { hour12: false })}
                    </div>
                  </div>
                  {unread > 0 && (
                    <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[9px] font-extrabold flex items-center justify-center shrink-0">
                      {unread}
                    </span>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      </div>

      <TabBar />
    </div>
  )
}
