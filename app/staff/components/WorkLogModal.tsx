"use client"

/**
 * WorkLogModal — 아가씨 1명의 근무 이벤트(draft) 수동 등록.
 *
 * Phase 1: POST /api/staff-work-logs 호출.
 *   - 근무 매장 (본 매장 또는 타매장 UUID 직접 입력)
 *   - 방 라벨 (자유 텍스트)
 *   - 시간 (입실 필수 / 퇴실 선택)
 *   - 종목 / 근무형태 세그먼트
 *   - 메모 / 금액 힌트 (선택)
 *
 * 제약:
 *   - hostess 는 모달 진입 시점에 결정되어 prop 로 전달.
 *   - manager 는 서버에서 자기 담당 검증 재실행.
 *   - TIME_CONFLICT (409) 반환 시 상단 배너로 경고.
 */

import { useState } from "react"
import { apiFetch } from "@/lib/apiFetch"

type Category = "public" | "shirt" | "hyper" | "etc"
type WorkType = "full" | "half" | "cha3" | "half_cha3"

const CATEGORY_LABEL: Record<Category, string> = {
  public: "퍼블릭",
  shirt: "셔츠",
  hyper: "하이퍼",
  etc: "기타",
}

const WORK_TYPE_LABEL: Record<WorkType, string> = {
  full: "완티",
  half: "반티",
  cha3: "차3",
  half_cha3: "반차3",
}

