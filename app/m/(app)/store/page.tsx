"use client"
import Link from "next/link"
import { PageHeader } from "../../_components/PageHeader"
import { TabBar } from "../../_components/TabBar"
import { useMe, useRooms } from "../../_hooks/useMobileData"

export default function StoreDetailPage() {
  const me = useMe()
  const rooms = useRooms()
  const activeCount = (rooms.data?.rooms ?? []).filter((r) => r.session).length
  const totalRooms = rooms.data?.rooms.length ?? 0

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title={me.data?.store_name ?? "매장"}
        subtitle={me.data?.store_floor != null ? `${me.data.store_floor}층` : undefined}
        backHref="/m/me"
        right={
          <Link
            href="/m/store/settings"
            aria-label="설정"
            className="w-9 h-9 rounded-full bg-white border border-[#D8D2C8] flex items-center justify-center no-underline"
          >
            ⚙
          </Link>
        }
      />
      <div className="px-5 pb-24 flex flex-col gap-4">
        <div className="bg-white rounded-2xl p-5 border border-[#D8D2C8]/60">
          <div className="text-[10px] font-extrabold text-[#7A746A] uppercase tracking-wider mb-2">현재 운영</div>
          <div className="grid grid-cols-3 gap-2">
            <Stat v={activeCount} l="활성 룸" />
            <Stat v={totalRooms} l="전체 룸" />
            <Stat v={me.data?.role ?? "—"} l="권한" />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#D8D2C8]/60 overflow-hidden">
          <div className="text-[10px] font-extrabold text-[#7A746A] uppercase tracking-wider px-4 pt-3 pb-1">룸 현황</div>
          {rooms.isLoading && <div className="text-center text-[12px] text-[#7A746A] py-6">로딩 중...</div>}
          {rooms.data && rooms.data.rooms.length === 0 && (
            <div className="text-center text-[12px] text-[#7A746A] py-6">등록된 룸이 없습니다</div>
          )}
          {(rooms.data?.rooms ?? []).map((r, i) => (
            <div
              key={r.id}
              className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-[#D8D2C8]/40" : ""}`}
            >
              <span className={`w-2 h-2 rounded-full ${r.session ? "bg-green-500" : "bg-[#D8D2C8]"}`} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-extrabold tracking-tight">{r.room_name || `룸 ${r.room_no}`}</div>
                {r.session && (
                  <div className="text-[10px] font-semibold text-green-700 mt-0.5">
                    {r.session.participant_count}명 · 시작 {new Date(r.session.started_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                )}
              </div>
              {r.session && (
                <div className="text-[12px] font-extrabold text-[#A87D45]">
                  {Math.round((r.session.gross_total ?? 0) / 10000)}만
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <TabBar />
    </div>
  )
}

function Stat({ v, l }: { v: string | number; l: string }) {
  return (
    <div className="text-center">
      <div className="text-[18px] font-extrabold tracking-tight">{v}</div>
      <div className="text-[9px] font-semibold text-[#7A746A] mt-0.5">{l}</div>
    </div>
  )
}
