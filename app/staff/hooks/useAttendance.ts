"use client"

/**
 * useAttendance — /staff 페이지 출근 상태 관리 훅.
 *
 * Round 5 (2026-04-24): app/staff/page.tsx 1,136줄 분해 작업의 첫 단계.
 *   순수 data-layer. JSX 무관. 기존 로직 그대로 이관 (비즈니스 로직 변경 없음).
 *
 * 제공:
 *   attendanceMap   Map<membership_id, attendance_id>  — checked_out_at IS NULL 행만
 *   bleLiveIds      Set<membership_id>                  — 최근 10분 BLE 감지 (참고 배지)
 *   attendanceBusyId string | null                      — 토글 진행 중 membership_id
 *   attendanceToast  string                             — UI 알림
 *   load()                                              — /api/attendance GET 재조회
 *   toggle(membershipId, currentlyOn)                   — checkin/checkout
 *
 * 서버 로직 불변. page 에서 loadAnalytics/loadAttendance 를 Promise.all 로 재호출
 *   하던 visibility 변경 시나리오는 해당 effect 가 hook 외부에 남아있음.
 */

import { useCallback, useState } from "react"
import { apiFetch } from "@/lib/apiFetch"

export function useAttendance() {
  const [attendanceMap, setAttendanceMap] = useState<Map<string, string>>(new Map())
  const [bleLiveIds, setBleLiveIds] = useState<Set<string>>(new Set())
  const [attendanceBusyId, setAttendanceBusyId] = useState<string | null>(null)
  const [attendanceToast, setAttendanceToast] = useState<string>("")

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/attendance")
      if (!res.ok) return
      const data = await res.json()
      type A = { id: string; membership_id: string; checked_out_at: string | null }
      const items = (data?.attendance ?? []) as A[]
      const map = new Map<string, string>()
      for (const a of items) {
        if (!a.checked_out_at) map.set(a.membership_id, a.id)
      }
      setAttendanceMap(map)
      const ble = Array.isArray(data?.ble_live_ids) ? (data.ble_live_ids as string[]) : []
      setBleLiveIds(new Set(ble))
    } catch {
      /* ignore */
    }
  }, [])

  const toggle = useCallback(
    async (membershipId: string, currentlyOn: boolean) => {
      setAttendanceBusyId(membershipId)
      setAttendanceToast("")
      try {
        const res = await apiFetch("/api/attendance", {
          method: "POST",
          body: JSON.stringify({
            membership_id: membershipId,
            action: currentlyOn ? "checkout" : "checkin",
          }),
        })
        const body = (await res.json().catch(() => ({}))) as {
          error?: string
          message?: string
        }
        if (!res.ok) {
          setAttendanceToast(body.message || body.error || "처리 실패")
        } else {
          setAttendanceToast(currentlyOn ? "퇴근 완료" : "출근 완료")
          await load()
        }
      } catch {
        setAttendanceToast("서버 오류")
      } finally {
        setAttendanceBusyId(null)
        setTimeout(() => setAttendanceToast(""), 2500)
      }
    },
    [load],
  )

  return {
    attendanceMap,
    bleLiveIds,
    attendanceBusyId,
    attendanceToast,
    load,
    toggle,
  }
}