type Props = {
  open: boolean
  onClose: () => void
  hostessMembershipId: string
  hostessName: string
  /**
   * 본 매장 UUID — 기본 선택값. 타매장 입력은 별도 UUID 텍스트 입력.
   * 현재 Phase 1 은 store picker 대신 UUID 필드로 단순화.
   */
  callerStoreUuid: string
  onSuccess?: () => void
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function toLocalDatetimeInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function WorkLogModal({
  open,
  onClose,
  hostessMembershipId,
  hostessName,
  callerStoreUuid,
  onSuccess,
}: Props) {
  const [workingStoreUuid, setWorkingStoreUuid] = useState(callerStoreUuid)
  const [roomLabel, setRoomLabel] = useState("")
  const [startedAt, setStartedAt] = useState(toLocalDatetimeInputValue(new Date()))
  const [endedAt, setEndedAt] = useState("")
  const [category, setCategory] = useState<Category | "">("")
  const [workType, setWorkType] = useState<WorkType | "">("")
  const [amountHint, setAmountHint] = useState("")
  const [memo, setMemo] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [conflicts, setConflicts] = useState<{ id: string }[]>([])

  if (!open) return null

  function reset() {
    setWorkingStoreUuid(callerStoreUuid)
    setRoomLabel("")
    setStartedAt(toLocalDatetimeInputValue(new Date()))
    setEndedAt("")
    setCategory("")
    setWorkType("")
    setAmountHint("")
    setMemo("")
    setError("")
    setConflicts([])
  }

  function validate(): string | null {
    if (!workingStoreUuid.trim()) return "근무 매장을 지정하세요."
    if (!UUID_RE.test(workingStoreUuid.trim()))
      return "근무 매장 UUID 형식이 올바르지 않습니다."
    if (!startedAt) return "입실 시각이 필요합니다."
    if (!category) return "종목을 선택하세요."
    if (!workType) return "근무형태를 선택하세요."
    if (endedAt) {
      const s = new Date(startedAt).getTime()
      const e = new Date(endedAt).getTime()
      if (Number.isNaN(e)) return "퇴실 시각 형식이 올바르지 않습니다."
      if (e < s) return "퇴실 시각은 입실 시각 이후여야 합니다."
    }
    const amt = amountHint ? Number(amountHint) : NaN
    if (amountHint && (!Number.isFinite(amt) || amt < 0))
      return "금액 힌트는 0 이상의 숫자여야 합니다."
    return null
  }

  async function handleSubmit() {
    setError("")
    setConflicts([])
    const v = validate()
    if (v) {
      setError(v)
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        hostess_membership_id: hostessMembershipId,
        working_store_uuid: workingStoreUuid.trim(),
        started_at: new Date(startedAt).toISOString(),
        ended_at: endedAt ? new Date(endedAt).toISOString() : null,
        working_store_room_label: roomLabel.trim() || null,
        category,
        work_type: workType,
        external_amount_hint: amountHint ? Number(amountHint) : null,
        memo: memo.trim() || null,
      }
      const res = await apiFetch("/api/staff-work-logs", {
        method: "POST",
        body: JSON.stringify(payload),
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean; error?: string; message?: string
        conflicts?: { id: string; kind?: string }[]
      }
      if (!res.ok) {
        setError(body.message || body.error || "저장 실패")
        return
      }
      // Soft conflicts — 201 OK but 응답에 conflicts 포함 시 상위에 경고 전달 후 닫음.
      onSuccess?.()
      reset()
      onClose()
      if (body.conflicts && body.conflicts.length > 0) {
        // ownership 은 parent 로 이양된 상태이므로 console 로만 기록.
        // 실제 경고 배지는 /staff 리스트 쪽에서 draft 레이블로 확인 가능.
        console.warn("[staff-work-log] saved with conflicts:", body.conflicts)
      }
    } catch {
      setError("서버 오류 또는 네트워크 문제로 저장할 수 없습니다.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-pink-400/25 bg-[#0A1222] p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400">근무 기록</div>
            <div className="text-base font-semibold text-pink-200">{hostessName}</div>
          </div>
          <button
            onClick={() => { reset(); onClose() }}
            className="text-xs text-slate-400 hover:text-white"
          >
            닫기
          </button>
        </div>

        {conflicts.length > 0 && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
            겹치는 기존 기록 {conflicts.length}건이 있습니다. 기존 기록을 정리하고 다시 시도하세요.
          </div>
        )}

        <div>
          <label className="block text-xs text-slate-400 mb-1">근무 매장 (UUID)</label>
          <input
            type="text"
            value={workingStoreUuid}
            onChange={(e) => setWorkingStoreUuid(e.target.value)}
            className="w-full bg-[#030814] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono"
            placeholder="본 매장 자동 입력 / 타매장은 UUID 입력"
          />
          {workingStoreUuid === callerStoreUuid && (
            <p className="text-[10px] text-slate-500 mt-1">본 매장</p>
          )}
          {workingStoreUuid && workingStoreUuid !== callerStoreUuid && UUID_RE.test(workingStoreUuid) && (
            <p className="text-[10px] text-pink-300 mt-1">타매장 기록</p>
          )}
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">방 라벨 (예: 3번방)</label>
          <input
            type="text"
            value={roomLabel}
            onChange={(e) => setRoomLabel(e.target.value)}
            className="w-full bg-[#030814] border border-white/10 rounded-lg px-3 py-2 text-sm"
            placeholder="3번방"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-slate-400 mb-1">입실 시각</label>
            <input
              type="datetime-local"
              value={startedAt}
              onChange={(e) => setStartedAt(e.target.value)}
              className="w-full bg-[#030814] border border-white/10 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">퇴실 시각 (선택)</label>
            <input
              type="datetime-local"
              value={endedAt}
              onChange={(e) => setEndedAt(e.target.value)}
              className="w-full bg-[#030814] border border-white/10 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">종목</label>
          <div className="grid grid-cols-3 gap-1">
            {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`h-9 rounded-lg text-xs font-medium border transition-colors ${
                  category === c
                    ? "bg-pink-500/20 text-pink-200 border-pink-500/30"
                    : "bg-white/5 text-slate-400 border-white/10"
                }`}
              >
                {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">근무형태</label>
          <div className="grid grid-cols-3 gap-1">
            {(Object.keys(WORK_TYPE_LABEL) as WorkType[]).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWorkType(w)}
                className={`h-9 rounded-lg text-xs font-medium border transition-colors ${
                  workType === w
                    ? "bg-purple-500/20 text-purple-200 border-purple-500/30"
                    : "bg-white/5 text-slate-400 border-white/10"
                }`}
              >
                {WORK_TYPE_LABEL[w]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">금액 힌트 (원, 선택)</label>
          <input
            type="number"
            inputMode="numeric"
            value={amountHint}
            onChange={(e) => setAmountHint(e.target.value)}
            className="w-full bg-[#030814] border border-white/10 rounded-lg px-3 py-2 text-sm"
            placeholder="예상 금액 (정산 참고용)"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">메모 (선택)</label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            className="w-full bg-[#030814] border border-white/10 rounded-lg px-3 py-2 text-sm"
            placeholder="특이사항"
          />
        </div>

        {error && <p className="text-red-400 text-xs">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => { reset(); onClose() }}
            disabled={submitting}
            className="flex-1 h-11 rounded-xl bg-white/5 text-slate-300 text-sm border border-white/10 disabled:opacity-50"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 h-11 rounded-xl bg-pink-500/25 text-pink-100 text-sm font-medium border border-pink-500/40 disabled:opacity-50"
          >
            {submitting ? "저장 중..." : "저장 (draft)"}
          </button>
        </div>

        <p className="text-[10px] text-slate-500 text-center">
          저장 직후 상태는 <b>draft</b> 입니다. 확정 / 무효화는 후속 라운드에서 추가됩니다.
        </p>
      </div>
    </div>
  )
}
