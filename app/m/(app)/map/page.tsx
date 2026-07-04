"use client"
import { useState } from "react"
import { PageHeader } from "../../_components/PageHeader"
import { TabBar } from "../../_components/TabBar"
import { useApi } from "../../_hooks/useApi"
import { getStoreColor } from "../../_lib/storeColor"

/**
 * 5~8층 빌딩 방 지도 (/m/map).
 *   - 층 탭 (5/6/7/8)
 *   - 각 매장별 방 grid — 색상 = 상태 (idle=회색, active=매장색, 임박=빨강)
 *   - 방 클릭 → 하단 시트에 세션 정보
 *
 * R-building-map (2026-06-28).
 */
type Room = {
  room_uuid: string
  room_no: string
  status: "active" | "idle"
  session_id?: string
  remaining_min?: number | null
  category?: string | null
  participant_names?: string[]
}
type Store = {
  store_uuid: string
  store_name: string
  rooms: Room[]
}
type FloorData = {
  floors: Array<{ floor: number; stores: Store[] }>
}

export default function BuildingMapPage() {
  const [selectedFloor, setSelectedFloor] = useState<number>(5)
  const [detailRoom, setDetailRoom] = useState<{ store: Store; room: Room } | null>(
    null,
  )
  const { data, isLoading } = useApi<FloorData>("/api/rooms/building-map", {
    ttl: 15_000,
  })

  const floors = data?.floors ?? []
  const cur = floors.find((f) => f.floor === selectedFloor)

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="방 지도" subtitle="5~8층 실시간" backHref="/m" />

      <div className="px-5 pb-24">
        {/* 층 탭 */}
        <div className="flex bg-[#EFEBE3] rounded-2xl p-1 mb-3">
          {[5, 6, 7, 8].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setSelectedFloor(f)}
              className={`flex-1 py-2.5 text-[12px] font-extrabold rounded-xl transition-colors ${
                selectedFloor === f
                  ? "bg-white text-[#2D2B26] shadow-sm"
                  : "text-[#7A746A]"
              }`}
            >
              {f}층
            </button>
          ))}
        </div>

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-24 rounded-2xl bg-[#EFEBE3] animate-pulse"
              />
            ))}
          </div>
        )}

        {cur && cur.stores.length === 0 && (
          <div className="text-center text-[12px] text-[#7A746A] py-8">
            {selectedFloor}층에 매장이 없습니다
          </div>
        )}

        {/* 매장별 방 grid */}
        <div className="space-y-3">
          {cur?.stores.map((store) => {
            const color = getStoreColor(store.store_name)
            const activeCount = store.rooms.filter((r) => r.status === "active").length
            return (
              <div
                key={store.store_uuid}
                className="bg-white rounded-2xl border-2 overflow-hidden shadow-sm"
                style={{ borderColor: color.border }}
              >
                {/* 매장 헤더 */}
                <div
                  className="px-3 py-2 flex items-center justify-between"
                  style={{ background: color.headerBg }}
                >
                  <div
                    className="text-[13px] font-extrabold"
                    style={{ color: color.headerText }}
                  >
                    {store.store_name}
                  </div>
                  <div
                    className="text-[10px] font-bold"
                    style={{ color: color.headerText }}
                  >
                    {activeCount}/{store.rooms.length}방 사용중
                  </div>
                </div>
                {/* 방 grid */}
                <div className="grid grid-cols-5 gap-1.5 p-2">
                  {store.rooms.map((r) => (
                    <RoomCell
                      key={r.room_uuid}
                      room={r}
                      storeColor={color}
                      onClick={() => setDetailRoom({ store, room: r })}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 방 상세 시트 */}
      {detailRoom && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-end"
          onClick={() => setDetailRoom(null)}
        >
          <div
            className="w-full bg-white rounded-t-3xl p-5 space-y-3 max-w-[420px] mx-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div className="text-[10px] font-bold text-[#7A746A] uppercase tracking-widest">
                {detailRoom.store.store_name}
              </div>
              <div className="text-[24px] font-extrabold tracking-tight">
                🚪 {detailRoom.room.room_no}번방
              </div>
            </div>

            {detailRoom.room.status === "idle" ? (
              <div className="bg-[#EFEBE3] rounded-2xl p-4 text-center text-[12px] font-semibold text-[#7A746A]">
                💤 대기 중
              </div>
            ) : (
              <>
                <div className="bg-green-50 border border-green-200 rounded-2xl p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[11px] font-extrabold text-green-800">
                      🟢 일하는 중 · {detailRoom.room.category ?? "?"}
                    </div>
                    {detailRoom.room.remaining_min != null && (
                      <div
                        className={`text-[14px] font-extrabold tabular-nums ${
                          detailRoom.room.remaining_min <= 10
                            ? "text-red-600"
                            : "text-green-700"
                        }`}
                      >
                        {detailRoom.room.remaining_min > 0
                          ? `${detailRoom.room.remaining_min}분`
                          : "종료"}
                      </div>
                    )}
                  </div>
                  {detailRoom.room.participant_names &&
                    detailRoom.room.participant_names.length > 0 && (
                      <div className="text-[12px] font-bold text-[#2D2B26] mt-1">
                        {detailRoom.room.participant_names.join(", ")}
                      </div>
                    )}
                </div>
              </>
            )}

            <button
              type="button"
              onClick={() => setDetailRoom(null)}
              className="w-full bg-[#EFEBE3] rounded-2xl py-3 text-[13px] font-extrabold"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      <TabBar />
    </div>
  )
}

function RoomCell({
  room,
  storeColor,
  onClick,
}: {
  room: Room
  storeColor: { stripe: string; border: string; headerBg: string; headerText: string }
  onClick: () => void
}) {
  const isActive = room.status === "active"
  const isUrgent =
    isActive &&
    room.remaining_min != null &&
    room.remaining_min > 0 &&
    room.remaining_min <= 10
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative aspect-square rounded-lg text-[10px] font-extrabold flex items-center justify-center border-2 active:scale-95 transition-transform ${
        isUrgent ? "animate-pulse" : ""
      }`}
      style={{
        background: isActive ? storeColor.headerBg : "#EFEBE3",
        borderColor: isUrgent
          ? "rgb(239 68 68)"
          : isActive
            ? storeColor.stripe
            : "#D8D2C8",
        color: isActive ? storeColor.headerText : "#7A746A",
      }}
    >
      {room.room_no}
      {isActive && (
        <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-green-500 border border-white" />
      )}
    </button>
  )
}
