"use client"
/**
 * MoveRoomSheet — 도착 매장 실장/사장이 외부 매장 도착 아가씨의 방을 변경.
 *
 * R-cross-store-room-move (2026-08-31): Marvel → 상한가 dispatch 시 서버가
 *   상한가의 빈 방 1개 자동 배정 → 실제 안내한 방과 다를 수 있음. 상한가
 *   실장이 「지효 → 3번방」 원터치로 이동. 참여자 id 유지 · session_id 만 교체
 *   → entered_at/금액 그대로.
 *
 * flow:
 *   1. useRooms() 로 본 매장 방 목록 로드 (session 정보 포함).
 *   2. 방 grid — 각 방이 active session 있는지 표시.
 *   3. 방 pick → POST /api/sessions/participants/[id]/move-room
 *   4. 성공 시 incoming-staff / rooms invalidate + 닫기.
 */
import { useState } from "react"
import { Sheet } from "./Sheet"
import { useRooms } from "../_hooks/useMobileData"
import { useToast, haptic } from "./Toast"
import { invalidateApi } from "../_hooks/useApi"
import { apiFetch } from "@/lib/apiFetch"
import { cn } from "../_lib/cn"

export function MoveRoomSheet({
  open,
  onClose,
  participantId,
  hostessName,
  currentRoomNo,
}: {
  open: boolean
  onClose: () => void
  participantId: string
  hostessName: string
  currentRoomNo: string | null
}) {
  const rooms = useRooms()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const roomList = (rooms.data?.rooms ?? [])
    .filter((r) => r.is_active !== false)
    .sort((a, b) => a.room_no.localeCompare(b.room_no, undefined, { numeric: true }))

  async function move(roomUuid: string, roomNo: string) {
    if (busy) return
    if (roomNo === currentRoomNo) {
      toast("이미 해당 방입니다.", "info")
      onClose()
      return
    }
    setBusy(true)
    haptic([10, 30, 10])
    try {
      const res = await apiFetch(
        `/api/sessions/participants/${encodeURIComponent(participantId)}/move-room`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_room_uuid: roomUuid }),
        },
      )
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.message ?? `HTTP ${res.status}`)
      toast(`${hostessName} → ${roomNo}번방 이동`, "success")
      invalidateApi("/api/manager/incoming-staff")
      invalidateApi("/api/rooms")
      invalidateApi("/api/building/rooms")
      onClose()
    } catch (e) {
      toast(`이동 실패: ${(e as Error).message}`, "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="px-5 pb-4 pt-2">
        <div className="mb-3 rounded-2xl bg-[#FAF5EC] border border-[#D8D2C8] px-4 py-3">
          <div className="text-[10px] font-extrabold text-[#7A746A] uppercase tracking-widest">
            방 이동
          </div>
          <div className="mt-1 text-[13px] font-extrabold text-[#2D2B26]">
            {hostessName}
            {currentRoomNo && (
              <span className="ml-2 text-[11px] font-bold text-[#A87D45]">
                현재: {currentRoomNo}번방
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] font-bold text-[#7A746A]">
            이동할 방을 선택하세요 · 시간/금액 유지
          </div>
        </div>

        {rooms.isLoading && (
          <div className="grid grid-cols-4 gap-1.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-14 rounded-xl bg-[#EFEBE3] animate-pulse" />
            ))}
          </div>
        )}

        {!rooms.isLoading && (
          <div className="grid grid-cols-4 gap-1.5 mb-3">
            {roomList.map((r) => {
              const isCurrent = r.room_no === currentRoomNo
              const isActive = !!r.session
              return (
                <button
                  key={r.id}
                  type="button"
                  disabled={busy || isCurrent}
                  onClick={() => move(r.id, r.room_no)}
                  className={cn(
                    "rounded-xl py-3 border-2 text-[13px] font-extrabold text-center transition-all",
                    isCurrent
                      ? "border-[#A87D45] bg-[#C49B61]/20 text-[#2D2B26] cursor-default opacity-70"
                      : isActive
                        ? "border-amber-300 bg-amber-50 text-amber-800 active:bg-amber-100"
                        : "border-[#D8D2C8] bg-white text-[#2D2B26] active:bg-[#FAF5EC]",
                    busy && "opacity-40 cursor-wait",
                  )}
                >
                  <div>{r.room_no}</div>
                  <div className="text-[8px] font-bold mt-0.5">
                    {isCurrent ? "현재" : isActive ? "합류" : "빈방"}
                  </div>
                </button>
              )
            })}
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="w-full rounded-xl border-2 border-[#D8D2C8] bg-white px-6 py-3 text-[13px] font-extrabold text-[#7A746A] disabled:opacity-40"
        >
          취소
        </button>
      </div>
    </Sheet>
  )
}
