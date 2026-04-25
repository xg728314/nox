"use client"

/**
 * ROUND-CLEANUP-002 + 2026-04-24 slim 리디자인.
 *
 * 한 스태프 카드 렌더링. 2 rows 슬림 레이아웃:
 *   Row 1 — 이름 · status 배지 · (BLE 배지) · 출근 토글 · 근무기록 버튼
 *   Row 2 — 미니 통계 (출근일·갯수·연속결근) — 1줄 컴팩트
 *
 * 등급(S/A/B/C) UI 는 2026-04-24 제거됨.
 * 비즈니스 로직 변경 없음. 모든 값/핸들러는 props 로 주입.
 */

import {
  STATUS_STYLES,
  type StaffAnalytics,
  type Criteria,
} from "./staffTypes"
import AttendanceToggle from "./AttendanceToggle"

type Props = {
  a: StaffAnalytics
  criteria: Criteria | null
  canManageStaff: boolean
  attendanceOn: boolean
  attendanceBusy: boolean
  bleLive: boolean
  userRole: string | null
  myMembershipId: string
  onToggleAttendance: (membershipId: string, currentlyOn: boolean) => void
  onOpenWorkLog: (membershipId: string, name: string) => void
}

export default function HostessCard({
  a,
  criteria,
  canManageStaff,
  attendanceOn,
  attendanceBusy,
  bleLive,
  userRole,
  myMembershipId,
  onToggleAttendance,
  onOpenWorkLog,
}: Props) {
  const stStyle = STATUS_STYLES[a.status]
  const daysWarn = a.attendance.days < (criteria?.minDays ?? 3)
  const sessWarn = a.performance.total_sessions < (criteria?.perfThreshold ?? 5)

  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 hover:bg-white/[0.05] transition-colors">
      {/* Row 1: name · status · attendance controls (single line) */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-white truncate flex-1 min-w-0">{a.name}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap ${stStyle.bg} ${stStyle.text} ${stStyle.border}`}>
          {a.status}
        </span>
        {canManageStaff && (
          <AttendanceToggle
            membershipId={a.membership_id}
            hostessName={a.name}
            managerMembershipId={a.manager_membership_id}
            attendanceOn={attendanceOn}
            busy={attendanceBusy}
            bleLive={bleLive}
            userRole={userRole}
            myMembershipId={myMembershipId}
            onToggle={onToggleAttendance}
            onOpenWorkLog={onOpenWorkLog}
          />
        )}
      </div>

      {/* Row 2: mini stats — single compact line */}
      <div className="mt-1 flex items-center gap-3 text-[10px] text-slate-500">
        <span>
          출근{" "}
          <b className={daysWarn ? "text-amber-400" : "text-slate-300"}>
            {a.attendance.days}일
          </b>
          <span className="text-slate-600"> ({a.attendance.rate}%)</span>
        </span>
        <span>
          갯수{" "}
          <b className={sessWarn ? "text-orange-400" : "text-slate-300"}>
            {a.performance.total_sessions}건
          </b>
        </span>
        {a.attendance.consecutive_absent > 0 && (
          <span>
            연속결근{" "}
            <b className={a.attendance.consecutive_absent >= 3 ? "text-red-400" : "text-slate-400"}>
              {a.attendance.consecutive_absent}일
            </b>
          </span>
        )}
      </div>
    </div>
  )
}
