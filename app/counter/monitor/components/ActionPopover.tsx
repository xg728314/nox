"use client"

/**
 * ActionPopover — operator action layer.
 *
 * Opens when an operator clicks any participant-linked row on /counter/
 * monitor (map avatar, room list pill, home/foreign panel row, movement
 * feed row). Shows read-only context (name / room / state / elapsed /
 * manager / 연장 횟수) and three explicit human-confirmation buttons:
 *
 *   [일중이다]          still_working — mute absence alerts
 *   [지금 시간까지 끝]  end_now      — monitor hides on next poll
 *   [연장]              extend       — increments extension_count badge
 *
 * Writes go to POST /api/sessions/participants/actions and NEVER to the
 * transactional session/participant/settlement tables. BLE cannot reach
 * this flow: the click handler is user-driven only.
 */

import { useEffect, useMemo, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import type { MonitorBlePresence, MonitorRecommendation, MonitorRoom } from "../types"
import { STATUS_STYLES, elapsedLabel, participantState } from "../statusStyles"
import { REC_LABEL } from "@/lib/counter/monitorAlertsTypes"
import BleFeedbackButtons, { type FeedbackSubject } from "./BleFeedbackButtons"
import ApplyStatusBadge, { isApplyStale } from "./ApplyStatusBadge"
import { useRetryParticipantAction } from "../hooks/useRetryParticipantAction"

export type ActionSubject = {
  participant_id: string
  membership_id: string | null
  room_uuid: string | null
  display_name: string
}

type Props = {
  open: boolean
  subject: ActionSubject | null
  rooms: MonitorRoom[]
  onClose: () => void
  /** Called after a successful action so the parent can refresh. */
  onActionSuccess: () => void
  /** Server-computed + user-filtered alert map (keyed by participant_id). */
  alertsByParticipantId?: Map<string, MonitorRecommendation[]>
  /** When true, render recommendation chips. Controlled by
   *  `counter.monitor_alerts.display.recommendations`. */
  showRecommendations?: boolean
  /** Called when operator clicks [위치 수정]. Parent opens the BLE
   *  correction modal. Popover stays open so context remains visible. */
  onRequestCorrection?: () => void
  /** Current BLE reading per membership — used to pre-populate the
   *  feedback subject with current zone / room so the analytics
   *  layer knows which reading the operator rated. */
  bleByMembership?: Map<string, MonitorBlePresence>
  /** Optional callback after feedback is submitted so parent can
   *  refresh the KPI strip immediately. */
  onFeedbackSubmitted?: () => void
  /** Toggle for the 👍/👎 BLE accuracy quick-taps. Controlled by
   *  `counter.monitor_view_options.show_feedback_buttons`. When
   *  false the row simply does not render. */
  showFeedbackButtons?: boolean
}

type ActionType = "still_working" | "end_now" | "extend"
type StatusState = "idle" | "working" | "ok" | "error"

const LABEL: Record<ActionType, string> = {
  still_working: "일중이다",
  end_now: "지금 시간까지 끝",
  extend: "연장",
}

const CLS: Record<ActionType, string> = {
  still_working: "bg-emerald-500/15 border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/25",
  end_now:       "bg-red-500/15 border-red-500/40 text-red-200 hover:bg-red-500/25",
  extend:        "bg-cyan-500/15 border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/25",
}

export default function ActionPopover({
  open, subject, rooms, onClose, onActionSuccess,
  alertsByParticipantId, showRecommendations = true,
  onRequestCorrection, bleByMembership, onFeedbackSubmitted,
  showFeedbackButtons = false,
}: Props) {
  const [status, setStatus] = useState<StatusState>("idle")
  const [message, setMessage] = useState<string>("")
  const retryHandler = useRetryParticipantAction({ onAfterRetry: onActionSuccess })

  useEffect(() => {
    // Reset transient UI when the subject changes.
    setStatus("idle")
    setMessage("")
  }, [subject?.participant_id])

  // Resolve the latest participant snapshot from rooms. This is the
  // source for name / room / state / elapsed. If the participant vanished
  // (ended, deleted) we still show minimal info from `subject`.
  const resolved = useMemo(() => {
    if (!subject) return null
    for (const r of rooms) {
      for (const p of r.participants) {
        if (p.id === subject.participant_id) {
          return { room: r, participant: p }
        }
      }
    }
    return null
  }, [subject, rooms])

  if (!open || !subject) return null

  const participant = resolved?.participant ?? null
  const room = resolved?.room ?? null
  const state = participant ? participantState(participant.status, participant.zone) : "waiting"
  const style = STATUS_STYLES[state]
  const extensionCount = participant?.extension_count ?? 0
  const operatorStatus = participant?.operator_status ?? "normal"

  // ── Apply / pending state ─────────────────────────────────────────
  // Pending = latest recorded action for this participant differs from
  // the participant's idempotency cursor. Computed purely from server-
  // provided fields — no client-side heuristics.
  const latestActionId = participant?.latest_action_id ?? null
  const lastAppliedActionId = participant?.last_applied_action_id ?? null
  const hasPending = !!latestActionId && latestActionId !== lastAppliedActionId
  const hasAnyAction = !!latestActionId

  const handleAction = async (action: ActionType) => {
    if (!subject) return
    setStatus("working")
    setMessage("")
    try {
      const r = await apiFetch("/api/sessions/participants/actions", {
        method: "POST",
        body: JSON.stringify({
          participant_id: subject.participant_id,
          action,
        }),
      })
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string; message?: string }
        setStatus("error")
        setMessage(body.message ?? body.error ?? "처리 실패")
        return
      }
      setStatus("ok")
      setMessage(
        action === "still_working" ? "일중이다 기록됨 — 반복 알림 음소거. [적용] 을 누르면 실제 상태에 반영됩니다." :
        action === "end_now"       ? "지금 시간까지 끝 기록됨 — [적용] 후 다음 갱신에서 제거됩니다." :
                                     "연장 기록됨 — [적용] 후 연장 횟수가 런타임에 반영됩니다.",
      )
      onActionSuccess()
    } catch (e) {
      setStatus("error")
      setMessage(e instanceof Error ? e.message : "네트워크 오류")
    }
  }

  // ── "적용" button handler ─────────────────────────────────────────
  // Explicit operator click only. Hits the server apply route, which
  // is idempotent and store/scope/business-day gated. No auto-apply.
  const handleApply = async () => {
    if (!subject || !hasPending) return
    setStatus("working")
    setMessage("")
    try {
      const r = await apiFetch("/api/sessions/participants/apply-actions", {
        method: "POST",
        body: JSON.stringify({ participant_id: subject.participant_id }),
      })
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string; message?: string }
        setStatus("error")
        setMessage(body.message ?? body.error ?? "적용 실패")
        return
      }
      const body = (await r.json()) as {
        applied: Array<{ action_id: string; action_type: string; result: string }>
        skipped: Array<{ action_id: string; action_type: string; reason: string }>
        failed?: Array<{ action_id: string; action_type: string; failure_code: string; failure_message: string }>
      }
      const n = body.applied.length
      const skipN = body.skipped.length
      const failN = body.failed?.length ?? 0
      // Any failure elevates the status to 'error' so the operator
      // sees a red status line. Successful-but-partial batches remain
      // 'ok' with a count breakdown; the per-action apply badges pick
      // up the real state on the next poll.
      setStatus(failN > 0 ? "error" : "ok")
      const firstFail = body.failed?.[0]
      setMessage(
        n === 0 && skipN === 0 && failN === 0
          ? "적용할 변경사항이 없습니다."
          : failN > 0
            ? `적용 부분 실패 — 완료 ${n}건 · 건너뜀 ${skipN}건 · 실패 ${failN}건${firstFail ? ` (${firstFail.failure_code})` : ""}`
            : `적용 완료 — ${n}건${skipN > 0 ? ` · 건너뜀 ${skipN}건` : ""}`,
      )
      onActionSuccess()
    } catch (e) {
      setStatus("error")
      setMessage(e instanceof Error ? e.message : "네트워크 오류")
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="스태프 작업 선택"
    >
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-sm rounded-2xl bg-[#0b0e1c] border border-white/10 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-3 border-b border-white/[0.06]">
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full border text-[11px] font-bold ${style.chip}`}>
                {subject.display_name.slice(0, 1) || "?"}
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-slate-100 truncate">
                  {subject.display_name}
                  {participant?.is_foreign && participant.origin_store_name && (
                    <span className="text-[10px] text-fuchsia-300 font-normal ml-1">({participant.origin_store_name})</span>
                  )}
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  {room?.room_name ?? "—"}
                  {participant ? ` · ${STATUS_STYLES[state].label}` : ""}
                  {participant ? ` · ${elapsedLabel(participant.entered_at).replace(" 전", " 경과")}` : ""}
                </div>
              </div>
            </div>
            {room?.session?.manager_name && (
              <div className="mt-1.5 text-[10px] text-slate-400">
                실장 · <span className="text-purple-300">{room.session.manager_name}</span>
              </div>
            )}
            {(() => {
              const recs = subject ? alertsByParticipantId?.get(subject.participant_id) ?? [] : []
              const hasRecs = showRecommendations && recs.length > 0
              return hasRecs ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {recs.map(r => (
                    <span
                      key={r.code}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-semibold ${
                        r.code === "long_mid_out"
                          ? "bg-red-500/15 border-red-500/40 text-red-200"
                          : r.code === "overdue"
                            ? "bg-orange-500/15 border-orange-500/40 text-orange-200"
                            : r.code === "long_session"
                              ? "bg-amber-500/15 border-amber-500/40 text-amber-200"
                              : "bg-cyan-500/15 border-cyan-500/40 text-cyan-200"
                      }`}
                      title={REC_LABEL[r.code]}
                    >
                      <span aria-hidden>⚠</span>
                      <span>{r.message}</span>
                    </span>
                  ))}
                </div>
              ) : null
            })()}
            {(operatorStatus !== "normal" || extensionCount > 0 || hasAnyAction) && (
              <div className="mt-1.5 flex items-center gap-1.5 text-[10px] flex-wrap">
                {operatorStatus === "still_working" && (
                  <span className="px-1.5 py-0.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-200">
                    일중이다 표시중
                  </span>
                )}
                {operatorStatus === "extended" && extensionCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 text-cyan-200">
                    연장 {extensionCount}회
                  </span>
                )}
                {/* Apply-state badge — server-truth driven. Falls back
                    to the legacy cursor-based 미적용/적용됨 pill only
                    when the action predates the apply-tracking pipeline
                    (apply row absent → latest_apply_status === null). */}
                {participant && participant.latest_apply_status ? (
                  <ApplyStatusBadge data={participant} />
                ) : hasAnyAction ? (
                  hasPending ? (
                    <span
                      className="px-1.5 py-0.5 rounded-md border border-amber-500/45 bg-amber-500/15 text-amber-200"
                      title="기록된 변경사항이 아직 적용되지 않았습니다."
                    >미적용</span>
                  ) : (
                    <span
                      className="px-1.5 py-0.5 rounded-md border border-slate-500/40 bg-slate-500/10 text-slate-300"
                      title="모든 기록된 변경사항이 참여자 상태에 반영되었습니다."
                    >적용됨</span>
                  )
                ) : null}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-white text-xl leading-none flex-shrink-0"
            aria-label="닫기"
          >×</button>
        </div>

        {/* Actions — record only. Each button writes one row into the
            append-only action log but does NOT touch participant state. */}
        <div className="px-5 pt-4 pb-2 space-y-2">
          {(["still_working", "end_now", "extend"] as ActionType[]).map(a => (
            <button
              key={a}
              type="button"
              disabled={status === "working" || !participant}
              onClick={() => handleAction(a)}
              className={`w-full px-3 py-2.5 rounded-lg border text-[13px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${CLS[a]}`}
            >
              {LABEL[a]}
            </button>
          ))}
        </div>

        {/* 👍 / 👎 accuracy feedback — writes one ble_feedback row per
            tap. Never mutates business state, BLE raw tables, or
            session/participant/settlement tables. Rendered only when
            the operator enabled `show_feedback_buttons` in the view
            options dropdown. */}
        {subject && showFeedbackButtons && (
          <div className="px-5 pb-2">
            {(() => {
              const ble = subject.membership_id ? bleByMembership?.get(subject.membership_id) ?? null : null
              const fbSubject: FeedbackSubject = {
                membership_id: subject.membership_id ?? "",
                participant_id: subject.participant_id,
                session_id: participant ? (rooms.find(r => r.room_uuid === subject.room_uuid)?.session?.id ?? null) : null,
                zone: ble?.zone ?? (participant?.zone ?? null),
                room_uuid: ble?.room_uuid ?? subject.room_uuid,
                gateway_id: null,
              }
              return fbSubject.membership_id ? (
                <BleFeedbackButtons
                  subject={fbSubject}
                  onSubmitted={() => onFeedbackSubmitted?.()}
                  size="sm"
                />
              ) : null
            })()}
          </div>
        )}

        {/* BLE 위치 수정 — opens correction modal at page level. Writes
            to ble_presence_corrections only; never touches BLE raw or
            transactional state. */}
        {onRequestCorrection && (
          <div className="px-5 pb-2">
            <button
              type="button"
              disabled={status === "working" || !participant}
              onClick={onRequestCorrection}
              className="w-full px-3 py-2 rounded-lg border text-[12px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-amber-500/10 border-amber-500/40 text-amber-100 hover:bg-amber-500/20"
              title="BLE가 잘못된 위치를 표시하고 있을 때 수동으로 수정합니다."
            >
              위치 수정
            </button>
          </div>
        )}

        {/* Retry row — visible only when the LATEST action has a
            server-side apply row AND its apply_status is failed OR a
            stale-pending (>5min since last attempt). Success rows never
            show retry. Pending-but-fresh rows do not show retry either
            — the operator should wait for the current attempt. */}
        {participant && participant.latest_action_id && (participant.latest_apply_status === "failed"
          || (participant.latest_apply_status === "pending" && isApplyStale(participant))) && (
          <div className="px-5 pb-2 pt-1 border-t border-white/[0.04] space-y-2">
            <div className="flex items-start gap-2">
              <ApplyStatusBadge data={participant} showFailureDetail size="sm" />
            </div>
            <button
              type="button"
              disabled={retryHandler.state === "working" || status === "working"}
              onClick={() => {
                if (!participant.latest_action_id) return
                void retryHandler.retry(participant.latest_action_id)
              }}
              className="w-full px-3 py-2.5 rounded-lg border text-[13px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-red-500/15 border-red-500/45 text-red-100 hover:bg-red-500/25"
              title="서버에 재적용을 요청합니다. 성공하면 상단 배지가 [반영됨] 으로 바뀝니다."
            >
              {retryHandler.state === "working" ? "재시도 중…" : "재시도"}
            </button>
            {retryHandler.message && (
              <div
                className={`text-[11px] leading-snug ${
                  retryHandler.state === "error" ? "text-red-300" :
                  retryHandler.state === "ok" ? "text-emerald-300" :
                  "text-slate-400"
                }`}
              >
                {retryHandler.message}
              </div>
            )}
          </div>
        )}

        {/* Apply row — explicit operator consolidation. Server route is
            idempotent: replay with no pending rows is a safe no-op. */}
        <div className="px-5 pb-2 pt-1 border-t border-white/[0.04]">
          <button
            type="button"
            disabled={status === "working" || !participant || !hasPending}
            onClick={handleApply}
            className="w-full px-3 py-2.5 rounded-lg border text-[13px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-amber-500/15 border-amber-500/45 text-amber-100 hover:bg-amber-500/25"
            title={
              !hasAnyAction
                ? "이 참여자는 기록된 변경사항이 없습니다."
                : !hasPending
                  ? "모든 기록된 변경사항이 이미 반영되었습니다."
                  : "기록된 변경사항을 참여자 상태에 반영합니다."
            }
          >
            {status === "working" ? "적용 중…" : hasPending ? "적용" : "적용됨"}
          </button>
        </div>

        {/* Status */}
        {message && (
          <div
            className={`px-5 pb-3 text-[11px] ${
              status === "error" ? "text-red-300" :
              status === "ok" ? "text-emerald-300" :
              "text-slate-400"
            }`}
          >
            {message}
          </div>
        )}

        <div className="px-5 pb-4 text-[10px] text-slate-500 leading-snug">
          이 패널은 운영자 의사결정 기록입니다. 기록된 변경사항은 [적용] 을 눌러야 참여자 상태에 반영되며,
          세션/정산 계산은 /counter 에서 확정됩니다. BLE 는 관여하지 않습니다.
        </div>
      </div>
    </div>
  )
}
