"use client"

/**
 * BulkManagerPickerV2 — bulk manager assignment modal for multi-entry
 * staff-chat submits. Presented ONLY when a single chat submit creates
 * multiple participants AND the parser resolved an exact store (so we
 * can preload the store's manager list).
 *
 * Two-step UI:
 *   1. Mode choice — "같은 실장 배정 / 개별 선택 / 나중에"
 *   2. Manager grid (only if "같은 실장") — back-navigable to step 1
 *
 * Non-destructive by design:
 *   - "개별 선택" / "나중에" close the modal without mutating anything.
 *     The newly-created participants remain in their POST-time state
 *     (category + time_minutes already persisted, manager unset).
 *   - Operator can still tap individual cards later to assign a manager
 *     via the existing card-tap path. That flow is unchanged.
 */

import { useState } from "react"
import type { StaffItem } from "../types"

export type BulkManagerPickerProps = {
  open: boolean
  storeName: string
  managerList: StaffItem[]
  participantIds: string[]
  busy: boolean
  onClose: () => void
  /**
   * Apply the selected manager to every id in `participantIds`. Called
   * once. Caller is responsible for looping PATCHes + refreshing UI.
   */
  onAssignSame: (manager: { membership_id: string; name: string }) => Promise<void>
}

export default function BulkManagerPickerV2({
  open, storeName, managerList, participantIds, busy,
  onClose, onAssignSame,
}: BulkManagerPickerProps) {
  const [step, setStep] = useState<"mode" | "manager">("mode")
  const [selected, setSelected] = useState<{ membership_id: string; name: string } | null>(null)

  if (!open) return null

  const handleClose = () => {
    if (busy) return
    setStep("mode")
    setSelected(null)
    onClose()
  }

  const handleConfirm = async () => {
    if (!selected || busy) return
    await onAssignSame(selected)
    setStep("mode")
    setSelected(null)
  }

  return (
    <>
      <div className="fixed inset-0 z-[49] bg-black/50" onClick={handleClose} />
      <div className="fixed left-0 right-0 bottom-0 z-[50] bg-[#1c1c2e] rounded-t-2xl p-4 max-h-[65vh] overflow-y-auto border-t border-white/10 shadow-[0_-20px_60px_rgba(0,0,0,0.5)]">
        {busy && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#1c1c2e]/80 backdrop-blur-sm rounded-t-2xl">
            <div className="w-10 h-10 rounded-full border-[3px] border-cyan-400/30 border-t-cyan-400 animate-spin mb-3" />
            <span className="text-sm text-cyan-300">처리 중...</span>
          </div>
        )}
        <div className="mx-auto w-10 h-1 rounded-full bg-white/20 mb-4" />

        {/* Top summary */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-lg font-bold">
              {participantIds.length}명 실장 일괄 지정
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              가게: <span className="text-slate-200 font-medium">{storeName}</span>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            닫기
          </button>
        </div>

        {/* Step 1: Mode choice */}
        {step === "mode" && (
          <div className="space-y-2">
            <button
              onClick={() => setStep("manager")}
              disabled={busy || managerList.length === 0}
              className="w-full h-14 rounded-2xl border border-cyan-500/30 bg-cyan-500/15 hover:bg-cyan-500/25 active:scale-[0.98] transition-all px-5 text-left disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <div className="text-sm font-bold text-cyan-200">같은 실장 배정</div>
              <div className="text-[11px] text-cyan-400/70 mt-0.5">
                {managerList.length === 0
                  ? "등록된 실장이 없습니다"
                  : `${participantIds.length}명 모두에게 동일한 실장 적용`}
              </div>
            </button>
            <button
              onClick={handleClose}
              disabled={busy}
              className="w-full h-14 rounded-2xl border border-white/10 bg-white/[0.04] hover:bg-white/10 active:scale-[0.98] transition-all px-5 text-left disabled:opacity-40"
            >
              <div className="text-sm font-bold text-slate-200">개별 선택</div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                각 카드를 탭해서 실장을 개별 지정합니다
              </div>
            </button>
            <button
              onClick={handleClose}
              disabled={busy}
              className="w-full h-14 rounded-2xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] active:scale-[0.98] transition-all px-5 text-left disabled:opacity-40"
            >
              <div className="text-sm font-bold text-slate-400">나중에</div>
              <div className="text-[11px] text-slate-600 mt-0.5">
                실장 지정을 건너뛰고 닫습니다
              </div>
            </button>
          </div>
        )}

        {/* Step 2: Manager grid */}
        {step === "manager" && (
          <>
            <button
              type="button"
              onClick={() => { setStep("mode"); setSelected(null) }}
              disabled={busy}
              className="mb-3 flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-300 transition-colors"
            >
              <span aria-hidden>←</span>
              <span>일괄 모드 다시 선택</span>
            </button>
            <p className="text-xs text-slate-400 mb-3">
              선택한 실장이 <span className="text-cyan-300 font-semibold">{participantIds.length}명</span>에게 모두 적용됩니다.
            </p>
            {managerList.length > 0 ? (
              <div className="space-y-2 mb-3">
                {managerList.map(m => (
                  <button
                    key={m.membership_id}
                    onClick={() => setSelected({ membership_id: m.membership_id, name: m.name })}
                    disabled={busy}
                    className={`w-full flex items-center gap-3 h-14 rounded-2xl border px-4 transition-all disabled:opacity-40 ${
                      selected?.membership_id === m.membership_id
                        ? "bg-purple-500/20 border-purple-500/40 text-purple-300"
                        : "bg-white/[0.04] border-white/10 hover:bg-white/10 text-slate-200"
                    }`}
                  >
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-400/50 to-indigo-500/50 flex items-center justify-center text-sm font-bold">
                      {m.name.charAt(0)}
                    </div>
                    <span className="text-sm font-semibold flex-1 text-left">{m.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="py-4 text-center text-xs text-slate-500 mb-3">등록된 실장이 없습니다</div>
            )}
            <button
              onClick={handleConfirm}
              disabled={busy || !selected}
              className={`w-full h-14 rounded-2xl text-base font-semibold transition-all ${
                selected
                  ? "bg-[linear-gradient(90deg,#0ea5e9,#2563eb)]"
                  : "bg-white/10 text-slate-500 cursor-not-allowed"
              }`}
            >
              {!selected ? "실장을 선택하세요" : `${participantIds.length}명에게 적용`}
            </button>
          </>
        )}
      </div>
    </>
  )
}
