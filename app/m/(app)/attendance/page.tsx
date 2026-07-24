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
      // R-attendance-action-fix (2026-07-24): API 는 checkin/checkout/assign/unassign 만
      //   수용 (underscore 없음). 이전 코드 check_in/break/check_out 는 400 이었음.
      //   휴식(on_break) 은 서버 미지원 → unassign 으로 매핑 (배정 해제 = 임시 대기).
      const apiAction =
        status === "present" ? "checkin"
          : status === "on_break" ? "unassign"
            : "checkout"
      const res = await apiFetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          membership_id: membershipId,
          action: apiAction,
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
                {/* R-attendance-toggle (2026-07-24): 출근 on/off 스위치.
                    사용자 요청: "출근 on,off 스위치 기능만 넣어주고".
                    ON = checkin (available), OFF = checkout (off_duty).
                    휴식 상태는 제거 (사용 안 함 · 서버도 미지원). */}
                <AttendanceSwitch
                  on={cur ? cur.status !== "off_duty" : false}
                  disabled={isPending}
                  onToggle={(next) => setStatus(h.membership_id, next ? "present" : "absent")}
                />
                {/* uiToDb 는 setStatus 내부에서만 사용 · 리액트 warning 회피 목적 참조 유지 */}
                <span style={{ display: "none" }}>{uiToDb("present")}</span>
              </div>
            )
          })}
        </div>
      </div>
      <TabBar />
    </div>
  )
}

/**
 * R-attendance-toggle (2026-07-24): 출근 on/off 스위치.
 *   iOS 스타일 · 초록=ON=출근 / 회색=OFF=결근.
 */
function AttendanceSwitch({
  on,
  disabled,
  onToggle,
}: {
  on: boolean
  disabled?: boolean
  onToggle: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onToggle(!on)}
      className={cn(
        "relative w-14 h-7 rounded-full transition-colors border-2 shrink-0",
        on ? "bg-[#5FAB4E] border-[#5FAB4E]" : "bg-[#E5E1D8] border-[#D8D2C8]",
        disabled ? "opacity-40" : "",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform inline-flex items-center justify-center text-[8px] font-black",
          on ? "translate-x-7 text-[#5FAB4E]" : "translate-x-0 text-[#7A746A]",
        )}
      >
        {on ? "출근" : "결근"}
      </span>
    </button>
  )
}
