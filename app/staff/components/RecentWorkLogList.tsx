"use client"

/**
 * RecentWorkLogList — 최근 근무 로그 목록 (lifecycle 액션 포함).
 *
 * 2026-05-03: app/staff/page.tsx 분할.
 *   순수 표시 + 콜백. 로그 fetch / lifecycle 진행은 부모 (useRecentLogs).
 */

import type { WorkLogRow } from "../hooks/useRecentLogs"

type LifecycleAction = "confirm" | "resolve" | "dispute" | "void"

type Props = {
  recentLogs: WorkLogRow[]
  loading: boolean
  showUnassignedLogs: boolean
  toggleUnassignedLogs: () => void
  loadRecentLogs: () => void
  lifecycleToast: string
  lifecycleBusyId: string | null
  availableActions: (log: WorkLogRow) => LifecycleAction[]
  startLifecycle: (logId: string, action: LifecycleAction) => void
}

function fmtHHMM(iso: string | null): string {
  if (!iso) return "--:--"
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? "--:--"
    : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

export default function RecentWorkLogList({
  recentLogs,
  loading,
  showUnassignedLogs,
  toggleUnassignedLogs,
  loadRecentLogs,
  lifecycleToast,
  lifecycleBusyId,
  availableActions,
  startLifecycle,
}: Props) {
  const unassignedCount = recentLogs.filter((l) => !l.session_manager_membership_id).length
  const visibleRecentLogs = showUnassignedLogs
    ? recentLogs
    : recentLogs.filter((l) => !!l.session_manager_membership_id)

  return (
    <div className="px-4 mt-6">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-slate-300">최근 근무 로그</div>
        <button onClick={loadRecentLogs} className="text-[11px] text-slate-500 hover:text-cyan-300">
          새로고침
        </button>
      </div>
      {lifecycleToast && <div className="mb-2 text-[11px] text-emerald-300">{lifecycleToast}</div>}
      {loading && <div className="text-[11px] text-slate-500">로딩 중...</div>}
      {!loading && recentLogs.length === 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 text-center">
          <p className="text-xs text-slate-500">기록된 근무 로그가 없습니다.</p>
        </div>
      )}

      {/* 담당 실장 없음 토글 */}
      {unassignedCount > 0 && (
        <div className="mb-2 flex items-center justify-between text-[11px]">
          <span className="text-slate-500">
            {showUnassignedLogs
              ? `담당 실장 없음 ${unassignedCount}건 표시됨`
              : `담당 실장 없음 ${unassignedCount}건 숨김`}
          </span>
          <button
            type="button"
            onClick={toggleUnassignedLogs}
            className="text-cyan-300 hover:text-cyan-200 font-medium"
          >
            {showUnassignedLogs ? "담당 실장 없음 로그 숨기기" : "담당 실장 없음 로그 보기"}
          </button>
        </div>
      )}

      {/* 본 목록 또는 안내 */}
      {recentLogs.length > 0 && visibleRecentLogs.length === 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 text-center">
          <p className="text-xs text-slate-500">
            표시할 로그가 없습니다. 모든 항목이 담당 실장 미지정 상태입니다.
          </p>
        </div>
      ) : visibleRecentLogs.length === 0 ? null : (
        <div className="space-y-1.5">
          {visibleRecentLogs.map((log) => {
            const ssot = log.session_started_at
            const regIso = log.created_at
            const workHHMM = fmtHHMM(ssot)
            const regHHMM = fmtHHMM(regIso)
            const showRegDiff = ssot && regIso && ssot !== regIso
            const statusLabel =
              log.status === "pending" || log.status === "draft"
                ? "미확정"
                : log.status === "confirmed"
                  ? "확정"
                  : log.status === "disputed"
                    ? "이의"
                    : log.status === "voided"
                      ? "무효"
                      : log.status === "settled"
                        ? "정산완료"
                        : log.status
            const isTerminal = log.status === "settled" || log.status === "voided"
            const isSameStore =
              !!log.origin_store_uuid &&
              !!log.working_store_uuid &&
              log.origin_store_uuid === log.working_store_uuid
            const hasNoManager = !log.session_manager_membership_id
            const hasNoSessionLink = !log.session_started_at
            return (
              <div
                key={log.id}
                className={`rounded-xl border px-3 py-2 text-[12px] ${
                  isTerminal
                    ? "border-white/[0.04] bg-white/[0.015] opacity-80"
                    : "border-white/[0.06] bg-white/[0.03]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span title="근무 시작시간 (방 담당실장 기준)" className="text-cyan-300 font-mono text-[11px]">
                    {workHHMM}
                  </span>
                  <span
                    className={`font-medium truncate min-w-0 ${
                      log.status === "voided" ? "text-slate-500 line-through" : "text-slate-100"
                    }`}
                  >
                    {log.hostess_name || "?"}
                  </span>
                  <span className="text-slate-500">→</span>
                  <span className="text-slate-300 truncate min-w-0">
                    {log.working_store_name || "?"}
                    {log.room_no ? ` / ${log.room_no}번방` : ""}
                  </span>
                  {log.session_manager_name && (
                    <>
                      <span className="text-slate-500">·</span>
                      <span title="방 담당실장 (근무시간 SSOT)" className="text-purple-300 text-[11px] truncate">
                        {log.session_manager_name}
                      </span>
                    </>
                  )}
                  <span
                    className={`ml-auto text-[10px] px-1.5 py-0.5 rounded border flex-shrink-0 ${
                      log.status === "pending" || log.status === "draft"
                        ? "bg-slate-500/15 text-slate-400 border-slate-500/20"
                        : log.status === "confirmed"
                          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/25"
                          : log.status === "disputed"
                            ? "bg-amber-500/15 text-amber-300 border-amber-500/25"
                            : log.status === "voided"
                              ? "bg-red-500/10 text-red-400 border-red-500/20"
                              : log.status === "settled"
                                ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/25"
                                : "bg-slate-500/15 text-slate-400 border-slate-500/20"
                    }`}
                  >
                    {statusLabel}
                    {isTerminal && <span className="ml-1 opacity-60">· 종착</span>}
                  </span>
                </div>
                {showRegDiff && (
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    등록시각 {regHHMM} · 근무시간 {workHHMM} (방 담당실장 기준)
                  </div>
                )}
                {(isSameStore || hasNoManager || hasNoSessionLink) && !isTerminal && (
                  <div className="flex flex-wrap items-center gap-1 mt-1">
                    {isSameStore && (
                      <span
                        title="본 매장 근무 — cross-store 정산 편입 대상 아님"
                        className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20"
                      >
                        ⚠ 본 매장 (정산 제외)
                      </span>
                    )}
                    {hasNoSessionLink && (
                      <span
                        title="room_sessions 조인 실패 — session 이 삭제되었을 수 있음"
                        className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-300 border border-red-500/20"
                      >
                        ⚠ 세션 링크 없음
                      </span>
                    )}
                    {hasNoManager && !hasNoSessionLink && (
                      <span
                        title="방 담당실장 미지정 — confirm 시 MANAGER_REQUIRED"
                        className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-300 border border-red-500/20"
                      >
                        ⚠ 담당 실장 없음
                      </span>
                    )}
                  </div>
                )}
                {(() => {
                  const acts = availableActions(log)
                  if (acts.length === 0) return null
                  return (
                    <div className="flex gap-1 mt-1.5 justify-end">
                      {acts.includes("confirm") && (
                        <button
                          onClick={() => startLifecycle(log.id, "confirm")}
                          disabled={lifecycleBusyId === log.id}
                          className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 disabled:opacity-50"
                        >
                          확정
                        </button>
                      )}
                      {acts.includes("resolve") && (
                        <button
                          onClick={() => startLifecycle(log.id, "resolve")}
                          disabled={lifecycleBusyId === log.id}
                          className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 disabled:opacity-50"
                        >
                          해결
                        </button>
                      )}
                      {acts.includes("dispute") && (
                        <button
                          onClick={() => startLifecycle(log.id, "dispute")}
                          disabled={lifecycleBusyId === log.id}
                          className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/25 hover:bg-amber-500/25 disabled:opacity-50"
                        >
                          이의
                        </button>
                      )}
                      {acts.includes("void") && (
                        <button
                          onClick={() => startLifecycle(log.id, "void")}
                          disabled={lifecycleBusyId === log.id}
                          className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-slate-400 border border-white/10 hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/30 disabled:opacity-50"
                        >
                          무효
                        </button>
                      )}
                    </div>
                  )
                })()}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
