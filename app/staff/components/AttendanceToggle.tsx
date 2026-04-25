"use client"

/**
 * ROUND-CLEANUP-002: extracted from app/staff/page.tsx
 *
 * 카드 하단의 "출근 ON/OFF" 토글 + "근무 기록 +" 버튼 + BLE 감지 배지 묶음.
 *
 * 비즈니스 로직 변경 없음:
 *   - canOperate 계산 동일 (owner | manager+self-assignment)
 *   - attendanceOn / busy 판정 props 로 전달
 *   - 클릭 시 onToggle(membership_id, attendanceOn) / onOpenWorkLog(membership_id, name)
 */

type Props = {
  membershipId: string
  hostessName: string
  managerMembershipId: string | null
  attendanceOn: boolean
  busy: boolean
  bleLive: boolean
  userRole: string | null
  myMembershipId: string
  onToggle: (membershipId: string, currentlyOn: boolean) => void
  onOpenWorkLog: (membershipId: string, name: string) => void
}

export default function AttendanceToggle({
  membershipId,
  hostessName,
  managerMembershipId,
  attendanceOn,
  busy,
  bleLive,
  userRole,
  myMembershipId,
  onToggle,
  onOpenWorkLog,
}: Props) {
  // ROUND-STAFF-2: 조회는 store_shared 로 볼 수 있지만 조작은 자기 담당만.
  //   서버가 403 을 반환하므로 UI 도 동일 규칙으로 disable — spam 방지.
  //   super_admin 은 백엔드에서 bypass; 클라이언트 userRole 기준은 owner / manager 만.
  const canOperate =
    userRole === "owner" ||
    (userRole === "manager" && managerMembershipId === myMembershipId)

  return (
    <div className="flex items-center justify-end gap-1.5 shrink-0">
      {bleLive && (
        <span
          title="최근 10분 내 BLE 감지 (참고)"
          className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20"
        >
          근무중 (BLE)
        </span>
      )}
      <button
        onClick={() => onToggle(membershipId, attendanceOn)}
        disabled={busy || !canOperate}
        title={
          !canOperate
            ? "본인 담당 스태프만 출근/퇴근 처리할 수 있습니다."
            : attendanceOn
            ? "퇴근 처리"
            : "출근 처리"
        }
        className={`text-[11px] px-3 py-1 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          attendanceOn
            ? "bg-emerald-500/15 text-emerald-200 border-emerald-500/25 hover:bg-emerald-500/25"
            : "bg-white/[0.03] text-slate-400 border-white/10 hover:bg-white/[0.08] hover:text-slate-200"
        }`}
      >
        {busy ? "..." : attendanceOn ? "출근 중 · OFF" : "출근 ON"}
      </button>
      <button
        onClick={() => onOpenWorkLog(membershipId, hostessName)}
        disabled={!attendanceOn}
        title={
          attendanceOn ? "근무 기록" : "출근 ON 후 근무등록이 가능합니다."
        }
        className="text-[11px] px-3 py-1 rounded-lg bg-pink-500/15 text-pink-200 border border-pink-500/25 hover:bg-pink-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        근무 기록 +
      </button>
    </div>
  )
}
