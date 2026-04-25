"use client"

/**
 * 인쇄 + archive 원샷 버튼.
 *
 * 흐름:
 *   1. 세션의 receipt 상태 확인 (finalized 여야 함)
 *   2. 사용자 확인 다이얼로그: "인쇄 후 기록을 숨깁니다. 계속?"
 *   3. window.print() 호출 → 인쇄 대기
 *   4. 인쇄 직후 /api/sessions/receipt/archive POST
 *   5. 성공 시 onDone() (페이지 이동)
 *
 * 주의:
 *   - archive 는 hard delete 가 아님. DB 에 남아있고 UI 에서만 숨김.
 *   - 정산이 finalized 되지 않았으면 서버가 409 반환 → 사용자에게 명시.
 *   - 인쇄가 실패/취소되어도 archive 는 진행. "인쇄 의사 확인 + archive" 가 비즈니스 룰.
 */

import { useState } from "react"
import { apiFetch } from "@/lib/apiFetch"
import { captureException } from "@/lib/telemetry/captureException"

type Props = {
  roomId: string
  onDone: () => void
}

export default function PrintAndArchiveButton({ roomId, onDone }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function handleClick() {
    if (busy) return
    setError("")

    const confirmed = window.confirm(
      "인쇄 후 이 세션의 기록을 목록에서 숨깁니다.\n" +
      "(DB 에는 안전하게 보관되며, 분쟁/세무조사 시 복원 가능합니다)\n\n" +
      "계속하시겠습니까?",
    )
    if (!confirmed) return

    setBusy(true)
    try {
      // 1. room → active_session_id → receipt_id 체인 조회
      const roomRes = await apiFetch(`/api/rooms?room_uuid=${roomId}`)
      if (!roomRes.ok) throw new Error("방 정보 조회 실패")
      const roomData = await roomRes.json()
      const room = (roomData.rooms ?? []).find(
        (r: { room_uuid: string }) => r.room_uuid === roomId,
      )
      const sessionId = room?.active_session_id ?? room?.closed_session?.id
      if (!sessionId) {
        setError("세션을 찾을 수 없습니다.")
        setBusy(false)
        return
      }

      // receipt 조회 (finalized 만)
      const rcptRes = await apiFetch(`/api/sessions/receipt?session_id=${sessionId}`)
      if (!rcptRes.ok) {
        setError("영수증을 찾을 수 없습니다. 먼저 정산을 확정하세요.")
        setBusy(false)
        return
      }
      const rcptData = await rcptRes.json()
      const receiptId = rcptData?.receipt?.id
      if (!receiptId) {
        setError("영수증 ID 조회 실패.")
        setBusy(false)
        return
      }

      // 2. 인쇄
      window.print()

      // 2.5. 2026-04-25: 인쇄 취소/실패 감지용 2차 confirm.
      //   window.print() 는 취소해도 resolve → 사용자가 실수로 취소했을 수
      //   있음. archive 는 복구 불가능한 상태 전이이므로 한 번 더 확인.
      const proceedArchive = window.confirm(
        "인쇄가 완료되었나요?\n\n" +
        "  [확인] 인쇄 완료 → 기록 숨김(archive)\n" +
        "  [취소] 인쇄 안 됨 → archive 하지 않음 (다시 인쇄 가능)",
      )
      if (!proceedArchive) {
        setBusy(false)
        return
      }

      // 3. archive
      const archiveRes = await apiFetch("/api/sessions/receipt/archive", {
        method: "POST",
        body: JSON.stringify({ receipt_id: receiptId }),
      })
      if (!archiveRes.ok) {
        const err = await archiveRes.json().catch(() => ({}))
        setError(err.message || "archive 처리 실패")
        setBusy(false)
        return
      }

      onDone()
    } catch (e) {
      captureException(e, { tag: "print_and_archive", extra: { roomId } })
      setError(
        e instanceof Error ? e.message : "인쇄/archive 중 오류가 발생했습니다.",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={handleClick}
        disabled={busy}
        className="w-full py-3 rounded-xl bg-red-600 text-white text-sm font-semibold disabled:opacity-60"
      >
        {busy ? "처리 중…" : "인쇄 + 기록 숨김 (archive)"}
      </button>
      {error && (
        <div className="text-xs text-red-500 px-1">{error}</div>
      )}
    </>
  )
}
