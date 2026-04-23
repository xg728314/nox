"use client"

/**
 * WorkLogModal — 아가씨 1명의 근무 이벤트(draft) 수동 등록.
 *
 * 본 라운드(UI 보강):
 *   - 근무매장 UUID 직접 입력 → 드롭다운 + "본 매장" 토글. 로드 실패 시
 *     (예: manager 는 /api/stores 403) UUID 텍스트 폴백.
 *   - 필드별 인라인 에러 + 저장 버튼 disabled.
 *   - 본 매장 지정 시 "타매장 근무 아님 → 정산 편입 대상 아님" 경고.
 *   - 금액 힌트 설명: hint 는 "서버 단가와 일치해야만 통과" 규칙 안내.
 *   - 서버가 반환한 conflicts[] 을 배너로 표시 (과거 console.warn 만).
 *
 * 금지: 정산 계산/상태 전이/schema 변경 없음.
 */

import { useEffect, useState } from "react"
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
  callerStoreUuid: string
  onSuccess?: () => void
}

type StoreOption = { id: string; store_name: string }
type ConflictRow = { id: string; kind?: string; started_at?: string }

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
  const [conflicts, setConflicts] = useState<ConflictRow[]>([])

  // Store picker 시도. 실패(403 등) 시 UUID 텍스트 폴백.
  const [stores, setStores] = useState<StoreOption[] | null>(null)
  const [storeLoadFailed, setStoreLoadFailed] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch("/api/stores?include_self=1")
        if (!res.ok) {
          if (!cancelled) setStoreLoadFailed(true)
          return
        }
        const data = await res.json().catch(() => ({}))
        const arr = Array.isArray(data.stores)
          ? (data.stores as StoreOption[])
          : []
        if (!cancelled) {
          if (arr.length === 0) setStoreLoadFailed(true)
          else setStores(arr)
        }
      } catch {
        if (!cancelled) setStoreLoadFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

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

  // ── Per-field validation (UI 우선 차단; 서버가 최종 검증) ──
  const workingStoreErr =
    !workingStoreUuid.trim()
      ? "근무 매장을 지정하세요."
      : !UUID_RE.test(workingStoreUuid.trim())
      ? "UUID 형식이 올바르지 않습니다."
      : ""
  const startedAtErr = !startedAt ? "입실 시각이 필요합니다." : ""
  let endedAtErr = ""
  if (endedAt) {
    const s = new Date(startedAt).getTime()
    const e = new Date(endedAt).getTime()
    if (Number.isNaN(e)) endedAtErr = "퇴실 시각 형식이 올바르지 않습니다."
    else if (e < s) endedAtErr = "퇴실은 입실 이후여야 합니다."
  }
  const categoryErr = !category ? "종목을 선택하세요." : ""
  const workTypeErr = !workType ? "근무형태를 선택하세요." : ""
  const amountNum = amountHint ? Number(amountHint) : NaN
  const amountErr =
    amountHint && (!Number.isFinite(amountNum) || amountNum < 0)
      ? "0 이상의 숫자여야 합니다."
      : ""

  const isSameStore =
    !!workingStoreUuid &&
    UUID_RE.test(workingStoreUuid.trim()) &&
    workingStoreUuid.trim() === callerStoreUuid
  const isEtc = category === "etc"

  const canSubmit =
    !workingStoreErr &&
    !startedAtErr &&
    !endedAtErr &&
    !categoryErr &&
    !workTypeErr &&
    !amountErr &&
    !submitting

  async function handleSubmit() {
    if (!canSubmit) return
    setError("")
    setConflicts([])
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
        ok?: boolean
        error?: string
        message?: string
        conflicts?: ConflictRow[]
      }
      if (!res.ok) {
        setError(body.message || body.error || "저장 실패")
        return
      }
      // 저장 성공. conflicts 있으면 잠시 노출 후 부모에 제어권 위임.
      if (body.conflicts && body.conflicts.length > 0) {
        setConflicts(body.conflicts)
        // 상위 리스트도 갱신.
        onSuccess?.()
        // reset 은 하지만 모달은 잠시 유지 (사용자가 경고 읽도록).
        return
      }
      onSuccess?.()
      reset()
      onClose()
    } catch {
      setError("서버 오류 또는 네트워크 문제로 저장할 수 없습니다.")
    } finally {
      setSubmitting(false)
    }
  }

  // Render helper
  const fieldErr = (msg: string) =>
    msg ? (
      <p className="text-[10px] text-red-300 mt-1">{msg}</p>
    ) : null

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

        {/* Same-store / cross-store 안내 */}
        {isSameStore && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
            본 매장 근무는 cross-store 정산 편입 대상이 아닙니다. 기록은 저장되지만
            <b> aggregate 에서 자동 제외</b> 됩니다.
          </div>
        )}

        {/* etc 종목 안내 */}
        {isEtc && (
          <div className="rounded-xl border border-slate-400/20 bg-slate-500/10 px-3 py-2 text-[11px] text-slate-300">
            &lsquo;기타&rsquo; 종목은 매장 단가표에 매핑이 없습니다. 편입 시 hint 가 없으면 skip 됩니다.
          </div>
        )}

        {/* 서버가 반환한 soft conflicts */}
        {conflicts.length > 0 && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
            <div className="font-medium mb-1">겹치는 기록 {conflicts.length}건 감지됨</div>
            <div className="text-[10px] text-amber-300/80">
              저장은 완료되었습니다. 중복 여부를 확인하고 필요 시 해당 draft 를 무효화하세요.
            </div>
            <div className="flex justify-end mt-2">
              <button
                onClick={() => { reset(); onClose() }}
                className="text-[11px] px-2 py-1 rounded bg-amber-500/20 text-amber-100 border border-amber-500/30"
              >
                닫기
              </button>
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs text-slate-400 mb-1">
            근무 매장 <span className="text-red-400">*</span>
          </label>
          {stores && !storeLoadFailed ? (
            <select
              value={workingStoreUuid}
              onChange={(e) => setWorkingStoreUuid(e.target.value)}
              className="w-full bg-[#030814] border border-white/10 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">매장 선택...</option>
              <option value={callerStoreUuid}>{"(본 매장)"}</option>
              {stores
                .filter((s) => s.id !== callerStoreUuid)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.store_name}
                  </option>
                ))}
            </select>
          ) : (
            <>
              <input
                type="text"
                value={workingStoreUuid}
                onChange={(e) => setWorkingStoreUuid(e.target.value)}
                className="w-full bg-[#030814] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono"
                placeholder="UUID 입력 (본 매장은 자동)"
              />
              {storeLoadFailed && (
                <p className="text-[10px] text-slate-500 mt-1">
                  매장 목록 로드 실패 — UUID 를 직접 입력하세요.
                </p>
              )}
            </>
          )}
          {!isSameStore &&
            workingStoreUuid &&
            UUID_RE.test(workingStoreUuid.trim()) && (
              <p className="text-[10px] text-pink-300 mt-1">타매장 기록 (정산 편입 대상)</p>
            )}
          {fieldErr(workingStoreErr)}
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">방 라벨 (선택)</label>
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
            <label className="block text-xs text-slate-400 mb-1">
              입실 시각 <span className="text-red-400">*</span>
            </label>
            <input
              type="datetime-local"
              value={startedAt}
              onChange={(e) => setStartedAt(e.target.value)}
              className="w-full bg-[#030814] border border-white/10 rounded-lg px-3 py-2 text-sm"
            />
            {fieldErr(startedAtErr)}
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">퇴실 시각 (선택)</label>
            <input
              type="datetime-local"
              value={endedAt}
              onChange={(e) => setEndedAt(e.target.value)}
              className="w-full bg-[#030814] border border-white/10 rounded-lg px-3 py-2 text-sm"
            />
            {fieldErr(endedAtErr)}
          </div>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">
            종목 <span className="text-red-400">*</span>
          </label>
          <div className="grid grid-cols-4 gap-1">
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
          {fieldErr(categoryErr)}
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">
            근무형태 <span className="text-red-400">*</span>
          </label>
          <div className="grid grid-cols-4 gap-1">
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
          {fieldErr(workTypeErr)}
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">
            금액 힌트 (원, 선택)
          </label>
          <input
            type="number"
            inputMode="numeric"
            value={amountHint}
            onChange={(e) => setAmountHint(e.target.value)}
            className="w-full bg-[#030814] border border-white/10 rounded-lg px-3 py-2 text-sm"
            placeholder="예상 금액 (생략 가능)"
          />
          <p className="text-[10px] text-slate-500 mt-1">
            힌트는 <b>서버 단가와 일치</b> 해야 정산에 편입됩니다. 불일치 시 해당 로그는 skip.
          </p>
          {fieldErr(amountErr)}
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

        {error && (
          <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

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
            disabled={!canSubmit}
            className="flex-1 h-11 rounded-xl bg-pink-500/25 text-pink-100 text-sm font-medium border border-pink-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? "저장 중..." : "저장 (draft)"}
          </button>
        </div>

        <p className="text-[10px] text-slate-500 text-center">
          저장 직후 상태는 <b>draft</b>. 확정은 사장/운영자가 수행합니다.
        </p>
      </div>
    </div>
  )
}
