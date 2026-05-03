"use client"

/**
 * StaffOverviewSection — owner 페이지 직원명단 (접힘/펼침).
 *
 * 2026-05-03: app/owner/page.tsx 분할.
 *   순수 UI — staff 배열 + 접힘 상태 + 토글 콜백만 받음.
 */

type StaffMember = {
  membership_id: string
  name: string
  role: string
  status: string
}

export default function StaffOverviewSection({
  staff,
  expandStaff,
  onToggle,
  attendanceOnCount,
  error,
}: {
  staff: StaffMember[]
  expandStaff: boolean
  onToggle: () => void
  attendanceOnCount: number | null
  error: string
}) {
  const managerCount = staff.filter((s) => s.role === "manager").length
  const hostessCount = staff.filter((s) => s.role === "hostess").length

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-3">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-slate-400 text-xs">{expandStaff ? "▼" : "▶"}</span>
          <span className="text-sm font-medium text-slate-300">직원명단</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-slate-500">총 {staff.length}명</span>
          <span className="text-slate-600">·</span>
          <span className="text-blue-300">실장 {managerCount}</span>
          <span className="text-slate-600">·</span>
          <span className="text-purple-300">스태프 {hostessCount}</span>
          {attendanceOnCount !== null && (
            <>
              <span className="text-slate-600">·</span>
              <span className="text-emerald-300">출근 {attendanceOnCount}</span>
            </>
          )}
        </div>
      </button>

      {expandStaff && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-blue-500/10 p-3">
              <div className="text-xs text-slate-400">실장</div>
              <div className="mt-1 text-2xl font-semibold text-blue-300">{managerCount}</div>
            </div>
            <div className="rounded-xl bg-purple-500/10 p-3">
              <div className="text-xs text-slate-400">스태프</div>
              <div className="mt-1 text-2xl font-semibold text-purple-300">{hostessCount}</div>
            </div>
          </div>

          {staff.length === 0 && !error && (
            <div className="text-center py-4">
              <p className="text-slate-500 text-sm">등록된 스태프가 없습니다.</p>
            </div>
          )}

          {staff.length > 0 && (
            <div className="space-y-2">
              {staff.map((s) => (
                <div
                  key={s.membership_id}
                  className="flex items-center justify-between py-2 border-t border-white/5"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs ${
                        s.role === "manager"
                          ? "bg-blue-500/20 text-blue-300"
                          : "bg-purple-500/20 text-purple-300"
                      }`}
                    >
                      {(s.name || "?").slice(0, 1)}
                    </div>
                    <div>
                      <div className="text-sm">{s.name}</div>
                      <div className="text-xs text-slate-500">
                        {s.role === "manager" ? "실장" : "스태프"}
                      </div>
                    </div>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                    {s.status === "approved" ? "승인" : s.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
