"use client"
/**
 * PendingArrivalSheet — 도착 대기 (방 미지정) 아가씨 pool → 방 배정.
 *
 * R-pending-pool (2026-08-31): cross-store/dispatch mode="pending" 결과가
 *   `/api/manager/pending-arrivals` 로 노출됨. 각 항목 = transfer_request
 *   (아직 session_participant 없음). 사용자가 아가씨 → 방 pick → 정식 등록.
 *
 * flow:
 *   1. items 조회 → 카드 목록 (아가씨 · 원소속 매장 · 종목/시간)
 *   2. 카드 클릭 → 확장 (방 grid — 본 매장 useRooms())
 *   3. 방 클릭 → POST /api/manager/pending-arrivals/[id]/assign-room
 *   4. 성공 → 목록에서 사라짐 (invalidate) · rooms / incoming-staff invalidate
 */
import { useMemo, useState } from "react"
import { Sheet } from "./Sheet"
import { usePendingArrivals, useRooms } from "../_hooks/useMobileData"
import { useToast, haptic } from "./Toast"
import { invalidateApi } from "../_hooks/useApi"
import { apiFetch } from "@/lib/apiFetch"
import { cn } from "../_lib/cn"

export function PendingArrivalSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const pending = usePendingArrivals()
  const rooms = useRooms()
  const toast = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const items = pending.data?.items ?? []
  const roomList = useMemo(() => {
    return (rooms.data?.rooms ?? [])
      .filter((r) => r.is_active !== false)
      .sort((a, b) => a.room_no.localeCompare(b.room_no, undefined, { numeric: true }))
  }, [rooms.data])

  async function assign(trId: string, roomUuid: string, roomNo: string, hostessName: string) {
    if (busyId) return
    setBusyId(trId)
    haptic([10, 30, 10])
    try {
      const res = await apiFetch(
        `/api/manager/pending-arrivals/${encodeURIComponent(trId)}/assign-room`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room_uuid: roomUuid }),
        },
      )
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j?.message ?? `HTTP ${res.status}`)
      toast(`${hostessName} → ${roomNo}번방 배정`, "success")
      invalidateApi("/api/manager/pending-arrivals")
      invalidateApi("/api/rooms")
      invalidateApi("/api/building/rooms")
      invalidateApi("/api/manager/incoming-staff")
      setExpandedId(null)
    } catch (e) {
      toast(`배정 실패: ${(e as Error).message}`, "error")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="px-5 pb-4 pt-2">
        <div className="mb-3 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3">
          <div className="text-[10px] font-extrabold text-amber-700 uppercase tracking-widest">
            도착 대기 · 방 배정 필요
          </div>
          <div className="mt-1 text-[13px] font-extrabold text-amber-800">
            {pending.isLoading ? "..." : `${items.length}명`}
          </div>
          <div className="mt-0.5 text-[11px] font-bold text-amber-700/80">
            외부 매장에서 우리 매장으로 보낸 아가씨 · 방 pick 후 정식 등록
          </div>
        </div>

        {pending.isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-16 rounded-2xl bg-[#EFEBE3] animate-pulse" />
            ))}
          </div>
        )}

        {!pending.isLoading && items.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[#D8D2C8] bg-[#FAF5EC]/60 px-4 py-8 text-center">
            <div className="text-[12px] font-bold text-[#7A746A]">✓ 도착 대기 없음</div>
            <div className="mt-1 text-[10px] text-[#7A746A]/70">외부 매장에서 dispatch 되면 여기에 뜹니다</div>
          </div>
        )}

        <div className="space-y-2">
          {items.map((it) => {
            const isExpanded = expandedId === it.transfer_request_id
            const isBusy = busyId === it.transfer_request_id
            return (
              <div key={it.transfer_request_id} className="rounded-2xl border-2 border-amber-300 bg-white overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : it.transfer_request_id)}
                  className="w-full px-4 py-3 text-left active:bg-amber-50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[13px] font-extrabold text-[#2D2B26] truncate">
                        {it.hostess_name}
                        <span className="ml-1.5 text-[10px] font-bold text-[#A87D45]">
                          · {it.category ?? "?"} {it.time_type ?? "?"}
                        </span>
                      </div>
                      <div className="text-[10px] font-semibold text-[#7A746A] mt-0.5">
                        {it.origin_store_name}
                        {it.origin_manager_name && ` · ${it.origin_manager_name}`}
                        · {formatClockTime(it.dispatched_at)}
                      </div>
                    </div>
                    <div className={cn(
                      "text-[10px] font-black px-2 py-1 rounded-full shrink-0",
                      isExpanded ? "bg-[#2D2B26] text-white" : "bg-amber-100 text-amber-700",
                    )}>
                      {isExpanded ? "닫기" : "방 배정"}
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-amber-200 px-3 py-2.5 bg-amber-50/40">
                    <div className="text-[10px] font-bold text-[#7A746A] mb-1.5">방 선택</div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {roomList.map((r) => {
                        const isActive = !!r.session
                        return (
                          <button
                            key={r.id}
                            type="button"
                            disabled={isBusy}
                            onClick={() => assign(it.transfer_request_id, r.id, r.room_no, it.hostess_name)}
                            className={cn(
                              "rounded-xl py-2.5 border-2 text-[13px] font-extrabold text-center transition-all",
                              isActive
                                ? "border-amber-400 bg-amber-100 text-amber-800 active:bg-amber-200"
                                : "border-[#D8D2C8] bg-white text-[#2D2B26] active:bg-[#FAF5EC]",
                              isBusy && "opacity-40 cursor-wait",
                            )}
                          >
                            <div>{r.room_no}</div>
                            <div className="text-[8px] font-bold mt-0.5">
                              {isActive ? "합류" : "빈방"}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-xl border-2 border-[#D8D2C8] bg-white px-6 py-3 text-[13px] font-extrabold text-[#7A746A]"
        >
          닫기
        </button>
      </div>
    </Sheet>
  )
}

function formatClockTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}
