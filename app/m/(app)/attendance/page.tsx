"use client"
import { useState } from "react"
import { PageHeader } from "../../_components/PageHeader"
import { TabBar } from "../../_components/TabBar"
import { useHostesses, useAttendance } from "../../_hooks/useMobileData"
import { useToast, haptic } from "../../_components/Toast"
import { apiFetch } from "@/lib/apiFetch"
import { invalidateApi } from "../../_hooks/useApi"
import { cn } from "../../_lib/cn"

type Status = "present" | "absent" | "on_break"

// R-attendance-enum-fix (2026-06-28): UI Status ↔ DB status 매핑.
//   UI 라벨은 present/on_break/absent 유지 (button 라벨용), DB 는 실제
//   available/in_room/off_duty 저장.
function uiToDb(s: Status): "available" | "in_room" | "off_duty" {
  return s === "present" ? "available" : s === "on_break" ? "in_room" : "off_duty"
}

export default function AttendancePage() {
  const hostesses = useHostesses()
  const attendance = useAttendance()
  const toast = useToast()
  const [pending, setPending] = useState<Set<string>>(new Set())

  const all = hostesses.data?.hostesses ?? []
  const map = new Map((attendance.data?.attendance ?? []).map((a) => [a.membership_id, a]))

  async function setStatus(membershipId: string, status: Status) {
    setPending((s) => new Set(s).add(membershipId))
    haptic(8)
    try {
      const res = await apiFetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          membership_id: membershipId,
          action: status === "present" ? "check_in" : status === "on_break" ? "break" : "check_out",
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      invalidateApi("/api/attendance")
      await attendance.refresh()
      toast("출근 상태 변경", "success")
    } catch (e) {
      toast(`실패: ${(e as Error).message}`, "error")
    } finally {
      setPending((s) => {
        const n = new Set(s)
        n.delete(membershipId)
        return n
      })
    }
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader title="출근 체크" subtitle={`${all.length}명 등록`} backHref="/m/staff" />

      <div className="px-5 pb-24">
        {hostesses.isLoading && <div className="text-center text-[12px] text-[#7A746A] py-6">로딩 중...</div>}
        {all.length === 0 && !hostesses.isLoading && (
          <div className="text-center text-[12px] text-[#7A746A] py-10">등록된 식구가 없습니다</div>
        )}
        <div className="flex flex-col gap-2">
          {all.map((h) => {
            const cur = map.get(h.membership_id)
            const isPending = pending.has(h.membership_id)
            return (
              <div
                key={h.membership_id}
                className="bg-white rounded-2xl border border-[#D8D2C8]/60 px-3 py-2.5 flex items-center gap-3"
              >
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#EFEBE3] to-[#DDD5C5] flex items-center justify-center text-[14px] font-extrabold text-[#A87D45]">
                  {h.hostess_name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-extrabold truncate">{h.hostess_name}</div>
                  <div className="text-[10px] text-[#7A746A] font-semibold truncate">
                    {cur?.status === "available"
                      ? `✓ 출근 ${cur.checked_in_at ? new Date(cur.checked_in_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : ""}`
                      : cur?.status === "in_room"
                        ? "일하는 중"
                        : cur?.status === "assigned"
                          ? "배정됨"
                          : "미출근"}
                  </div>
                </div>
                <div className="flex gap-1">
                  {(["present", "on_break", "absent"] as Status[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={isPending}
                      onClick={() => setStatus(h.membership_id, s)}
                      className={cn(
                        "px-2 py-1.5 rounded-lg text-[10px] font-extrabold transition-colors",
                        cur?.status === uiToDb(s)
                          ? s === "present"
                            ? "bg-green-500 text-white"
                            : s === "on_break"
                              ? "bg-amber-500 text-white"
                              : "bg-[#7A746A] text-white"
                          : "bg-[#EFEBE3] text-[#7A746A]",
                        isPending && "opacity-40",
                      )}
                    >
                      {s === "present" ? "출근" : s === "on_break" ? "휴식" : "결근"}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <TabBar />
    </div>
  )
}
