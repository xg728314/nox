"use client"

/**
 * useRecentLogs — /staff 페이지 최근 근무 로그 + lifecycle 액션 훅.
 *
 * Round 5 (2026-04-24): page.tsx 분해 2단계.
 *   - GET /api/staff-work-logs (limit 10)
 *   - POST /api/staff-work-logs/[id]/{confirm|void|dispute|resolve}
 *   - reason modal state
 *   - availableActions() 계산기
 *
 * WorkLogRow 타입은 cross_store_work_records + session SSOT join 기반
 *   (Phase 10 P1 상태). 기존 page.tsx 의 타입 정의 그대로 이관.
 */

import { useCallback, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"

export type WorkLogRow = {
  id: string
  session_id: string
  business_day_id: string | null
  working_store_name: string
  origin_store_uuid?: string | null
  working_store_uuid?: string | null
  status: string
  hostess_name: string
  hostess_membership_id: string
  created_by: string | null
  created_at: string
  approved_at: string | null
  approved_by: string | null
  session_started_at: string | null
  session_ended_at: string | null
  session_status: string | null
  session_manager_membership_id: string | null
  session_manager_name: string | null
  room_no: string | null
  room_name: string | null
}

export type LifecycleAction = "confirm" | "void" | "dispute" | "resolve"
export type LifecycleReasonAction = Exclude<LifecycleAction, "confirm">

type ReasonModalState = {
  logId: string
  action: LifecycleReasonAction
} | null

export function useRecentLogs(userRole: string | null) {
  const [recentLogs, setRecentLogs] = useState<WorkLogRow[]>([])
  const [recentLogsLoading, setRecentLogsLoading] = useState(false)
  const [lifecycleBusyId, setLifecycleBusyId] = useState<string | null>(null)
  const [lifecycleToast, setLifecycleToast] = useState<string>("")

  const [reasonModal, setReasonModal] = useState<ReasonModalState>(null)
  const [reasonInput, setReasonInput] = useState("")

  const load = useCallback(async () => {
    setRecentLogsLoading(true)
    try {
      const res = await apiFetch("/api/staff-work-logs?limit=10")
      if (res.ok) {
        const data = await res.json()
        setRecentLogs((data.items ?? []) as WorkLogRow[])
      }
    } catch {
      /* ignore */
    } finally {
      setRecentLogsLoading(false)
    }
  }, [])

  const send = useCallback(
    async (
      logId: string,
      action: LifecycleAction,
      body?: Record<string, unknown>,
    ) => {
      setLifecycleBusyId(logId)
      try {
        const res = await apiFetch(`/api/staff-work-logs/${logId}/${action}`, {
          method: "POST",
          body: body ? JSON.stringify(body) : undefined,
        })
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          status?: string
          message?: string
          error?: string
        }
        if (res.ok) {
          setLifecycleToast(
            action === "confirm"
              ? "확정 완료"
              : action === "void"
                ? "무효화 완료"
                : action === "resolve"
                  ? "해결 완료"
                  : "이의 제기됨",
          )
          await load()
        } else {
          setLifecycleToast(data.message || data.error || "처리 실패")
        }
      } catch {
        setLifecycleToast("서버 오류")
      } finally {
        setLifecycleBusyId(null)
        setTimeout(() => setLifecycleToast(""), 2500)
      }
    },
    [load],
  )

  const start = useCallback(
    (logId: string, action: LifecycleAction) => {
      if (action === "confirm") {
        send(logId, "confirm")
        return
      }
      setReasonInput("")
      setReasonModal({ logId, action })
    },
    [send],
  )

  const cancelReason = useCallback(() => {
    setReasonModal(null)
    setReasonInput("")
  }, [])

  const submitReason = useCallback(async () => {
    if (!reasonModal) return
    const r = reasonInput.trim()
    if (!r && reasonModal.action !== "resolve") return
    await send(reasonModal.logId, reasonModal.action, r ? { reason: r } : undefined)
    setReasonModal(null)
    setReasonInput("")
  }, [reasonModal, reasonInput, send])

  // UI-level action 가용성:
  //   draft/pending: [확정](owner), [무효](manager + owner)
  //   confirmed:     [분쟁](manager + owner), [무효](owner)
  //   disputed:      [해결](owner), [무효](owner)
  //   voided/settled: 없음
  // 서버가 최종 게이트.
  const availableActions = useCallback(
    (log: WorkLogRow): LifecycleAction[] => {
      const isOwnerRole = userRole === "owner"
      const isManagerRole = userRole === "manager"
      const acts: LifecycleAction[] = []
      if (log.status === "settled" || log.status === "voided") return []
      if (log.status === "pending" || log.status === "draft") {
        if (isOwnerRole) acts.push("confirm", "void")
        else if (isManagerRole) acts.push("void")
      } else if (log.status === "confirmed") {
        if (isOwnerRole) acts.push("dispute", "void")
        else if (isManagerRole) acts.push("dispute")
      } else if (log.status === "disputed") {
        if (isOwnerRole) acts.push("resolve", "void")
      }
      return acts
    },
    [userRole],
  )

  return {
    recentLogs,
    recentLogsLoading,
    lifecycleBusyId,
    lifecycleToast,
    reasonModal,
    reasonInput,
    setReasonInput,
    load,
    start,
    cancelReason,
    submitReason,
    availableActions,
  }
}
